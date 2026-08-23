/**
 * jobRuntimeState - Leaf module holding the in-memory "who is writing the
 * photo cache right now" flags.
 *
 * Generalizes the former `photoImport/photoScanState.ts`. It exists for the
 * same reason that module did: to break the circular dependency between the
 * job runtime and `photoBackgroundSync` (the runtime aborts background sync on
 * start; background sync must know whether a job is running before it touches
 * the cache). Both sides read this leaf instead of each other.
 *
 * `isAnyLibraryJobRunning` is the SHARED WRITER LOCK. `photoLibrarySyncStatus`
 * and `photoBackgroundSync` gate their cache writes on it. It must account for
 * every job kind — a reader that only checks the trip scan would let background
 * sync interleave SQLite writes with a running quiz build's extract loop.
 */

import type {
  JobDriver,
  JobDriverHeartbeatEvent,
  JobDriverSettleEvent,
  JobDriverStartEvent,
  LibraryJobKind,
} from './jobTypes';

const runningKinds = new Set<LibraryJobKind>();
let backgroundSyncFlag = false;

// ---------------------------------------------------------------------------
// Driver registry
// ---------------------------------------------------------------------------

/**
 * Drivers watch job lifecycle and may ask the loop to stop between units.
 *
 * The registry lives on this LEAF rather than in `jobRuntime` so a driver
 * module (the BGProcessingTask handler, the continued-processing lease) can
 * attach without importing the runtime, which imports the registry, which the
 * job owners import. Several drivers may register; the loop yields when ANY of
 * them says so, and nothing here is ever true with no driver registered — a
 * user watching a build in the foreground sees it run to completion.
 */
const drivers = new Set<JobDriver>();

/** Attach a driver. Returns a remover. */
export function registerJobDriver(driver: JobDriver): () => void {
  drivers.add(driver);
  return () => {
    drivers.delete(driver);
  };
}

function safely(label: string, fn: () => void): void {
  try {
    fn();
  } catch (error) {
    // A misbehaving driver must never take the job down with it.
    console.warn(`[jobRuntimeState] driver ${label} threw:`, error);
  }
}

/** True when any driver wants this `(kind, generation)` to stop at the next unit boundary. */
export function shouldYieldNow(kind: LibraryJobKind, generation: number): boolean {
  for (const driver of drivers) {
    if (!driver.shouldYield) continue;
    try {
      if (driver.shouldYield(kind, generation)) return true;
    } catch (error) {
      console.warn('[jobRuntimeState] driver shouldYield threw:', error);
    }
  }
  return false;
}

/** Internal — emitted by jobRuntime only. */
export function _emitJobStarted(event: JobDriverStartEvent): void {
  for (const driver of drivers) {
    if (driver.onStarted) safely('onStarted', () => driver.onStarted!(event));
  }
}

/** Internal — emitted by jobRuntime only. */
export function _emitJobSettled(event: JobDriverSettleEvent): void {
  for (const driver of drivers) {
    if (driver.onSettled) safely('onSettled', () => driver.onSettled!(event));
  }
}

/** Internal — emitted by jobRuntime only. */
export function _emitJobHeartbeat(event: JobDriverHeartbeatEvent): void {
  for (const driver of drivers) {
    if (driver.onHeartbeat) safely('onHeartbeat', () => driver.onHeartbeat!(event));
  }
}

/** Internal — emitted by jobRuntime only. */
export function _emitJobIdle(): void {
  for (const driver of drivers) {
    if (driver.onIdle) safely('onIdle', () => driver.onIdle!());
  }
}

/**
 * Process-monotonic run generation. Never reused within a process — not even
 * across `resetAllForUserChange` — so a driver's per-run memory can never be
 * matched by a later run.
 */
let generationCounter = 0;

export function nextGeneration(): number {
  generationCounter += 1;
  return generationCounter;
}

export function isJobRunning(kind: LibraryJobKind): boolean {
  return runningKinds.has(kind);
}

/**
 * True while ANY library job holds the cache. This is the writer lock every
 * cache-touching module must respect.
 */
export function isAnyLibraryJobRunning(): boolean {
  return runningKinds.size > 0;
}

/** The kind currently running, if any. At most one job runs at a time. */
export function getRunningJobKind(): LibraryJobKind | null {
  for (const kind of runningKinds) return kind;
  return null;
}

/** Internal — set by jobRuntime only. */
export function _setJobRunning(kind: LibraryJobKind, value: boolean): void {
  if (value) {
    runningKinds.add(kind);
  } else {
    runningKinds.delete(kind);
  }
}

/**
 * Back-compat alias for the trip scan's historical reader name. Retained
 * because `photoScanService` still exposes `isScanRunning` as public API.
 */
export function isScanRunning(): boolean {
  return runningKinds.has('trip-scan');
}

/** Mirrors photoBackgroundSync's in-progress lock for leaf-level readers. */
export function isBackgroundSyncFlagSet(): boolean {
  return backgroundSyncFlag;
}

/** Internal — set by photoBackgroundSync only. */
export function _setBackgroundSyncFlag(value: boolean): void {
  backgroundSyncFlag = value;
}

/** Test-only: drop all in-memory run state. */
export function __resetJobRuntimeStateForTesting(): void {
  runningKinds.clear();
  backgroundSyncFlag = false;
  drivers.clear();
  generationCounter = 0;
}
