/**
 * jobRuntimeSlots - Per-kind run state owned by `jobRuntime`, plus the
 * read-only introspection the resume path and stuck detection use.
 *
 * Split from `jobRuntime` purely for size; nothing outside `services/jobs`
 * imports this module directly, and only `jobRuntime` writes to it.
 */

import { _emitJobSettled, isJobRunning } from './jobRuntimeState';
import type { JobRunOutcome, LibraryJobKind } from './jobTypes';

export interface RuntimeSlot {
  controller: AbortController | null;
  generation: number;
  startedAt: number | null;
  lastProgressAt: number;
  cancelInFlight: Promise<void> | null;
  lastOptions: unknown;
  /** Settles when the current run ends (completed, cancelled, or suspended). */
  runPromise: Promise<void> | null;
  /**
   * The last generation a driver `onSettled` was emitted for. Settle is
   * terminal per generation: a synchronous cancel emits it first, and the
   * in-flight step's later return must not emit a second one.
   */
  settledGeneration: number;
}

export function newSlot(): RuntimeSlot {
  return {
    controller: null,
    generation: 0,
    startedAt: null,
    lastProgressAt: 0,
    cancelInFlight: null,
    lastOptions: null,
    runPromise: null,
    settledGeneration: 0,
  };
}

export const slots: Record<LibraryJobKind, RuntimeSlot> = {
  'trip-scan': newSlot(),
  'quiz-build': newSlot(),
};

/** Emit the driver settle for a generation exactly once. */
export function emitSettledOnce(
  kind: LibraryJobKind,
  slot: RuntimeSlot,
  generation: number,
  outcome: JobRunOutcome
): void {
  if (generation === 0 || slot.settledGeneration === generation) return;
  slot.settledGeneration = generation;
  _emitJobSettled({ kind, generation, outcome });
}

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

/**
 * Stamp the stuck-detector heartbeat for every running kind. Called by the
 * foreground branch BEFORE stuck detection: a job frozen while the app was
 * backgrounded has not "stopped making progress" — time passed while the
 * process was not executing, and the per-kind threshold must count from now.
 */
export function markForegroundReturn(): void {
  const now = Date.now();
  for (const kind of Object.keys(slots) as LibraryJobKind[]) {
    if (isJobRunning(kind)) slots[kind].lastProgressAt = now;
  }
}
