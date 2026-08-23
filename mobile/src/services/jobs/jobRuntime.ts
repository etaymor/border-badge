/**
 * jobRuntime - The shell every library job runs inside.
 *
 * Owns the parts that were previously duplicated (or, for the quiz, simply
 * missing): the atomic start lock, the durable breadcrumb, the generation
 * guard, the foreground-event serializer, cancellation, and the step loop.
 * Job owners supply only their work, via a `JobDescriptor`.
 *
 * MUTUAL EXCLUSION. At most one job runs at a time. Both kinds contend for the
 * same SQLite cache and the same `photoBackgroundSync` refresh lock, and
 * running a classification hunt on top of a full-library extract is the worst
 * available CPU/battery mix. A second `startJob` therefore QUEUES (depth 1)
 * rather than preempting, and the queued job's slice sits in `waiting` so its
 * screen can explain the wait instead of looking hung.
 *
 * THE DRIVER SEAM. The `while (!step.isDone(...))` loop below lives here
 * rather than inside a job body, and a checkpoint is written after every
 * step. Between units the loop PULLS `shouldYieldNow(kind, generation)` from
 * every driver registered on `jobRuntimeState`; with no driver asking it is
 * always `false`, so a user watching a build sees it finish. The runtime also
 * tells drivers about every start, settle, heartbeat, and idle, synchronously
 * and terminal per generation, so a driver (the BGProcessingTask handler, the
 * continued-processing lease) can hold OS-level state that mirrors the
 * runtime's own — without the runtime importing any of them. Because the
 * checkpoint is already durable at every step boundary, all of this is purely
 * additive: NO JOB BODY CHANGED to make it work.
 */

import { AppState } from 'react-native';

import {
  clearDurableJob,
  readDurableJob,
  saveDurableCheckpoint,
  writeDurableJob,
} from './jobDurableFlag';
import { getDescriptor } from './jobRegistry';
import {
  emitSettledOnce,
  getCancelInFlight,
  getJobStartedAt,
  getLastOptions,
  getLastProgressAt,
  markForegroundReturn,
  newSlot,
  slots,
  whenJobSettles,
} from './jobRuntimeSlots';
import {
  _emitJobHeartbeat,
  _emitJobIdle,
  _emitJobSettled,
  _emitJobStarted,
  _setJobRunning,
  getRunningJobKind,
  isAnyLibraryJobRunning,
  isJobRunning,
  nextGeneration,
  shouldYieldNow,
} from './jobRuntimeState';
import type {
  JobFailure,
  JobProgress,
  JobRunContext,
  JobRunOutcome,
  JobStartResult,
  LibraryJobKind,
} from './jobTypes';
import { patchJobSlice, resetJobSlice, resetLibraryJobStore } from '@stores/libraryJobStore';

/**
 * Serializes `resumed` starts so rapid app-switcher bounces can't double-fire.
 * Module-global rather than per-kind: one foreground event drives every kind.
 */
let foregroundEventInFlight: Promise<void> | null = null;

/** Queue depth 1. Holds the job that asked to run while another one held the cache. */
let queued: { kind: LibraryJobKind; options: unknown } | null = null;

/**
 * Set while `resetAllForUserChange` is clearing state. A `startJob` issued
 * mid-reset waits for it, so user B's start can never begin under user A's
 * teardown and then be torn down with it.
 */
let resetInFlight: Promise<void> | null = null;

/** Emit `onIdle` when nothing is running or waiting. */
function emitIdleIfQuiet(): void {
  if (!isAnyLibraryJobRunning() && !queued) _emitJobIdle();
}

export {
  isJobRunning,
  isAnyLibraryJobRunning,
  getJobStartedAt,
  getLastProgressAt,
  getCancelInFlight,
  getLastOptions,
  whenJobSettles,
  markForegroundReturn,
};

/**
 * The job waiting behind the running one, if any. Read by the foreground
 * resume path: a queued job whose peer settled `suspended` (or whose peer's
 * breadcrumb was cleared while the app was away) is not drained by the runtime
 * and must be started by the next foreground.
 */
export function getQueuedJob(): { kind: LibraryJobKind; options: unknown } | null {
  return queued ? { ...queued } : null;
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

export interface StartJobOptions {
  /** True when invoked by the foreground auto-resume path. */
  resumed?: boolean;
  /** Checkpoint recovered from the durable record, when resuming. */
  checkpoint?: unknown;
}

export async function startJob(
  kind: LibraryJobKind,
  options: unknown,
  runtimeOptions: StartJobOptions = {}
): Promise<JobStartResult> {
  // Captured at ENTRY, before any await: the durable write below takes a
  // SQLite round-trip, and the Photos permission prompt moves AppState to
  // `inactive` right after a legitimate user start. `inactive` counts as
  // foreground; only `background` does not.
  const foregroundAtCall = AppState.currentState !== 'background';

  if (resetInFlight) await resetInFlight;

  if (runtimeOptions.resumed) {
    if (foregroundEventInFlight) {
      await foregroundEventInFlight;
      // After awaiting an in-flight resume, treat as already-running if the
      // job is still active; otherwise fall through and start fresh.
      if (isJobRunning(kind)) return { status: 'already-running' };
    }
    let resolveForeground: () => void = () => {};
    foregroundEventInFlight = new Promise<void>((resolve) => {
      resolveForeground = resolve;
    });
    try {
      return await runStart(kind, options, runtimeOptions, foregroundAtCall);
    } finally {
      resolveForeground();
      foregroundEventInFlight = null;
    }
  }
  return runStart(kind, options, runtimeOptions, foregroundAtCall);
}

async function runStart(
  kind: LibraryJobKind,
  options: unknown,
  runtimeOptions: StartJobOptions,
  foregroundAtCall: boolean
): Promise<JobStartResult> {
  const descriptor = getDescriptor(kind);
  if (!descriptor) {
    return { status: 'rejected', reason: 'not-registered' };
  }

  // Atomic check-and-acquire. Synchronous up to the first await, which is
  // race-safe in JS's single-threaded event loop.
  if (isJobRunning(kind)) return { status: 'already-running' };

  const blockingKind = getRunningJobKind();
  if (blockingKind && blockingKind !== kind) {
    // Queue rather than preempt. The waiting slice lets the screen explain.
    queued = { kind, options };
    patchJobSlice(kind, { phase: 'waiting', failure: null });
    return { status: 'queued', blockedBy: blockingKind };
  }

  const slot = slots[kind];
  _setJobRunning(kind, true);
  slot.controller = new AbortController();
  const myGeneration = nextGeneration();
  slot.generation = myGeneration;
  const localController = slot.controller;
  const startedAt = Date.now();
  slot.startedAt = startedAt;
  slot.lastProgressAt = startedAt;
  slot.lastOptions = options;

  try {
    // Persist the durable breadcrumb BEFORE reporting 'started'. This closes a
    // crash window where the in-memory lock was set but no record existed for
    // foreground auto-resume to find. Costs one SQLite round-trip on the start
    // path; an acceptable trade for resume reliability.
    await writeDurableJob(kind, {
      startedAt,
      options: options as Record<string, unknown>,
      checkpoint: runtimeOptions.checkpoint,
    });
  } catch (error) {
    // A failed breadcrumb write must not leak the in-memory lock.
    if (slot.controller === localController) {
      _setJobRunning(kind, false);
      slot.controller = null;
      slot.startedAt = null;
      slot.lastOptions = null;
    }
    throw error;
  }

  if (slot.controller !== localController) {
    // A cancel (or a user-change reset) landed during the durable write. It
    // already released the slot and emitted the driver settle for this
    // generation; starting the loop now would resurrect a job the user just
    // stopped, and emitting `onStarted` would hand a driver a run that has
    // already ended.
    return { status: 'rejected', reason: 'cancelled' };
  }

  _emitJobStarted({
    kind,
    generation: myGeneration,
    resumed: runtimeOptions.resumed === true,
    foregroundAtCall,
  });

  // Held so a caller that must OUTLIVE the job can await it — specifically the
  // background task, whose handler returning is what tells iOS the app may be
  // suspended again. Nothing in the foreground awaits it.
  slot.runPromise = runJob(kind, options, runtimeOptions, myGeneration, localController)
    .catch((error) => {
      if (__DEV__) console.warn(`[jobRuntime] Unhandled ${kind} error:`, error);
    })
    .finally(() => {
      if (slots[kind].runPromise === slot.runPromise) slots[kind].runPromise = null;
    });

  return { status: 'started' };
}

// ---------------------------------------------------------------------------
// The step loop
// ---------------------------------------------------------------------------

async function runJob(
  kind: LibraryJobKind,
  options: unknown,
  runtimeOptions: StartJobOptions,
  myGeneration: number,
  localController: AbortController
): Promise<void> {
  const descriptor = getDescriptor(kind);
  const slot = slots[kind];
  let outcome: JobRunOutcome = 'completed';
  let failureError: unknown;

  /**
   * Only the run that still owns the slot may stamp progress or page drivers.
   * The controller check makes a context held past its run inert.
   */
  const owns = () =>
    slots[kind] === slot && slot.generation === myGeneration && slot.controller === localController;

  const ctx: JobRunContext = {
    signal: localController.signal,
    heartbeat: () => {
      if (!owns()) return;
      slot.lastProgressAt = Date.now();
      _emitJobHeartbeat({ kind, generation: myGeneration });
    },
    emit: (progress, detail) => {
      if (!owns()) return;
      slot.lastProgressAt = Date.now();
      const patch: Record<string, unknown> = { progress };
      if (detail !== undefined) patch.detail = detail;
      patchJobSlice(kind, patch);
      _emitJobHeartbeat({ kind, generation: myGeneration });
    },
    shouldYield: () => shouldYieldNow(kind, myGeneration),
    saveCheckpoint: async (checkpoint) => {
      await saveDurableCheckpoint(kind, checkpoint);
    },
  };

  try {
    await descriptor!.onStart(options as never, {
      resumed: runtimeOptions.resumed === true,
      checkpoint: runtimeOptions.checkpoint,
    });
    patchJobSlice(kind, {
      phase: 'running',
      failure: null,
      hasResult: false,
      startedAt: slot.startedAt,
      resultRoute: null,
    });

    let checkpoint = runtimeOptions.checkpoint ?? descriptor!.initialCheckpoint(options as never);

    for (const step of descriptor!.steps) {
      while (!step.isDone(checkpoint as never)) {
        if (localController.signal.aborted) {
          outcome = 'cancelled';
          return;
        }
        checkpoint = await step.run(ctx, checkpoint as never);
        await ctx.saveCheckpoint(checkpoint);
        ctx.heartbeat();
        if (ctx.shouldYield()) {
          // The breadcrumb survives; the next resume picks up right here.
          outcome = 'suspended';
          return;
        }
      }
    }

    outcome = localController.signal.aborted ? 'cancelled' : 'completed';
  } catch (error) {
    outcome = 'failed';
    failureError = error;
    if (__DEV__) console.warn(`[jobRuntime] ${kind} failed:`, error);
  } finally {
    // Only the generation that still owns the slot may release it: a
    // cancel-then-restart advances `generation` past ours, and a user-change
    // reset replaces the slot object outright.
    if (owns()) {
      _setJobRunning(kind, false);
      slot.controller = null;
      if (outcome !== 'suspended') {
        await clearDurableJob(kind).catch(() => {});
      }
      // Drivers hear the settle BEFORE the owner's hook and before the drain,
      // so a held OS lease is released (or re-titled) on a fact the runtime
      // owns. A cancel that already emitted for this generation is a no-op.
      emitSettledOnce(kind, slot, myGeneration, outcome);
      try {
        await descriptor!.onSettle(outcome, options as never, failureError);
      } catch (settleError) {
        if (__DEV__) console.warn(`[jobRuntime] ${kind} onSettle threw:`, settleError);
      }
      if (outcome === 'suspended') {
        // A yield means the process is about to stop executing; the queued
        // job stays `waiting` and the next foreground's resume starts it
        // (`jobResume`). Draining here would hand a background lease to a job
        // the driver could not have acquired one for.
        emitIdleIfQuiet();
      } else {
        drainQueue();
      }
    } else {
      // We lost the slot to a cancel/restart or a reset; those paths already
      // released the lock and settled the drivers. The owner still hears it.
      try {
        await descriptor!.onSettle(outcome, options as never, failureError);
      } catch (settleError) {
        if (__DEV__) console.warn(`[jobRuntime] ${kind} onSettle threw:`, settleError);
      }
    }
  }
}

/**
 * Start the waiting job if nothing is running, then tell drivers when the
 * runtime is idle. `onIdle` fires after EVERY drain attempt that leaves
 * nothing running or waiting — including one whose queued start failed on its
 * durable write — so a driver ends its lease on a fact the runtime owns rather
 * than inferring it from a settle.
 */
function drainQueue(): void {
  if (isAnyLibraryJobRunning()) return;
  if (!queued) {
    _emitJobIdle();
    return;
  }
  const next = queued;
  queued = null;
  startJob(next.kind, next.options)
    .then((result) => {
      if (result.status !== 'started') emitIdleIfQuiet();
    })
    .catch(() => {
      emitIdleIfQuiet();
    });
}

// ---------------------------------------------------------------------------
// Cancel / fail
// ---------------------------------------------------------------------------

export function cancelJob(kind: LibraryJobKind): void {
  const slot = slots[kind];
  const wasRunning = slot.controller !== null;
  slot.controller?.abort();
  slot.controller = null;
  _setJobRunning(kind, false);
  slot.startedAt = null;
  slot.lastOptions = null;
  if (queued?.kind === kind) queued = null;
  // Synchronous, BEFORE the in-flight step notices the abort: a driver holding
  // an OS lease must drop it now, not up to 90 s from now when a classification
  // call returns.
  if (wasRunning) emitSettledOnce(kind, slot, slot.generation, 'cancelled');
  // Kick off the metadata clear without awaiting it, but keep the promise so
  // resume can await it — a fast cancel + foreground bounce would otherwise
  // read a stale breadcrumb and resurrect the job.
  slot.cancelInFlight = clearDurableJob(kind).finally(() => {
    slot.cancelInFlight = null;
  });
  resetJobSlice(kind);
  drainQueue();
}

/**
 * Surface a failure without going through the loop's error path. Used by
 * stuck detection and by resume gates that trip.
 */
export function markJobFailed(kind: LibraryJobKind, failure: JobFailure): void {
  const slot = slots[kind];
  const wasRunning = slot.controller !== null;
  if (slot.controller) {
    slot.controller.abort();
    slot.controller = null;
  }
  _setJobRunning(kind, false);
  if (wasRunning) emitSettledOnce(kind, slot, slot.generation, 'failed');
  void clearDurableJob(kind).catch(() => {});
  patchJobSlice(kind, {
    phase: 'failed',
    progress: null,
    failure,
    hasResult: false,
  });
  drainQueue();
}

/** Publish a progress snapshot from outside a step (rare; prefer `ctx.emit`). */
export function publishProgress(kind: LibraryJobKind, progress: JobProgress | null): void {
  slots[kind].lastProgressAt = Date.now();
  patchJobSlice(kind, { progress });
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/** Sign-out / account switch: abort everything and drop all state. */
export async function resetAllForUserChange(): Promise<void> {
  let resolveReset: () => void = () => {};
  const previous = resetInFlight;
  resetInFlight = new Promise<void>((resolve) => {
    resolveReset = resolve;
  });
  try {
    if (previous) await previous;
    queued = null;
    for (const kind of Object.keys(slots) as LibraryJobKind[]) {
      const slot = slots[kind];
      const wasRunning = slot.controller !== null;
      slot.controller?.abort();
      slots[kind] = newSlot();
      _setJobRunning(kind, false);
      if (wasRunning) emitSettledOnce(kind, slot, slot.generation, 'cancelled');
      await clearDurableJob(kind).catch(() => {});
    }
    // The store is part of "all state": leaving a completed slice behind would
    // show user B a bar for user A's finished job.
    resetLibraryJobStore();
    // Always leaves nothing running or waiting.
    _emitJobIdle();
  } finally {
    resolveReset();
    resetInFlight = null;
  }
}

/** Read the durable breadcrumb without starting anything. */
export { readDurableJob };

/** Test-only. */
export function __resetRuntimeForTesting(): void {
  queued = null;
  foregroundEventInFlight = null;
  resetInFlight = null;
  for (const kind of Object.keys(slots) as LibraryJobKind[]) {
    slots[kind] = newSlot();
    _setJobRunning(kind, false);
  }
}
