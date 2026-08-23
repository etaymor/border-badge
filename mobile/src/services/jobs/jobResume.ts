/**
 * jobResume - Foreground auto-resume and stuck detection for library jobs.
 *
 * Generalizes the former `photoScanResume`. On app foreground (or another safe
 * trigger) this checks, for every registered job kind, whether a suspended run
 * should be picked up. Universal preconditions are handled here; job-specific
 * ones come from `descriptor.gates`.
 *
 * "Resume" means: the job stopped executing — iOS froze or suspended the
 * process, a continued-processing lease expired and the loop yielded, or a
 * BGProcessingTask ran out of time — the user reopened the app, and we
 * continue from the last durable checkpoint. OS-level execution while the app
 * is away exists in three tiers (see `docs/photo-import.md`, "Library job
 * runtime and continuation"), but only the iOS 26 continued-processing lease
 * is something a user can rely on, and the copy says so only while that lease
 * is actually running. This module is the layer underneath all of them.
 */

import { allDescriptors, getDescriptor } from './jobRegistry';
import { clearDurableJob, readDurableJob } from './jobDurableFlag';
import {
  getCancelInFlight,
  getLastProgressAt,
  getQueuedJob,
  isAnyLibraryJobRunning,
  isJobRunning,
  markJobFailed,
  startJob,
} from './jobRuntime';
import type { GateOutcome, LibraryJobKind } from './jobTypes';
import { Analytics } from '@services/analytics';
import { useLibraryJobStore } from '@stores/libraryJobStore';

/**
 * Job owners register themselves as a side effect of being imported. Doing
 * that lazily here — rather than with a static import at the app root — keeps
 * each pipeline's module graph out of startup; resume is the first moment a
 * descriptor is actually needed.
 */
let registrationPromise: Promise<unknown> | null = null;

async function ensureJobsRegistered(): Promise<void> {
  if (!registrationPromise) {
    registrationPromise = Promise.resolve().then(() => {
      for (const load of [
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        () => require('@services/photoImport/photoScanService'),
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        () => require('@services/quiz/quizBuildJob'),
      ]) {
        try {
          load();
        } catch {
          // A pipeline that cannot load must not break resume for the others.
        }
      }
    });
  }
  await registrationPromise;
}

export type ResumeOutcome =
  | { status: 'started' }
  | { status: 'skipped'; reason: 'no-flag' | 'already-running' | 'other-job-running' | 'deferred' }
  | { status: 'failed-gate'; gateId: string };

/**
 * Try to resume every registered job. Jobs are mutually exclusive, so at most
 * one actually starts; the rest report `other-job-running` and will be picked
 * up on a later foreground (or by the runtime's queue drain).
 */
export async function tryResumeJobs(): Promise<Record<string, ResumeOutcome>> {
  await ensureJobsRegistered();
  const results: Record<string, ResumeOutcome> = {};
  for (const descriptor of allDescriptors()) {
    results[descriptor.kind] = await tryResumeJob(descriptor.kind);
  }
  await resumeWaitingJob();
  return results;
}

/**
 * Start the job left `waiting` behind a peer that is no longer running.
 *
 * The runtime drains its queue when the running job settles — EXCEPT when it
 * settled `suspended`, because a yield means the process is about to stop
 * executing and a job started then could never have acquired a lease. So a
 * waiting job whose peer suspended (or whose peer's breadcrumb was cleared by
 * a gate while the app was away) is the foreground's to start, and it goes
 * through the same serialized `resumed` path as everything else here.
 */
async function resumeWaitingJob(): Promise<void> {
  if (isAnyLibraryJobRunning()) return;
  const waiting = getQueuedJob();
  if (!waiting) return;
  await startJob(waiting.kind, waiting.options, { resumed: true });
}

export async function tryResumeJob(kind: LibraryJobKind): Promise<ResumeOutcome> {
  const descriptor = getDescriptor(kind);
  if (!descriptor) return { status: 'skipped', reason: 'no-flag' };

  // A recent cancel kicked off async breadcrumb clearing without awaiting it.
  // Await it before reading, or a fast cancel + foreground bounce reads the
  // stale record and resurrects the job.
  const pendingCancel = getCancelInFlight(kind);
  if (pendingCancel) await pendingCancel;

  if (isJobRunning(kind)) return { status: 'skipped', reason: 'already-running' };

  const record = await readDurableJob(kind);
  if (!record) return { status: 'skipped', reason: 'no-flag' };

  // Staleness is checked before the other job's lock so a dead breadcrumb is
  // cleared promptly rather than lingering behind a long-running sibling.
  // Measured from the LAST CHECKPOINT, not the start: a job that has been
  // checkpointing for 40 minutes is long, not dead. Legacy records without the
  // field fall back to `startedAt`.
  const freshestAt = Math.max(record.startedAt, record.lastCheckpointAt ?? 0);
  if (Date.now() - freshestAt > descriptor.stalenessMs) {
    await clearDurableJob(kind);
    markJobFailed(kind, {
      reason: 'stale',
      title: 'Scan Stopped',
      message: 'The previous scan was interrupted. Tap to start over.',
    });
    Analytics.jobResumeGateHit({ kind, gateId: 'staleness' });
    return { status: 'failed-gate', gateId: 'staleness' };
  }

  if (isAnyLibraryJobRunning()) {
    return { status: 'skipped', reason: 'other-job-running' };
  }

  for (const gate of descriptor.gates) {
    let outcome: GateOutcome;
    try {
      outcome = await gate.check(kind, record);
    } catch {
      // A throwing gate must not clear a good breadcrumb; defer instead.
      return { status: 'skipped', reason: 'deferred' };
    }
    if (outcome.status === 'defer') return { status: 'skipped', reason: 'deferred' };
    if (outcome.status === 'fail') {
      await clearDurableJob(kind);
      markJobFailed(kind, outcome.failure);
      Analytics.jobResumeGateHit({ kind, gateId: gate.id });
      return { status: 'failed-gate', gateId: gate.id };
    }
  }

  const result = await startJob(kind, record.options, {
    resumed: true,
    checkpoint: record.checkpoint,
  });
  if (result.status === 'started') return { status: 'started' };
  return { status: 'skipped', reason: 'already-running' };
}

/**
 * Surface a `failed` state when a job is supposedly running but hasn't made
 * progress for its descriptor's threshold. Safe to call on any tick.
 *
 * Only a job the runtime is ACTUALLY running can be stuck. A `running` slice
 * whose kind is not `isJobRunning` is a suspended job — the loop yielded
 * between units (lease expiry, background task) and kept the breadcrumb — and
 * it belongs to `tryResumeJobs`, not here. Callers stamp `markForegroundReturn`
 * before this on foreground, so time the process spent frozen is not counted
 * as silence either.
 *
 * This is only correct if long-running steps call `ctx.heartbeat()`. A step
 * that can exceed the threshold between checkpoints without a heartbeat will
 * be killed while perfectly healthy.
 */
export function detectStuckJobs(): LibraryJobKind[] {
  const stuck: LibraryJobKind[] = [];
  const state = useLibraryJobStore.getState();
  for (const descriptor of allDescriptors()) {
    const kind = descriptor.kind;
    if (state.jobs[kind].phase !== 'running') continue;
    if (!isJobRunning(kind)) continue;
    const lastAt = getLastProgressAt(kind);
    if (lastAt === 0) continue; // Just started; no progress yet is fine.
    if (Date.now() - lastAt <= descriptor.stuckThresholdMs) continue;
    markJobFailed(kind, {
      reason: 'stuck',
      title: 'Scan Stopped',
      message: 'The scan stopped making progress. Tap to retry.',
    });
    stuck.push(kind);
  }
  return stuck;
}
