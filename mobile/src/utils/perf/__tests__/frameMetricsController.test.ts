import { getFrameMetricsController, startPerfRun, stopPerfRun } from '../frameMetricsController';
import { setPerfMetricsEnabled, isPerfMetricsEnabled } from '../frameMetrics';

describe('frameMetricsController dev gating', () => {
  afterEach(() => {
    // Reset the arm state back to the default (dev-gated, off) between tests.
    setPerfMetricsEnabled(false);
    // Ensure no run leaks across tests.
    getFrameMetricsController().stop(0);
  });

  it('start/stop are no-ops when the harness is disabled', () => {
    setPerfMetricsEnabled(false);
    expect(isPerfMetricsEnabled()).toBe(false);

    startPerfRun('should-not-start');
    expect(getFrameMetricsController().isRunning).toBe(false);

    // Feeding frames while disabled records nothing observable.
    getFrameMetricsController().recordUiFrame(16);
    getFrameMetricsController().recordJsFrame(16);

    expect(stopPerfRun()).toBeNull();
  });

  it('measures a run when armed and logs both thread summaries', () => {
    setPerfMetricsEnabled(true);
    expect(isPerfMetricsEnabled()).toBe(true);

    startPerfRun('armed-run');
    expect(getFrameMetricsController().isRunning).toBe(true);

    const controller = getFrameMetricsController();
    controller.recordUiFrame(60); // hard drop on UI thread
    controller.recordJsFrame(20); // drop on JS thread

    const result = stopPerfRun();
    expect(result).not.toBeNull();
    expect(result?.ui.label).toBe('armed-run');
    expect(result?.js.label).toBe('armed-run');
    expect(getFrameMetricsController().isRunning).toBe(false);
  });

  it('stopping without an active run returns null', () => {
    setPerfMetricsEnabled(true);
    expect(stopPerfRun()).toBeNull();
  });
});
