import {
  FrameMetricsAccumulator,
  DROP_THRESHOLD_MS,
  HARD_DROP_THRESHOLD_MS,
  type FrameRunSummary,
} from '../frameMetrics';

describe('FrameMetricsAccumulator', () => {
  describe('gap accumulation', () => {
    it('counts drops and hard drops from synthetic inter-frame gaps', () => {
      const acc = new FrameMetricsAccumulator('ui');
      acc.start(0);
      // Timestamps in ms; gaps between them are 16/16/40/16.
      acc.record(16);
      acc.record(32);
      acc.record(72); // 40ms gap -> hard drop (and a drop)
      acc.record(88);

      const summary = acc.stop(88);
      // 4 gaps recorded (16, 16, 40, 16).
      expect(summary.frames).toBe(4);
      // Only the 40ms gap exceeds the >17ms drop threshold.
      expect(summary.drops).toBe(1);
      // The 40ms gap exceeds the >34ms hard-drop threshold.
      expect(summary.hardDrops).toBe(1);
      expect(summary.longestStallMs).toBe(40);
    });

    it('uses the documented thresholds', () => {
      expect(DROP_THRESHOLD_MS).toBe(17);
      expect(HARD_DROP_THRESHOLD_MS).toBe(34);
    });

    it('does not count an on-budget 16ms cadence as a drop', () => {
      const acc = new FrameMetricsAccumulator('js');
      acc.start(0);
      acc.record(16);
      acc.record(32);
      acc.record(48);
      const summary = acc.stop(48);
      expect(summary.frames).toBe(3);
      expect(summary.drops).toBe(0);
      expect(summary.hardDrops).toBe(0);
      expect(summary.longestStallMs).toBe(16);
    });

    it('reports run duration from first start to final stop', () => {
      const acc = new FrameMetricsAccumulator('ui');
      acc.start(1000);
      acc.record(1016);
      acc.record(1032);
      const summary = acc.stop(2000);
      expect(summary.durationMs).toBe(1000);
    });

    it('separates a boundary 17ms gap (not a drop) from an 18ms gap (a drop)', () => {
      const acc = new FrameMetricsAccumulator('ui');
      acc.start(0);
      acc.record(17); // exactly 17ms -> not a drop (threshold is > 17)
      acc.record(35); // 18ms gap -> drop, not hard
      const summary = acc.stop(35);
      expect(summary.drops).toBe(1);
      expect(summary.hardDrops).toBe(0);
    });
  });

  describe('run scoping', () => {
    it('resets metrics between start/stop cycles', () => {
      const acc = new FrameMetricsAccumulator('ui');
      acc.start(0);
      acc.record(60); // hard drop in first run
      acc.stop(60);

      // Second run should be independent.
      acc.start(100);
      acc.record(116);
      acc.record(132);
      const second = acc.stop(132);
      expect(second.frames).toBe(2);
      expect(second.drops).toBe(0);
      expect(second.hardDrops).toBe(0);
      expect(second.longestStallMs).toBe(16);
    });

    it('treats stop without start as a no-op returning a zeroed summary', () => {
      const acc = new FrameMetricsAccumulator('js');
      const summary = acc.stop(500);
      expect(summary.frames).toBe(0);
      expect(summary.drops).toBe(0);
      expect(summary.hardDrops).toBe(0);
      expect(summary.durationMs).toBe(0);
    });

    it('ignores record() calls made before start()', () => {
      const acc = new FrameMetricsAccumulator('ui');
      acc.record(16);
      acc.record(32);
      acc.start(100);
      acc.record(116);
      const summary = acc.stop(116);
      expect(summary.frames).toBe(1);
    });

    it('reports the run label and thread on the summary', () => {
      const acc = new FrameMetricsAccumulator('js');
      acc.start(0, 'onboarding');
      acc.record(16);
      const summary: FrameRunSummary = acc.stop(16);
      expect(summary.thread).toBe('js');
      expect(summary.label).toBe('onboarding');
    });
  });
});
