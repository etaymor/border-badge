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
 * THE BACKGROUND-TASK SEAM. The `while (!step.isDone(...))` loop below lives
 * here rather than inside a job body, and a checkpoint is written after every
 * step. `ctx.shouldYield()` reads `jobRuntimeState.shouldYieldNow()`, which is
 * a constant `false` in the foreground — a user watching a build wants it to
 * finish, and there is no budget to run out of. `backgroundJobTask` installs a
 * real provider backed by an iOS BGProcessingTask expiration handler, and
 * because the checkpoint is already durable at every step boundary, that is
 * purely additive: NO JOB BODY CHANGED to make it work.
 */

import {
  clearDurableJob,
  readDurableJob,
  saveDurableCheckpoint,
  writeDurableJob,
} from './jobDurableFlag';
import { getDescriptor } from './jobRegistry';
import {
  _setJobRunning,
  getRunningJobKind,
  isAnyLibraryJobRunning,
  isJobRunning,
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

interface RuntimeSlot {
  controller: AbortController | null;
  generation: number;
  startedAt: number | null;
  lastProgressAt: number;
  cancelInFlight: Promise<void> | null;
  lastOptions: unknown;
  /** Settles when the current run ends (completed, cancelled, or suspended). */
  runPromise: Promise<void> | null;
}

function newSlot(): RuntimeSlot {
  return {
    controller: null,
    generation: 0,
    startedAt: null,
    lastProgressAt: 0,
    cancelInFlight: null,
    lastOptions: null,
    runPromise: null,
  };
}

const slots: Record<LibraryJobKind, RuntimeSlot> = {
  'trip-scan': newSlot(),
  'quiz-build': newSlot(),
};

/**
 * Serializes `resumed` starts so rapid app-switcher bounces can't double-fire.
 * Module-global rather than per-kind: one foreground event drives every kind.
 */
let foregroundEventInFlight: Promise<void> | null = null;

/** Queue depth 1. Holds the job that asked to run while another one held the cache. */
let queued: { kind: LibraryJobKind; options: unknown } | null = null;

// ---------------------------------------------------------------------------
// Introspection (used by resume gates and stuck detection)
// ---------------------------------------------------------------------------

export function getJobStartedAt(kind: LibraryJobKind): number | null {
  return slots[kind].startedAt;
}

export function getLastProgressAt(kind: LibraryJobKind): number {
  return slots[kind].lastProgressAt;
}

export function getCancelInFlight(kind: LibraryJobKind): Promise<void> | null {
  return slots[kind].cancelInFlight;
}

export function getLastOptions(kind: LibraryJobKind): unknown {
  return slots[kind].lastOptions;
}

/**
 * Settles when the running job ends, or immediately when none is running.
 *
 * Only the background task needs this. In the foreground a job outliving its
 * caller is the whole point; under a BGProcessingTask the handler returning is
 * what tells iOS it may suspend the app again, so it has to wait.
 */
export function whenJobSettles(kind: LibraryJobKind): Promise<void> {
  return slots[kind].runPromise ?? Promise.resolve();
}

export { isJobRunning, isAnyLibraryJobRunning };

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
      return await runStart(kind, options, runtimeOptions);
    } finally {
      resolveForeground();
      foregroundEventInFlight = null;
    }
  }
  return runStart(kind, options, runtimeOptions);
}

async function runStart(
  kind: LibraryJobKind,
  options: unknown,
  runtimeOptions: StartJobOptions
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
  const myGeneration = ++slot.generation;
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
    _setJobRunning(kind, false);
    slot.controller = null;
    slot.startedAt = null;
    slot.lastOptions = null;
    throw error;
  }

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

  const ctx: JobRunContext = {
    signal: localController.signal,
    heartbeat: () => {
      slot.lastProgressAt = Date.now();
    },
    emit: (progress, detail) => {
      slot.lastProgressAt = Date.now();
      const patch: Record<string, unknown> = { progress };
      if (detail !== undefined) patch.detail = detail;
      patchJobSlice(kind, patch);
    },
    shouldYield: shouldYieldNow,
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
    // cancel-then-restart advances `generation` past ours.
    if (slot.generation === myGeneration) {
      _setJobRunning(kind, false);
      slot.controller = null;
      if (outcome !== 'suspended') {
        await clearDurableJob(kind).catch(() => {});
      }
      try {
        await descriptor!.onSettle(outcome, options as never, failureError);
      } catch (settleError) {
        if (__DEV__) console.warn(`[jobRuntime] ${kind} onSettle threw:`, settleError);
      }
      drainQueue();
    }
  }
}

function drainQueue(): void {
  if (!queued || isAnyLibraryJobRunning()) return;
  const next = queued;
  queued = null;
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  startJob(next.kind, next.options).catch(() => {});
}

// ---------------------------------------------------------------------------
// Cancel / fail
// ---------------------------------------------------------------------------

export function cancelJob(kind: LibraryJobKind): void {
  const slot = slots[kind];
  slot.controller?.abort();
  slot.controller = null;
  _setJobRunning(kind, false);
  slot.startedAt = null;
  slot.lastOptions = null;
  if (queued?.kind === kind) queued = null;
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
  if (slot.controller) {
    slot.controller.abort();
    slot.controller = null;
  }
  _setJobRunning(kind, false);
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
  queued = null;
  for (const kind of Object.keys(slots) as LibraryJobKind[]) {
    const slot = slots[kind];
    slot.controller?.abort();
    slots[kind] = newSlot();
    _setJobRunning(kind, false);
    await clearDurableJob(kind).catch(() => {});
  }
  // The store is part of "all state": leaving a completed slice behind would
  // show user B a bar for user A's finished job.
  resetLibraryJobStore();
}

/** Read the durable breadcrumb without starting anything. */
export { readDurableJob };

/** Test-only. */
export function __resetRuntimeForTesting(): void {
  queued = null;
  foregroundEventInFlight = null;
  for (const kind of Object.keys(slots) as LibraryJobKind[]) {
    slots[kind] = newSlot();
    _setJobRunning(kind, false);
  }
}
