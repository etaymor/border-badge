/**
 * photoScanService - The trip scan, registered as a library job.
 *
 * Scan ownership lives here rather than in the screen, so the scan survives
 * in-app navigation and auto-resumes on next foreground after iOS suspends the
 * JS runtime. What changed when the runtime landed is WHO owns the machinery:
 * the atomic start lock, the durable breadcrumb, the generation guard, the
 * foreground-event serializer and the resume gates all moved to
 * `services/jobs`, which the quiz build shares. This module is now the
 * descriptor (what the scan needs) plus the public API its callers already
 * knew; the pass itself is `photoScanSteps.runScanPass`.
 *
 * Heavyweight result Maps (5-10MB for large libraries) live on a module-level
 * ref here, NOT in Zustand. Callers retrieve them via `consumeResult()`, which
 * atomically returns and clears.
 */

import { Analytics } from '@services/analytics';

import { registerJob } from '@services/jobs/jobRegistry';
import {
  cancelJob,
  getCancelInFlight as getRuntimeCancelInFlight,
  getJobStartedAt,
  getLastOptions,
  getLastProgressAt as getRuntimeLastProgressAt,
  markJobFailed,
  resetAllForUserChange,
  startJob,
} from '@services/jobs/jobRuntime';
import {
  homeCountryGate,
  mediaLibraryPermissionGate,
  subscriptionGate,
} from '@services/jobs/jobGates';
import { isScanRunning } from '@services/jobs/jobRuntimeState';
import type { JobFailure } from '@services/jobs/jobTypes';
import { patchJobSlice, type TripScanDetail } from '@stores/libraryJobStore';

import { abortBackgroundSync } from './photoBackgroundSync';
import { abortTaggingPass } from './photoTaggingService';
import { recordSyncError, recordSyncSuccess } from './photoLibrarySyncStatus';
import { runScanPass } from './photoScanSteps';
import { isAlertScanFailure } from './photoScanTypes';
import type {
  PhotoScanFailure,
  PhotoScanResult,
  PhotoScanStartOptions,
  PhotoScanStartResult,
} from './photoScanTypes';

export type {
  PhotoScanFailure,
  PhotoScanFailureReason,
  PhotoScanResult,
  PhotoScanStartOptions,
  PhotoScanStartResult,
} from './photoScanTypes';
export { isAlertScanFailure } from './photoScanTypes';

/** The trip scan's checkpoint. The pass has no resumable midpoint — see photoScanSteps. */
interface ScanCheckpoint {
  done: boolean;
}

const EMPTY_DETAIL: TripScanDetail = { discoveredCountries: [], isIncremental: false };

// ---------------------------------------------------------------------------
// Module-level state — the heavyweight result only. Everything the runtime can
// own (lock, generation, start time, durable flag) now lives in `jobRuntime`.
// ---------------------------------------------------------------------------

let lastResult: PhotoScanResult | null = null;

/**
 * The options the running pass is working from, plus whether the runtime
 * started it as a resume. The step needs both and the runtime hands options
 * only to `onStart` / `initialCheckpoint`, so `onStart` parks them here.
 *
 * Safe as a module singleton because at most one trip scan runs at a time —
 * the same invariant the in-memory writer lock is built on.
 */
let currentRun: { opts: PhotoScanStartOptions; resumed: boolean } | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export { isScanRunning };

export function hasResult(): boolean {
  return lastResult !== null;
}

export function getScanStartedAt(): number | null {
  return getJobStartedAt('trip-scan');
}

export function getLastStartOptions(): PhotoScanStartOptions | null {
  return (getLastOptions('trip-scan') as PhotoScanStartOptions | null) ?? null;
}

export function getCancelInFlight(): Promise<void> | null {
  return getRuntimeCancelInFlight('trip-scan');
}

export function getLastProgressAt(): number {
  return getRuntimeLastProgressAt('trip-scan');
}

/**
 * Atomically take ownership of the last scan result and clear the ref.
 * Idempotent: a second call returns null.
 */
export function consumeResult(): PhotoScanResult | null {
  const result = lastResult;
  lastResult = null;
  if (result) patchJobSlice('trip-scan', { hasResult: false });
  return result;
}

/**
 * Cancel the running scan, if any. The runtime clears the durable breadcrumb
 * and resets the slice to idle; this drops the heavyweight result so a
 * sign-out-style cancel cannot leak data through a later `consumeResult()`.
 */
export function cancelScan(): void {
  if (isScanRunning()) {
    // Only emit the cancelled analytic when there was actually a scan to cancel.
    Analytics.photoImportScanCancelled();
  }
  lastResult = null;
  cancelJob('trip-scan');
}

/**
 * Mark the current scan as failed. Used by stuck detection and by gate
 * failures during auto-resume.
 */
export function markFailed(failure: PhotoScanFailure): void {
  lastResult = null;
  markJobFailed('trip-scan', failure);
  // P1: leave a trace in the shared sync status (fire-and-forget).
  void recordSyncError('trip-scan', failure.message || failure.reason || 'scan failed');
}

/**
 * Start a scan, or report why it cannot start.
 *
 * `homeCountry` is the one precondition the runtime cannot check for us: it is
 * an argument, not ambient state, so it is verified here before the job is
 * handed over.
 */
export async function startScan(opts: PhotoScanStartOptions): Promise<PhotoScanStartResult> {
  if (!opts.homeCountry) {
    return { status: 'rejected', reason: 'no-home-country' };
  }

  const result = await startJob('trip-scan', opts, { resumed: opts.resumed });
  if (result.status === 'queued') {
    return { status: 'queued', blockedBy: 'quiz-build' };
  }
  if (result.status === 'rejected') {
    return { status: 'rejected', reason: 'no-permission' };
  }
  return result;
}

/**
 * Reset all scan state for a user identity change. The runtime aborts the run
 * and clears the breadcrumb; this nulls the heavyweight result so user A's
 * photo data cannot leak to user B after sign-out / account switch.
 */
export async function resetForUserChange(): Promise<void> {
  lastResult = null;
  currentRun = null;
  await resetAllForUserChange();
}

// ---------------------------------------------------------------------------
// Descriptor
// ---------------------------------------------------------------------------

function publishFailure(failure: JobFailure): void {
  lastResult = null;
  patchJobSlice('trip-scan', {
    phase: 'failed',
    progress: null,
    failure,
    hasResult: false,
  });
  // P1: leave a trace in the shared sync status (fire-and-forget).
  void recordSyncError('trip-scan', failure.message || failure.reason || 'scan failed');
}

registerJob<ScanCheckpoint, PhotoScanStartOptions>({
  kind: 'trip-scan',

  steps: [
    {
      id: 'scan',
      isDone: (c) => c.done,
      run: async (ctx, _c) => {
        const run = currentRun ?? { opts: { homeCountry: null }, resumed: false };
        const outcome = await runScanPass(ctx, { ...run.opts, resumed: run.resumed });

        if (outcome.status === 'failed') {
          publishFailure(outcome.failure);
          return { done: true };
        }
        if (outcome.status === 'cancelled') {
          // `cancelScan` / the runtime already reset the slice. Publishing
          // anything here would paint over an idle state the user asked for.
          return { done: true };
        }

        lastResult = outcome.result;
        patchJobSlice('trip-scan', {
          phase: 'completed',
          hasResult: true,
          failure: null,
        });
        // P1: a completed trip scan makes the shared cache fresh for everyone
        // (e.g. the next quiz creation skips its scan). Fire-and-forget.
        void recordSyncSuccess('trip-scan', outcome.result.newPhotosCount ?? 0);
        return { done: true };
      },
    },
  ],

  initialCheckpoint: () => ({ done: false }),

  /**
   * The trip scan gets the full set. Unlike the quiz build it IS metered
   * (`FREE_LIMITS.photoImport`) and it CANNOT run without a home country —
   * segmentation filters by it rather than merely deprioritizing it.
   */
  gates: [mediaLibraryPermissionGate, homeCountryGate, subscriptionGate],

  /** Unchanged from the pre-runtime `RESUME_STALENESS_MS`. */
  stalenessMs: 60 * 60 * 1000,

  /** Unchanged from the pre-runtime `STUCK_SCAN_THRESHOLD_MS`. */
  stuckThresholdMs: 5 * 60 * 1000,

  autoDismissMs: 30_000,

  /**
   * True: the scan's result is cheap to recompute from the SQLite cache, so
   * letting the banner expire may also drop it. (Contrast `quiz-build`, where
   * dismissing would discard a built challenge.)
   */
  consumeOnDismiss: true,

  onStart: (options, info) => {
    // Stop any background sync to avoid interleaved cache writes, and stop
    // opportunistic tagging — the scan owns the device from here.
    abortBackgroundSync();
    abortTaggingPass();
    lastResult = null;
    // `info.resumed` is the only place a continuation is distinguishable from
    // a fresh start, and a resume must never honor `forceRefresh` — that would
    // wipe the cache the interrupted pass had already filled.
    currentRun = { opts: options ?? { homeCountry: null }, resumed: info.resumed };
    // `progress` is cleared here, not by the runtime: a resumed pass restarts
    // its counters from zero, and leaving the previous run's numbers up would
    // show a bar that appears to jump backwards on the first emit.
    patchJobSlice('trip-scan', { progress: null, detail: { ...EMPTY_DETAIL } });
  },

  onSettle: (outcome) => {
    if (outcome === 'suspended' || outcome === 'cancelled') return;
    if (outcome === 'failed') {
      // The step maps every failure it can name; reaching here means it threw
      // outside its own try/catch.
      publishFailure({
        reason: 'scan-error',
        title: 'Scan Failed',
        message: 'Failed to scan photos. Please try again.',
      });
    }
  },

  isAlertFailure: isAlertScanFailure,
});

/**
 * Test-only helper: drop the heavyweight result. Runtime state is reset with
 * `__resetRuntimeForTesting`. NOT exported from the package index; tests reach
 * in via the file path.
 */
export function __resetForTesting(): void {
  lastResult = null;
  currentRun = null;
}
