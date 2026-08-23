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

import type { LibraryJobKind } from './jobTypes';

const runningKinds = new Set<LibraryJobKind>();
let backgroundSyncFlag = false;

/**
 * Whether the step loop should stop between units and leave the breadcrumb for
 * the next resume.
 *
 * Constant `false` in the foreground: a user watching a build wants it to
 * finish, and there is no budget to run out of. It becomes real only while an
 * iOS BGProcessingTask is executing the same steps — see
 * `services/jobs/backgroundJobTask`, which installs a provider backed by the
 * task's expiration handler.
 *
 * It lives on this LEAF rather than in `jobRuntime` so the background-task
 * module can install it without importing the runtime, which imports the
 * registry, which the job owners import.
 */
let yieldProvider: () => boolean = () => false;

/** True when the runtime should stop after the current unit of work. */
export function shouldYieldNow(): boolean {
  return yieldProvider();
}

/**
 * Install the yield provider. Called once, by the background-task driver.
 * Passing `null` restores the foreground default.
 */
export function setYieldProvider(provider: (() => boolean) | null): void {
  yieldProvider = provider ?? (() => false);
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
  yieldProvider = () => false;
}
