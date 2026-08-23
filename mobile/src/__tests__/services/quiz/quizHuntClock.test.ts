/**
 * quizHuntClock - the executing-time accumulator behind the hunt's soft
 * deadline.
 *
 * The property under test: a process that iOS froze mid-hunt must not have
 * the frozen minutes counted as classification time (one capped tick at most),
 * while a build that keeps executing in the background — wherever AppState
 * says the app is — keeps counting normally.
 */

import { AppState } from 'react-native';

import { HUNT_SOFT_DEADLINE_MS } from '@services/quiz/quizHuntLoop';
import { TICK_CAP_MS, createHuntClock } from '@services/quiz/quizHuntClock';

jest.useFakeTimers({ doNotFake: ['setImmediate'] });

afterEach(() => {
  jest.clearAllTimers();
});

describe('createHuntClock', () => {
  it('credits executing time tick by tick', () => {
    const clock = createHuntClock();
    jest.advanceTimersByTime(30_000);
    expect(clock.executingMs()).toBe(30_000);
    expect(clock.executingMs()).toBeLessThan(HUNT_SOFT_DEADLINE_MS);
    clock.stop();
  });

  it('a 3-minute frozen gap contributes one capped tick, not three minutes', () => {
    // 20 s of real execution, then the process freezes: the wall clock jumps
    // 180 s but NO timer fires.
    const clock = createHuntClock();
    jest.advanceTimersByTime(20_000);
    jest.setSystemTime(Date.now() + 180_000);

    expect(clock.executingMs()).toBeLessThanOrEqual(20_000 + TICK_CAP_MS);
    expect(clock.executingMs()).toBeLessThan(HUNT_SOFT_DEADLINE_MS);

    // ...and the thaw's first tick credits at most the cap too.
    jest.advanceTimersByTime(1_000);
    expect(clock.executingMs()).toBeLessThanOrEqual(20_000 + TICK_CAP_MS + 1_000);
    clock.stop();
  });

  it('reaches the deadline after 90 s of executing time, frozen gap or not', () => {
    const clock = createHuntClock();
    jest.advanceTimersByTime(20_000);
    jest.setSystemTime(Date.now() + 180_000);
    jest.advanceTimersByTime(70_000);
    expect(clock.executingMs()).toBeGreaterThanOrEqual(HUNT_SOFT_DEADLINE_MS);
    clock.stop();
  });

  it('keeps counting while the app is backgrounded but still executing (a leased build)', () => {
    const previous = AppState.currentState;
    (AppState as { currentState: string }).currentState = 'background';
    try {
      const clock = createHuntClock();
      jest.advanceTimersByTime(HUNT_SOFT_DEADLINE_MS);
      // The clock never consults AppState: timers firing IS executing.
      expect(clock.executingMs()).toBeGreaterThanOrEqual(HUNT_SOFT_DEADLINE_MS);
      clock.stop();
    } finally {
      (AppState as { currentState: string }).currentState = previous;
    }
  });

  it('stop() is idempotent and freezes the reading', () => {
    const clock = createHuntClock();
    jest.advanceTimersByTime(5_000);
    clock.stop();
    clock.stop();
    const at = clock.executingMs();
    jest.advanceTimersByTime(60_000);
    // A stopped clock may still credit up to one capped partial, never more.
    expect(clock.executingMs()).toBeLessThanOrEqual(at + TICK_CAP_MS);
  });
});
