/**
 * Frame-metrics performance harness (U1).
 *
 * Dev-gated instrumentation for measuring UI-thread and JS-thread frame health
 * across scripted runs. Everything here is a no-op in production; see
 * {@link isPerfMetricsEnabled}.
 */

export {
  FrameMetricsAccumulator,
  DROP_THRESHOLD_MS,
  HARD_DROP_THRESHOLD_MS,
  isPerfMetricsEnabled,
  setPerfMetricsEnabled,
  type FrameThread,
  type FrameRunSummary,
} from './frameMetrics';
export { startPerfRun, stopPerfRun, getFrameMetricsController } from './frameMetricsController';
export { useFrameMetrics } from './useFrameMetrics';
export { PerfOverlay } from './PerfOverlay';
