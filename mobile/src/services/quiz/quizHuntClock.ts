/**
 * quizHuntClock - Executing-time accumulator for the hunt's soft deadline.
 *
 * `HUNT_SOFT_DEADLINE_MS` caps classification SPEND, not user wait. It used to
 * compare against `Date.now() - huntStartedAt`, which counts wall-clock time —
 * and a process that iOS FROZE mid-hunt (home button on iOS < 26, or the
 * grace window running out) keeps no timers running, yet on thaw the wall
 * clock says minutes passed. A build that had classified for 20 s would then
 * finalize at the minimum photo count the moment the user came back.
 *
 * This clock counts only time the process was actually executing: a 1 s
 * ticker adds at most `TICK_CAP_MS` per tick, so a frozen gap of any length
 * contributes one capped tick, while a build that keeps running in the
 * background under a continued-processing lease keeps counting normally
 * (timers fire while the process executes, wherever the app is).
 *
 * Owned by the hunt (it lives on `QuizRunState`), never by the job runtime:
 * the runtime knows nothing about quiz state.
 */

export interface HuntClock {
  /** Milliseconds the process has spent executing since the clock started. */
  executingMs(): number;
  /** Idempotent. Stops the ticker; `executingMs()` stays readable. */
  stop(): void;
}

const TICK_INTERVAL_MS = 1_000;
/** A single tick never credits more than this, however long the gap really was. */
export const TICK_CAP_MS = 2_000;
/**
 * Backstop against a leaked ticker (a hunt abandoned without `stop()`): after
 * this much wall time the clock stops itself. Far above any real hunt.
 */
const MAX_LIFETIME_MS = 60 * 60 * 1_000;

export function createHuntClock(now: () => number = Date.now): HuntClock {
  const startedAt = now();
  let lastTick = startedAt;
  let accumulated = 0;
  let handle: ReturnType<typeof setInterval> | null = null;

  const credit = (): void => {
    const t = now();
    accumulated += Math.min(Math.max(0, t - lastTick), TICK_CAP_MS);
    lastTick = t;
  };

  const stop = (): void => {
    if (handle !== null) {
      clearInterval(handle);
      handle = null;
    }
  };

  handle = setInterval(() => {
    credit();
    if (now() - startedAt > MAX_LIFETIME_MS) stop();
  }, TICK_INTERVAL_MS);

  return {
    executingMs: () => {
      // Fold in the partial interval since the last tick — capped, so a read
      // right after a thaw does not credit the frozen gap either.
      const partial = Math.min(Math.max(0, now() - lastTick), TICK_CAP_MS);
      return accumulated + partial;
    },
    stop,
  };
}
