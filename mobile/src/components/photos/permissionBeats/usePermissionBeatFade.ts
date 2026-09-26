/**
 * One clock per beat.
 *
 * Every overlay on a permission beat (checks, pills, stamps) pops in on a
 * stagger, holds, then fades out with the rest, and the loop repeats. Those
 * used to be separate animations — one repeating spring per overlay plus a
 * repeating fade — that were meant to reset in the same frame. A spring does
 * not end exactly on its nominal duration, so the loops drifted: the fade came
 * back before the overlays reset, and everything flashed on, then off, then
 * popped in again.
 *
 * Now a single linear clock drives the whole beat and every overlay derives
 * its pop and fade from it, so they cannot drift. The clock wraps while every
 * overlay is fully faded, so the reset is invisible. The photos underneath
 * never read the clock at all.
 */

import { useEffect } from 'react';
import {
  Easing,
  cancelAnimation,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import {
  PERMISSION_BEAT_FADE_OUT,
  PERMISSION_POP_DURATION,
  permissionBeatVisibleMs,
} from './permissionMotion';

/** Clock value meaning "not looping": every overlay rests at its final frame. */
export const PERMISSION_CLOCK_STILL = -1;

export interface PermissionBeatTiming {
  count: number;
  stagger: number;
}

/** Full loop length: pops, hold, fade. */
export function permissionBeatCycleMs({ count, stagger }: PermissionBeatTiming): number {
  return permissionBeatVisibleMs(count, stagger) + PERMISSION_BEAT_FADE_OUT;
}

/** Linear ms clock for one beat, or PERMISSION_CLOCK_STILL when not animating. */
export function usePermissionBeatClock(
  shouldAnimate: boolean,
  timing: PermissionBeatTiming
): SharedValue<number> {
  const clock = useSharedValue(PERMISSION_CLOCK_STILL);
  const cycleMs = permissionBeatCycleMs(timing);

  useEffect(() => {
    if (!shouldAnimate) {
      cancelAnimation(clock);
      clock.value = PERMISSION_CLOCK_STILL;
      return;
    }
    clock.value = 0;
    clock.value = withRepeat(
      withTiming(cycleMs, { duration: cycleMs, easing: Easing.linear }),
      -1,
      false
    );
    return () => cancelAnimation(clock);
  }, [clock, cycleMs, shouldAnimate]);

  return clock;
}

/** Back-out ease: a small overshoot, like the spring it replaces. */
function backOut(x: number): number {
  'worklet';
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

/** Pop progress (0 -> ~1.1 -> 1) for the overlay at `order`. */
export function permissionPopAt(t: number, order: number, stagger: number): number {
  'worklet';
  if (t < 0) return 1;
  const local = (t - order * stagger) / PERMISSION_POP_DURATION;
  if (local <= 0) return 0;
  if (local >= 1) return 1;
  return backOut(local);
}

/** Shared fade (1 -> 0) at the end of each loop. */
export function permissionFadeAt(t: number, timing: PermissionBeatTiming): number {
  'worklet';
  if (t < 0) return 1;
  const fadeStart = permissionBeatVisibleMs(timing.count, timing.stagger);
  if (t <= fadeStart) return 1;
  return Math.max(0, 1 - (t - fadeStart) / PERMISSION_BEAT_FADE_OUT);
}
