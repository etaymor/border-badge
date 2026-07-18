/**
 * Dev-gated frame-drop instrumentation (U1).
 *
 * Measures UI-thread and JS-thread frame health for scripted "runs" (e.g.
 * onboarding start -> paywall) and logs a repeatable per-run summary so every
 * fix in the performance pass has before/after numbers from the same runs.
 *
 * Nothing here runs in production: the React hook and the run controller are
 * no-ops unless {@link PERF_METRICS_ENABLED} is true, which is `__DEV__`-gated.
 * The pure {@link FrameMetricsAccumulator} core carries no native dependency so
 * it is unit-testable in isolation.
 */

/** A frame gap longer than this (ms) counts as a dropped frame (~60fps budget). */
export const DROP_THRESHOLD_MS = 17;
/** A frame gap longer than this (ms) counts as a hard drop (two missed frames). */
export const HARD_DROP_THRESHOLD_MS = 34;

/** Which thread a run of metrics was collected on. */
export type FrameThread = 'ui' | 'js';

/** Summary of a single scoped measurement run on one thread. */
export interface FrameRunSummary {
  thread: FrameThread;
  label: string;
  /** Number of inter-frame gaps observed (≈ rendered frames minus one). */
  frames: number;
  /** Gaps longer than {@link DROP_THRESHOLD_MS}. */
  drops: number;
  /** Gaps longer than {@link HARD_DROP_THRESHOLD_MS}. */
  hardDrops: number;
  /** Longest single inter-frame gap in the run (ms). */
  longestStallMs: number;
  /** Wall-clock duration of the run (ms). */
  durationMs: number;
}

/**
 * Pure inter-frame-gap accumulator. No React, Reanimated, or timing source of
 * its own — the caller feeds monotonically increasing timestamps (ms). This
 * makes drop-counting deterministically testable with synthetic timestamps.
 */
export class FrameMetricsAccumulator {
  private readonly thread: FrameThread;
  private label = '';
  private running = false;
  private startTs = 0;
  private lastTs = 0;
  private frames = 0;
  private drops = 0;
  private hardDrops = 0;
  private longestStallMs = 0;

  constructor(thread: FrameThread) {
    this.thread = thread;
  }

  /** Begin a run at the given timestamp (ms), clearing any prior run's state. */
  start(timestampMs: number, label = ''): void {
    this.running = true;
    this.label = label;
    this.startTs = timestampMs;
    this.lastTs = timestampMs;
    this.frames = 0;
    this.drops = 0;
    this.hardDrops = 0;
    this.longestStallMs = 0;
  }

  /** Record a frame timestamp (ms). No-op unless a run is active. */
  record(timestampMs: number): void {
    if (!this.running) {
      return;
    }
    const gap = timestampMs - this.lastTs;
    this.lastTs = timestampMs;
    this.frames += 1;
    if (gap > this.longestStallMs) {
      this.longestStallMs = gap;
    }
    if (gap > HARD_DROP_THRESHOLD_MS) {
      this.hardDrops += 1;
      this.drops += 1;
    } else if (gap > DROP_THRESHOLD_MS) {
      this.drops += 1;
    }
  }

  /** End the run and return its summary. Stop-without-start yields a zeroed summary. */
  stop(timestampMs: number): FrameRunSummary {
    const summary: FrameRunSummary = {
      thread: this.thread,
      label: this.label,
      frames: this.frames,
      drops: this.drops,
      hardDrops: this.hardDrops,
      longestStallMs: this.running ? this.longestStallMs : 0,
      durationMs: this.running ? timestampMs - this.startTs : 0,
    };
    this.running = false;
    return summary;
  }

  get isRunning(): boolean {
    return this.running;
  }
}

/**
 * Master gate. Only ever true in dev builds, and only when explicitly turned on
 * for a measurement session. Flip `ENABLED_IN_DEV` to true (or call
 * {@link setPerfMetricsEnabled}) to arm the harness locally; keep it false on
 * commit so ordinary dev runs pay nothing.
 */
const ENABLED_IN_DEV = false;

let enabledOverride: boolean | null = null;

export function setPerfMetricsEnabled(enabled: boolean): void {
  enabledOverride = enabled;
}

export function isPerfMetricsEnabled(): boolean {
  if (!__DEV__) {
    return false;
  }
  return enabledOverride ?? ENABLED_IN_DEV;
}
