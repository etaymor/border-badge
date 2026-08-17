/**
 * Run controller for the frame-metrics harness (U1).
 *
 * Owns one {@link FrameMetricsAccumulator} per thread and coordinates a scoped
 * "run" across both. The React wiring ({@link useFrameMetrics}) feeds it
 * timestamps; scripts (or the PerfOverlay) call {@link startPerfRun} /
 * {@link stopPerfRun} to scope a run and log its summary.
 *
 * A single module-level controller is shared so a run started from anywhere
 * (overlay button, dev menu, test script) is measured by the frame callbacks
 * mounted in {@link useFrameMetrics}.
 */

import {
  FrameMetricsAccumulator,
  isPerfMetricsEnabled,
  type FrameRunSummary,
} from './frameMetrics';

class FrameMetricsController {
  private readonly ui = new FrameMetricsAccumulator('ui');
  private readonly js = new FrameMetricsAccumulator('js');
  private activeLabel: string | null = null;

  get isRunning(): boolean {
    return this.activeLabel !== null;
  }

  start(label: string, nowMs: number): void {
    this.activeLabel = label;
    this.ui.start(nowMs, label);
    this.js.start(nowMs, label);
  }

  recordUiFrame(nowMs: number): void {
    this.ui.record(nowMs);
  }

  recordJsFrame(nowMs: number): void {
    this.js.record(nowMs);
  }

  stop(nowMs: number): { ui: FrameRunSummary; js: FrameRunSummary } | null {
    if (this.activeLabel === null) {
      return null;
    }
    this.activeLabel = null;
    return {
      ui: this.ui.stop(nowMs),
      js: this.js.stop(nowMs),
    };
  }
}

const controller = new FrameMetricsController();

/** The shared controller instance (frame callbacks and run scoping share it). */
export function getFrameMetricsController(): FrameMetricsController {
  return controller;
}

function formatSummary(s: FrameRunSummary): string {
  return (
    `[perf:${s.thread}] "${s.label}" ` +
    `frames=${s.frames} drops>${17}ms=${s.drops} hardDrops>${34}ms=${s.hardDrops} ` +
    `longestStall=${s.longestStallMs.toFixed(1)}ms duration=${s.durationMs.toFixed(0)}ms`
  );
}

/**
 * Begin a scoped measurement run. No-op unless the harness is armed
 * ({@link isPerfMetricsEnabled}).
 */
export function startPerfRun(label: string): void {
  if (!isPerfMetricsEnabled()) {
    return;
  }
  controller.start(label, global.performance?.now?.() ?? Date.now());
  // eslint-disable-next-line no-console
  console.log(`[perf] run started: "${label}"`);
}

/**
 * End the current run and log both thread summaries. No-op unless armed and a
 * run is active. Returns the summaries (or null) for scripted assertions.
 */
export function stopPerfRun(): { ui: FrameRunSummary; js: FrameRunSummary } | null {
  if (!isPerfMetricsEnabled()) {
    return null;
  }
  const result = controller.stop(global.performance?.now?.() ?? Date.now());
  if (result) {
    // eslint-disable-next-line no-console
    console.log(formatSummary(result.ui));
    // eslint-disable-next-line no-console
    console.log(formatSummary(result.js));
  }
  return result;
}
