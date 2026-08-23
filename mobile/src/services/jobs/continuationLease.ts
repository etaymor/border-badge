/**
 * continuationLease - The driver that keeps a library job running after the
 * user backgrounds the app.
 *
 * Registers ONE runtime driver (`registerJobDriver`) and turns its lifecycle
 * events into a lease on the `job-continuation` native module: `begin()` when
 * a job starts in the foreground, progress pushes on every heartbeat,
 * `updateTitle()` when a queued job takes the lease over, `end()` when the
 * runtime goes idle. A native `expired` event never aborts anything — it only
 * makes `shouldYield(kind, generation)` answer yes for the leased run, and
 * only while the app is still not active at pull time (KTD3).
 *
 * SCOPE IS THE RUNTIME, NOT THE JOB (KTD4). A second job draining while
 * backgrounded cannot submit its own request (foreground-only), so the lease
 * outlives the first job and is re-titled. After an expiration, a resumed run
 * may re-acquire AT MOST ONCE per kind: system-UI cancel and system reclaim
 * are indistinguishable, and one re-acquire keeps a thermal reclaim
 * recoverable without re-showing the system UI forever to a user who cancelled
 * there.
 *
 * INERT WITHOUT THE MODULE (KTD10) and behind `enableJobContinuationLease`
 * (KTD12): `registerContinuationLease()` returns before touching anything when
 * either is false, so the bundle is safe to publish over the air onto binaries
 * that predate the module.
 *
 * Every native event carries a `leaseId` (KTD13). Events for any other lease
 * are ignored, and `expired` is idempotent per lease.
 */

import { AppState } from 'react-native';

import {
  addLeaseExpiredListener,
  addLeaseStateListener,
  backgroundRefreshStatus,
  beginLease,
  endLease,
  isJobContinuationAvailable,
  jobContinuationCapabilities,
  updateLeaseProgress,
  updateLeaseTitle,
} from '@modules/job-continuation';
import type { LeaseExpiredEvent, LeaseStateChangedEvent } from '@modules/job-continuation';

import { isExecutingInBackgroundHandler } from './backgroundJobTask';
import { ContinuationProgressMapper } from './continuationProgress';
import { continuationTitle } from './continuationTitles';
import { registerJobDriver } from './jobRuntimeState';
import type {
  JobDriver,
  JobDriverHeartbeatEvent,
  JobDriverSettleEvent,
  JobDriverStartEvent,
  JobRunOutcome,
  LibraryJobKind,
} from './jobTypes';
import { features } from '@config/features';
import { Analytics } from '@services/analytics';
import {
  publishContinuationLease,
  resetContinuationLeaseStore,
} from '@stores/continuationLeaseStore';
import { useLibraryJobStore } from '@stores/libraryJobStore';

type LeaseTier = 'continued' | 'grace';
type LeasePhase = 'pending' | 'running' | 'expired';

interface Lease {
  leaseId: string;
  tier: LeaseTier;
  phase: LeasePhase;
  kind: LibraryJobKind;
  generation: number;
  beganAt: number;
  mapper: ContinuationProgressMapper;
}

/** At most this often do we push progress to native (native throttles again). */
const PUSH_INTERVAL_MS = 250;

let lease: Lease | null = null;
let lastOutcome: JobRunOutcome | null = null;
/** Per kind: did the leased run of this kind expire since its last fresh start? */
const expiredSinceFreshStart: Record<LibraryJobKind, boolean> = {
  'trip-scan': false,
  'quiz-build': false,
};
/** Per kind: re-acquires spent since the last fresh start / terminal settle (cap 1). */
const reacquires: Record<LibraryJobKind, number> = { 'trip-scan': 0, 'quiz-build': 0 };

/** Serializes every native call so `end()` always lands before a later `begin()`. */
let nativeQueue: Promise<void> = Promise.resolve();
function enqueue(task: () => Promise<void>): Promise<void> {
  nativeQueue = nativeQueue.then(task, task);
  return nativeQueue;
}

let pushTimer: ReturnType<typeof setTimeout> | null = null;
let lastPushAt = 0;
let removeDriver: (() => void) | null = null;
let removeListeners: Array<() => void> = [];
let registered = false;
let capabilitiesTracked = false;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function appIsActive(): boolean {
  return AppState.currentState === 'active';
}

function publishStore(): void {
  if (!lease) {
    publishContinuationLease({ phase: 'idle', tier: 'none', kind: null });
    return;
  }
  publishContinuationLease({ phase: lease.phase, tier: lease.tier, kind: lease.kind });
}

function currentPercentage(): number {
  if (!lease) return 0;
  const { completed, total } = lease.mapper.current();
  return total > 0 ? Math.round((completed / total) * 100) : 0;
}

/** Push the mapper's value to native, coalesced to one push per interval. */
function schedulePush(): void {
  if (!lease || lease.phase === 'expired') return;
  const now = Date.now();
  const elapsed = now - lastPushAt;
  if (elapsed >= PUSH_INTERVAL_MS) {
    pushNow();
    return;
  }
  if (pushTimer) return;
  pushTimer = setTimeout(() => {
    pushTimer = null;
    pushNow();
  }, PUSH_INTERVAL_MS - elapsed);
}

function pushNow(): void {
  if (!lease || lease.phase === 'expired') return;
  lastPushAt = Date.now();
  const { completed, total } = lease.mapper.current();
  updateLeaseProgress(completed, total);
}

function clearPushTimer(): void {
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
}

/** Drop the lease: end it natively (queued) and forget it. */
function dropLease(success: boolean, outcome: string): void {
  const ending = lease;
  lease = null;
  clearPushTimer();
  publishStore();
  if (!ending) return;
  Analytics.leaseEnded({
    tier: ending.tier,
    kind: ending.kind,
    outcome,
    elapsedMs: Date.now() - ending.beganAt,
  });
  void enqueue(() => endLease(success));
}

// ---------------------------------------------------------------------------
// Runtime driver
// ---------------------------------------------------------------------------

function onStarted(event: JobDriverStartEvent): void {
  const { kind, generation, resumed, foregroundAtCall } = event;

  if (!resumed) {
    // A fresh user start resets the per-kind re-acquire budget (KTD4).
    reacquires[kind] = 0;
    expiredSinceFreshStart[kind] = false;
  }

  if (lease && lease.phase !== 'expired') {
    // Queue drain or overlap: the lease is held per runtime. Re-title it and
    // restart progress for the new job (R4, R5).
    lease.kind = kind;
    lease.generation = generation;
    lease.mapper.reset(kind);
    const { title, subtitle } = continuationTitle(kind, null);
    void enqueue(async () => updateLeaseTitle(title, subtitle));
    publishStore();
    pushNow();
    return;
  }

  let skippedReason: string | null = null;
  if (isExecutingInBackgroundHandler()) skippedReason = 'bg-handler';
  else if (!foregroundAtCall) skippedReason = 'not-foreground';
  else if (resumed && expiredSinceFreshStart[kind]) {
    if (reacquires[kind] >= 1) skippedReason = 'reacquire-cap';
    else reacquires[kind] += 1;
  }

  const capabilities = jobContinuationCapabilities();
  const lowPowerMode = capabilities.lowPowerMode ?? null;

  if (skippedReason) {
    Analytics.leaseBegin({
      tier: 'none',
      kind,
      resumed,
      lowPowerMode,
      backgroundRefreshStatus: null,
      skippedReason,
    });
    return;
  }

  const { title, subtitle } = continuationTitle(kind, null);
  const mapper = new ContinuationProgressMapper(kind);
  // Claimed synchronously, so a settle/idle that lands before `begin()`
  // resolves still sees a lease to end, and a second start re-titles it.
  const claimed: Lease = {
    leaseId: '',
    tier: 'grace',
    phase: 'pending',
    kind,
    generation,
    beganAt: Date.now(),
    mapper,
  };
  lease = claimed;
  publishStore();

  void enqueue(async () => {
    if (lease !== claimed) return; // ended (or replaced) before we got here
    const result = await beginLease({ title, subtitle });
    if (lease !== claimed) {
      // Idle arrived mid-begin. The queued `end()` behind us closes it.
      return;
    }
    if (result.state === 'unavailable') {
      lease = null;
      publishStore();
      return;
    }
    claimed.leaseId = result.leaseId;
    if (result.state === 'pending' || result.state === 'already-running') {
      claimed.tier = 'continued';
      claimed.phase = 'pending';
    } else {
      // grace-only: the window is all we get; treat it as running now.
      claimed.tier = 'grace';
      claimed.phase = 'running';
    }
    publishStore();
    const refresh = await backgroundRefreshStatus();
    Analytics.leaseBegin({
      tier: claimed.tier,
      kind,
      resumed,
      lowPowerMode,
      backgroundRefreshStatus: refresh,
      skippedReason: result.reason ?? null,
    });
  });
}

function onHeartbeat(event: JobDriverHeartbeatEvent): void {
  if (!lease || lease.phase === 'expired') return;
  if (lease.kind !== event.kind || lease.generation !== event.generation) return;
  const progress = useLibraryJobStore.getState().jobs[event.kind].progress;
  if (progress) lease.mapper.update(progress.phase, progress.percentage);
  lease.mapper.heartbeat();
  schedulePush();
}

function onSettled(event: JobDriverSettleEvent): void {
  lastOutcome = event.outcome;
  if (event.outcome !== 'suspended') {
    // A terminal settle resets the re-acquire budget for that kind (KTD4).
    reacquires[event.kind] = 0;
    expiredSinceFreshStart[event.kind] = false;
  }
  if (
    lease &&
    lease.phase !== 'expired' &&
    lease.kind === event.kind &&
    lease.generation === event.generation &&
    event.outcome === 'completed'
  ) {
    lease.mapper.complete();
    clearPushTimer();
    pushNow();
  }
  // `onSettled` alone never ends the lease: a queued job may take it over.
}

function onIdle(): void {
  if (!lease) return;
  const outcome = lastOutcome ?? 'unknown';
  dropLease(lastOutcome === 'completed', outcome);
  lastOutcome = null;
}

function shouldYield(kind: LibraryJobKind, generation: number): boolean {
  if (!lease || lease.phase !== 'expired') return false;
  if (lease.kind !== kind || lease.generation !== generation) return false;
  if (appIsActive()) {
    // The user came back before the next unit boundary: keep the job running
    // in-app instead of stranding it suspended (KTD3).
    dropLease(false, 'expired-then-active');
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Native events
// ---------------------------------------------------------------------------

function onNativeStateChanged(event: LeaseStateChangedEvent): void {
  if (!lease || lease.leaseId !== event.leaseId || lease.phase !== 'pending') return;
  if (event.state !== 'running') return;
  lease.phase = 'running';
  lease.tier = 'continued';
  publishStore();
  Analytics.leaseHandlerFired({ kind: lease.kind, latencyMs: Date.now() - lease.beganAt });
  pushNow();
}

function onNativeExpired(event: LeaseExpiredEvent): void {
  if (!lease || lease.leaseId !== event.leaseId) return;
  if (lease.phase === 'expired') return; // idempotent: continued then grace
  const expiring = lease;
  Analytics.leaseExpired({
    tier: event.tier,
    kind: expiring.kind,
    appState: AppState.currentState,
    elapsedMs: Date.now() - expiring.beganAt,
    percentage: currentPercentage(),
  });

  if (event.tier === 'grace') {
    // The grace window ending does NOT request a yield (KTD3): iOS is about
    // to freeze the process, and a frozen process that survives continues
    // exactly where it was on the next foreground. The trip scan is one unit,
    // so a yield could not stop it anyway. If a continued-processing request
    // is still pending, the lease stays — its handler may yet fire. Otherwise
    // the lease has nothing left to hold and is dropped.
    if (expiring.tier === 'grace') dropLease(false, 'grace-expired');
    return;
  }

  expiring.phase = 'expired';
  expiredSinceFreshStart[expiring.kind] = true;
  clearPushTimer();
  if (appIsActive()) {
    // An expiration while the user is looking at the app just drops the lease.
    dropLease(false, 'expired-active');
    return;
  }
  publishStore();
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Wire the driver. Call once at app start, right after
 * `registerBackgroundJobTask()`. Fires `job_continuation_capabilities` once per
 * launch regardless of the flag, then returns without registering anything
 * when the flag is off or the module is absent.
 */
export function registerContinuationLease(): void {
  if (!capabilitiesTracked) {
    capabilitiesTracked = true;
    const capabilities = jobContinuationCapabilities();
    Analytics.jobContinuationCapabilities({
      moduleAvailable: isJobContinuationAvailable(),
      continuedProcessing: capabilities.continuedProcessing,
      graceWindow: capabilities.graceWindow,
      osMajor: capabilities.osMajor ?? null,
      flagEnabled: features.enableJobContinuationLease,
    });
  }
  if (registered) return;
  if (!features.enableJobContinuationLease) return;
  if (!isJobContinuationAvailable()) return;
  registered = true;

  const driver: JobDriver = { onStarted, onHeartbeat, onSettled, onIdle, shouldYield };
  removeDriver = registerJobDriver(driver);
  removeListeners = [
    addLeaseStateListener(onNativeStateChanged),
    addLeaseExpiredListener(onNativeExpired),
  ];
}

/** Test-only. */
export function __resetContinuationLeaseForTesting(): void {
  removeDriver?.();
  removeDriver = null;
  for (const remove of removeListeners) remove();
  removeListeners = [];
  registered = false;
  capabilitiesTracked = false;
  lease = null;
  lastOutcome = null;
  clearPushTimer();
  lastPushAt = 0;
  nativeQueue = Promise.resolve();
  for (const kind of Object.keys(reacquires) as LibraryJobKind[]) {
    reacquires[kind] = 0;
    expiredSinceFreshStart[kind] = false;
  }
  resetContinuationLeaseStore();
}

/** Test-only: the driver's current view, for assertions. */
export function __getLeaseForTesting(): {
  leaseId: string;
  tier: LeaseTier;
  phase: LeasePhase;
  kind: LibraryJobKind;
  generation: number;
} | null {
  if (!lease) return null;
  const { leaseId, tier, phase, kind, generation } = lease;
  return { leaseId, tier, phase, kind, generation };
}
