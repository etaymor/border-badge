/**
 * Dispatch-scoped circuit breaker for vision preparation (KTD2).
 *
 * Local-only selection (KTD1) keeps iCloud-offloaded photos away from the
 * native encoder, but it can only see what the scan and the tagger recorded. A
 * `file://` photo evicted since, or a native queue that has wedged for another
 * reason, still costs `VISION_IMAGE_TIMEOUT_MS` per photo — and a timed-out
 * native task is NOT cancelled by the JS timeout, so every further attempt
 * queues behind the ones already stuck. Once preparation has proven itself
 * dead for this run, the remaining batches go out without vision images and
 * match on their coordinates instead.
 *
 * One breaker per dispatch: a fresh dispatch starts closed, so one bad run
 * never costs a later one its vision signal.
 */

/**
 * Consecutive per-photo preparation timeouts that open the breaker.
 *
 * OTA-tunable. Three is one full cluster's worth of representative photos all
 * timing out, which a healthy local encode (tens of ms) never produces.
 * Rollback: raise it (e.g. to `Number.POSITIVE_INFINITY`) to disable the
 * breaker without touching the call sites.
 */
export const VISION_PREP_BREAKER_THRESHOLD = 3;

export interface VisionPrepBreaker {
  /** True once the threshold is reached; stays open for the rest of the run. */
  isOpen(): boolean;
  /** A photo's native preparation hit its timeout. */
  recordTimeout(): void;
  /** A photo prepared successfully: the timeout streak is broken. */
  recordSuccess(): void;
  /** Timeouts recorded since the last success (diagnostics and tests). */
  consecutiveTimeouts(): number;
}

export function createVisionPrepBreaker(
  threshold: number = VISION_PREP_BREAKER_THRESHOLD
): VisionPrepBreaker {
  let streak = 0;
  let open = false;

  return {
    isOpen: () => open,
    recordTimeout: () => {
      streak += 1;
      if (streak >= threshold && !open) {
        open = true;
        // Survives production stripping: a run that silently lost its vision
        // signal must be visible without a debug build.
        console.warn(
          `[VisionPrep] Breaker open after ${streak} consecutive preparation timeouts; ` +
            'remaining batches go out without vision images'
        );
      }
    },
    recordSuccess: () => {
      // An open breaker stays open: late successes are photos that were
      // already in flight, not evidence the native layer recovered.
      if (!open) streak = 0;
    },
    consecutiveTimeouts: () => streak,
  };
}
