/**
 * continuationProgress - Monotonic synthetic progress for the system UI.
 *
 * The raw store percentage is the wrong thing to feed `BGContinuedProcessingTask`:
 * quiz stages restart at 0 (`checking` follows a `scanning` that hit 100), the
 * quiz reports 0 while `total` is unknown, and the trip scan's segmentation
 * emits nothing for minutes. The system UI wants a value that never goes
 * backwards and keeps moving, so this pure mapper turns
 * `{phase, percentage}` plus heartbeats into stage-weighted units out of
 * `PROGRESS_TOTAL`:
 *
 *   - each kind's sub-phases get fixed cumulative [floor, ceiling) ranges;
 *   - a percentage maps linearly inside its phase's range;
 *   - a heartbeat nudges forward by one unit, never past the phase's ceiling;
 *   - `complete()` pins the value at the total;
 *   - the value is `max` of everything seen since the last `reset()`.
 *
 * No native, no store, no timers: the lease driver owns when to call it.
 */

import type { LibraryJobKind } from './jobTypes';

export const PROGRESS_TOTAL = 1000;

export interface ContinuationProgress {
  completed: number;
  total: number;
}

interface Stage {
  phase: string;
  floor: number;
  ceiling: number;
}

/**
 * Ordered stages per kind. Phase names are the `progress.phase` strings each
 * pipeline emits (`photoImport/types.ts`, `quizBuildJob.publish()`); the
 * trailing "tail" stage absorbs the silent work after the last emitted phase
 * (trip segmentation, quiz trip continuation) so heartbeats still move.
 */
const STAGES: Record<LibraryJobKind, Stage[]> = {
  'trip-scan': [
    { phase: 'counting', floor: 0, ceiling: 50 },
    { phase: 'scanning', floor: 50, ceiling: 750 },
    { phase: 'geocoding', floor: 750, ceiling: 900 },
    { phase: 'complete', floor: 900, ceiling: PROGRESS_TOTAL - 10 },
  ],
  'quiz-build': [
    { phase: 'scanning', floor: 0, ceiling: 300 },
    { phase: 'checking', floor: 300, ceiling: 800 },
    { phase: 'building', floor: 800, ceiling: PROGRESS_TOTAL - 10 },
  ],
};

function stageFor(
  kind: LibraryJobKind,
  phase: string | undefined
): { index: number; stage: Stage } {
  const stages = STAGES[kind];
  const index = phase ? stages.findIndex((s) => s.phase === phase) : -1;
  return index >= 0 ? { index, stage: stages[index] } : { index: 0, stage: stages[0] };
}

export class ContinuationProgressMapper {
  private kind: LibraryJobKind;
  private best = 0;
  private stageIndex = 0;
  private done = false;

  constructor(kind: LibraryJobKind) {
    this.kind = kind;
  }

  /** A new run (or a queued job taking over the lease) starts from zero. */
  reset(kind: LibraryJobKind = this.kind): void {
    this.kind = kind;
    this.best = 0;
    this.stageIndex = 0;
    this.done = false;
  }

  /** Feed a store progress snapshot. Unknown phases map into the current stage. */
  update(phase: string | undefined, percentage: number): void {
    if (this.done) return;
    const known = phase ? STAGES[this.kind].some((s) => s.phase === phase) : false;
    const { index, stage } = known
      ? stageFor(this.kind, phase)
      : { index: this.stageIndex, stage: STAGES[this.kind][this.stageIndex] };
    // Stages only move forward: a late emit from an earlier phase is noise.
    if (index < this.stageIndex) return;
    this.stageIndex = index;
    const pct = Math.min(100, Math.max(0, Number.isFinite(percentage) ? percentage : 0));
    const value = stage.floor + ((stage.ceiling - stage.floor) * pct) / 100;
    this.best = Math.max(this.best, Math.floor(value));
  }

  /** One unit forward, never past the current stage's ceiling. */
  heartbeat(): void {
    if (this.done) return;
    const stage = STAGES[this.kind][this.stageIndex];
    const next = Math.min(Math.max(this.best, stage.floor) + 1, stage.ceiling - 1);
    this.best = Math.max(this.best, next);
  }

  /** The run completed: pin at the total. */
  complete(): void {
    this.done = true;
    this.best = PROGRESS_TOTAL;
  }

  current(): ContinuationProgress {
    return { completed: this.best, total: PROGRESS_TOTAL };
  }
}
