/**
 * continuationProgress - the monotonic synthetic progress the system UI sees.
 */

import { ContinuationProgressMapper, PROGRESS_TOTAL } from '@services/jobs/continuationProgress';

describe('ContinuationProgressMapper', () => {
  it('never decreases when a quiz stage restarts at 0', () => {
    const m = new ContinuationProgressMapper('quiz-build');
    m.update('scanning', 40);
    const atScanning = m.current().completed;
    m.update('checking', 0);
    expect(m.current().completed).toBeGreaterThanOrEqual(atScanning);
    m.update('checking', 10);
    expect(m.current().completed).toBeGreaterThan(atScanning);
  });

  it('advances on heartbeats inside a phase with no real progress, but never past the phase ceiling', () => {
    const m = new ContinuationProgressMapper('quiz-build');
    m.update('scanning', 0);
    const values: number[] = [];
    for (let i = 0; i < 10_000; i += 1) {
      m.heartbeat();
      values.push(m.current().completed);
    }
    expect(values[0]).toBeGreaterThan(0);
    for (let i = 1; i < values.length; i += 1)
      expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
    // scanning's ceiling is below checking's floor: the bar must not claim a
    // later stage began.
    m.update('checking', 0);
    expect(values.at(-1)!).toBeLessThan(m.current().completed + 1);
    expect(values.at(-1)!).toBeLessThan(PROGRESS_TOTAL);
  });

  it('maps scan `complete` and a completed run to the total', () => {
    const m = new ContinuationProgressMapper('trip-scan');
    m.update('counting', 100);
    m.update('scanning', 100);
    m.update('geocoding', 100);
    m.update('complete', 100);
    expect(m.current().completed).toBeLessThan(PROGRESS_TOTAL); // segmentation still runs
    m.complete();
    expect(m.current()).toEqual({ completed: PROGRESS_TOTAL, total: PROGRESS_TOTAL });
    // Pinned: nothing moves it after completion.
    m.update('scanning', 0);
    m.heartbeat();
    expect(m.current().completed).toBe(PROGRESS_TOTAL);
  });

  it('resets to 0 for a new generation / a queued job taking over', () => {
    const m = new ContinuationProgressMapper('trip-scan');
    m.update('scanning', 80);
    expect(m.current().completed).toBeGreaterThan(0);
    m.reset('quiz-build');
    expect(m.current().completed).toBe(0);
    m.update('scanning', 50);
    // Now on the quiz's weights.
    expect(m.current().completed).toBeLessThan(300);
  });

  it('ignores a late emit from an earlier stage and clamps bad percentages', () => {
    const m = new ContinuationProgressMapper('trip-scan');
    m.update('geocoding', 50);
    const at = m.current().completed;
    m.update('scanning', 100);
    expect(m.current().completed).toBe(at);
    m.update('geocoding', 250);
    expect(m.current().completed).toBeLessThanOrEqual(900);
    m.update('geocoding', Number.NaN);
    expect(m.current().completed).toBeLessThanOrEqual(900);
  });
});
