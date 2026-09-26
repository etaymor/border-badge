/**
 * One-shot entrance clock (plus an optional, finite idle) for an intro beat.
 *
 * The photo-permission clock loops forever; the intro plays each beat once
 * when it becomes active, then settles. Rules:
 *
 * - Only an active beat that can play (focused, splash gone) and is not under
 *   Reduce Motion ever animates.
 * - Inactive beats rest on the "before" pose (0), so swiping in shows the empty
 *   state that then fills. Revisiting a beat replays its entrance.
 * - Losing focus mid-entrance cancels and snaps to the final frame; regaining
 *   focus does not replay.
 * - The idle repeats a fixed, even number of times and ends at rest. Nothing
 *   here uses an infinite repeat, so nothing can outlive the screen.
 * - Every path cancels both values; unmount cancels too.
 */

import { useEffect, useRef } from 'react';
import {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedReaction,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import {
  INTRO_CLOCK_STILL,
  INTRO_IDLE_REPEATS,
  INTRO_SETTLE_DELAY,
  type IntroBeatTiming,
} from './introMotion';

export interface IntroBeatClockOptions extends IntroBeatTiming {
  isActive: boolean;
  canPlay: boolean;
  reduceMotion: boolean;
}

export interface IntroBeatClock {
  /** Linear ms since the entrance began; see `introMotion` for the value contract. */
  entrance: SharedValue<number>;
  /** 0..1 idle wave after the entrance; rests at 0. */
  idle: SharedValue<number>;
}

export function useIntroBeatClock({
  isActive,
  canPlay,
  reduceMotion,
  entranceMs,
  idleHalfMs,
}: IntroBeatClockOptions): IntroBeatClock {
  const entrance = useSharedValue(reduceMotion ? INTRO_CLOCK_STILL : 0);
  const idle = useSharedValue(0);
  // Written only inside the effect below (never during render).
  const startedRef = useRef(false);

  useEffect(() => {
    const stop = () => {
      cancelAnimation(entrance);
      cancelAnimation(idle);
    };

    if (reduceMotion) {
      stop();
      entrance.value = INTRO_CLOCK_STILL;
      idle.value = 0;
      return;
    }

    if (!isActive) {
      stop();
      startedRef.current = false;
      entrance.value = 0;
      idle.value = 0;
      return;
    }

    if (!canPlay || startedRef.current) {
      // Paused (blurred / under the splash) or resumed after a pause: hold the
      // final frame if this beat already started, otherwise the before pose.
      stop();
      entrance.value = startedRef.current ? INTRO_CLOCK_STILL : 0;
      idle.value = 0;
      return;
    }

    startedRef.current = true;
    entrance.value = 0;
    entrance.value = withDelay(
      INTRO_SETTLE_DELAY,
      withTiming(entranceMs, { duration: entranceMs, easing: Easing.linear })
    );
    if (idleHalfMs > 0) {
      idle.value = 0;
      idle.value = withDelay(
        INTRO_SETTLE_DELAY + entranceMs,
        withRepeat(
          withTiming(1, { duration: idleHalfMs, easing: Easing.inOut(Easing.sin) }),
          INTRO_IDLE_REPEATS,
          true
        )
      );
    }
    return stop;
  }, [canPlay, entrance, entranceMs, idle, idleHalfMs, isActive, reduceMotion]);

  // Belt and braces: whatever state the beat unmounts in, nothing keeps running.
  useEffect(
    () => () => {
      cancelAnimation(entrance);
      cancelAnimation(idle);
    },
    [entrance, idle]
  );

  return { entrance, idle };
}

/**
 * Fire `onCue` on the JS thread once each time the entrance clock crosses
 * `atMs` while playing. A jump to the still frame (-1) never fires, so Reduce
 * Motion and blur-resume stay silent. Used for the few haptic moments.
 */
export function useClockCue(
  entrance: SharedValue<number>,
  atMs: number,
  onCue: () => void,
  enabled: boolean
): void {
  useAnimatedReaction(
    () => entrance.value >= atMs,
    (crossed, previous) => {
      if (enabled && crossed && previous === false) {
        runOnJS(onCue)();
      }
    },
    [atMs, enabled, onCue]
  );
}
