/**
 * useAnimatedPress - Reusable hook for press feedback animations
 *
 * Provides spring-based scale animation for press feedback on interactive elements.
 * Returns an animated scale value and press handlers for onPressIn/onPressOut.
 *
 * Usage:
 * const { scaleValue, pressHandlers } = useAnimatedPress();
 * <Animated.View style={{ transform: [{ scale: scaleValue }] }}>
 *   <TouchableOpacity {...pressHandlers} onPress={handlePress}>
 *     ...
 *   </TouchableOpacity>
 * </Animated.View>
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Animated } from 'react-native';
import {
  SPRING_FRICTION,
  SPRING_TENSION_IN,
  SPRING_TENSION_OUT,
  SCALE_PRESS,
} from '../navigation/transitionConfig';
import { useReducedMotion } from './useReducedMotion';

export interface UseAnimatedPressOptions {
  /** Scale factor when pressed (default: 0.96 from transitionConfig) */
  pressedScale?: number;
  /** Whether haptic feedback is enabled (default: false - callers should handle haptics) */
  disabled?: boolean;
}

export interface UseAnimatedPressResult {
  /** Animated value for scale transform */
  scaleValue: Animated.Value;
  /** Press handlers to spread onto a Pressable/TouchableOpacity */
  pressHandlers: {
    onPressIn: () => void;
    onPressOut: () => void;
  };
  /** Manually trigger press-in animation */
  animatePressIn: () => void;
  /** Manually trigger press-out animation */
  animatePressOut: () => void;
}

/**
 * Hook for creating press feedback animations with spring physics.
 *
 * @param options Configuration options
 * @returns Scale value and press handlers
 */
export function useAnimatedPress(options: UseAnimatedPressOptions = {}): UseAnimatedPressResult {
  const { pressedScale = SCALE_PRESS, disabled = false } = options;

  // Check for reduced motion preference (WCAG 2.1 Level AA)
  const reduceMotion = useReducedMotion();

  const scaleValue = useRef(new Animated.Value(1)).current;

  // Cleanup: stop any running animation and reset value on unmount
  useEffect(() => {
    return () => {
      scaleValue.stopAnimation();
      scaleValue.setValue(1);
    };
  }, [scaleValue]);

  const animatePressIn = useCallback(() => {
    if (disabled || reduceMotion) return;

    Animated.spring(scaleValue, {
      toValue: pressedScale,
      friction: SPRING_FRICTION,
      tension: SPRING_TENSION_IN,
      useNativeDriver: true,
    }).start();
  }, [scaleValue, pressedScale, disabled, reduceMotion]);

  const animatePressOut = useCallback(() => {
    if (disabled || reduceMotion) return;

    Animated.spring(scaleValue, {
      toValue: 1,
      friction: SPRING_FRICTION,
      tension: SPRING_TENSION_OUT,
      useNativeDriver: true,
    }).start();
  }, [scaleValue, disabled, reduceMotion]);

  // Memoize press handlers to prevent unnecessary re-renders
  const pressHandlers = useMemo(
    () => ({
      onPressIn: animatePressIn,
      onPressOut: animatePressOut,
    }),
    [animatePressIn, animatePressOut]
  );

  return {
    scaleValue,
    pressHandlers,
    animatePressIn,
    animatePressOut,
  };
}

/**
 * Preset configurations for common use cases
 */
export const AnimatedPressPresets = {
  /** Default press feedback (0.96 scale) */
  default: { pressedScale: SCALE_PRESS },
  /** Subtle press feedback for smaller elements */
  subtle: { pressedScale: 0.98 },
  /** More pronounced press feedback */
  strong: { pressedScale: 0.94 },
  /** Tab bar style (0.9 scale) */
  tabBar: { pressedScale: 0.9 },
} as const;
