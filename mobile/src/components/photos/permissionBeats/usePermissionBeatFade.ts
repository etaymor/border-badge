import { useEffect } from 'react';
import {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import {
  PERMISSION_BEAT_FADE_OUT,
  PERMISSION_POP_SPRING_CONFIG,
  permissionBeatResetDelay,
} from './permissionMotion';

export function permissionPopLoop(order: number, count: number, stagger: number) {
  return withRepeat(
    withSequence(
      withDelay(order * stagger, withSpring(1, PERMISSION_POP_SPRING_CONFIG)),
      withDelay(permissionBeatResetDelay(order, count, stagger), withTiming(0, { duration: 0 }))
    ),
    -1
  );
}

/** Fades the whole beat out after `visibleMs`, then the repeat starts the next pass. */
export function usePermissionBeatFade(shouldAnimate: boolean, visibleMs: number) {
  const opacity = useSharedValue(1);

  useEffect(() => {
    if (!shouldAnimate) {
      opacity.value = 1;
      return;
    }

    opacity.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 0 }),
        withDelay(visibleMs, withTiming(0, { duration: PERMISSION_BEAT_FADE_OUT }))
      ),
      -1
    );
  }, [opacity, shouldAnimate, visibleMs]);

  return useAnimatedStyle(() => ({ opacity: opacity.value }));
}
