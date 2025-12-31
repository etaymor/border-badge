/**
 * useBreathingAnimation - Subtle looping scale animation for "alive" feel
 *
 * Creates a gentle breathing effect where the element slowly pulses
 * between a base scale and a slightly larger scale. Used for visited
 * stamps to give them a subtle "living" quality.
 *
 * Usage:
 * const { breathingScale, startBreathing, stopBreathing, isBreathing } = useBreathingAnimation();
 * <Animated.View style={{ transform: [{ scale: breathingScale }] }}>
 *   ...
 * </Animated.View>
 *
 * The isBreathing state can be used to track whether the animation is currently running.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing } from 'react-native';
import { useReducedMotion } from './useReducedMotion';

export interface UseBreathingAnimationOptions {
  /** Minimum scale (default: 1.0) */
  minScale?: number;
  /** Maximum scale (default: 1.01 for subtle effect) */
  maxScale?: number;
  /** Duration of one breath cycle in ms (default: 3000) */
  duration?: number;
  /** Whether to start automatically (default: false) */
  autoStart?: boolean;
}

export interface UseBreathingAnimationResult {
  /** Animated value for scale transform */
  breathingScale: Animated.Value;
  /** Start the breathing animation */
  startBreathing: () => void;
  /** Stop the breathing animation */
  stopBreathing: () => void;
  /** Whether the breathing animation is currently running */
  isBreathing: boolean;
}

/**
 * Hook for creating a subtle breathing/pulsing animation.
 *
 * @param options Configuration options
 * @returns Breathing scale value and control functions
 */
export function useBreathingAnimation(
  options: UseBreathingAnimationOptions = {}
): UseBreathingAnimationResult {
  const { minScale = 1.0, maxScale = 1.01, duration = 3000, autoStart = false } = options;

  // Check for reduced motion preference (WCAG 2.1 Level AA)
  const reduceMotion = useReducedMotion();

  const breathingScale = useRef(new Animated.Value(minScale)).current;
  const animationRef = useRef<Animated.CompositeAnimation | null>(null);
  const [isBreathing, setIsBreathing] = useState(false);
  // Use refs for values we read in callbacks to avoid recreating callbacks
  const isBreathingRef = useRef(false);
  const reduceMotionRef = useRef(reduceMotion);

  // Keep refs in sync with state/props
  useEffect(() => {
    isBreathingRef.current = isBreathing;
  }, [isBreathing]);

  useEffect(() => {
    reduceMotionRef.current = reduceMotion;
  }, [reduceMotion]);

  const stopBreathing = useCallback(() => {
    if (animationRef.current) {
      animationRef.current.stop();
      animationRef.current = null;
    }
    setIsBreathing(false);
    breathingScale.setValue(minScale);
  }, [breathingScale, minScale]);

  const startBreathing = useCallback(() => {
    // Read from refs to avoid dependency on state/props
    if (isBreathingRef.current || reduceMotionRef.current) return;

    setIsBreathing(true);

    // Create a looping animation: scale up then down
    const breatheIn = Animated.timing(breathingScale, {
      toValue: maxScale,
      duration: duration / 2,
      easing: Easing.inOut(Easing.ease),
      useNativeDriver: true,
    });

    const breatheOut = Animated.timing(breathingScale, {
      toValue: minScale,
      duration: duration / 2,
      easing: Easing.inOut(Easing.ease),
      useNativeDriver: true,
    });

    const breathCycle = Animated.sequence([breatheIn, breatheOut]);

    animationRef.current = Animated.loop(breathCycle);
    animationRef.current.start();
  }, [breathingScale, maxScale, minScale, duration]);

  // Auto-start if requested (unless reduce motion is enabled)
  useEffect(() => {
    if (autoStart && !reduceMotion) {
      startBreathing();
    } else if (reduceMotion) {
      // Stop any running animation if reduce motion is enabled
      stopBreathing();
    }

    // Cleanup on unmount
    return () => {
      stopBreathing();
    };
  }, [autoStart, reduceMotion, startBreathing, stopBreathing]);

  return {
    breathingScale,
    startBreathing,
    stopBreathing,
    isBreathing,
  };
}

/**
 * Preset configurations for common use cases
 */
export const BreathingPresets = {
  /** Very subtle breathing for stamps (1.0 → 1.01) */
  subtle: { minScale: 1.0, maxScale: 1.01, duration: 3000 },
  /** Slightly more noticeable (1.0 → 1.02) */
  gentle: { minScale: 1.0, maxScale: 1.02, duration: 2500 },
  /** More pronounced for attention (1.0 → 1.03) */
  noticeable: { minScale: 1.0, maxScale: 1.03, duration: 2000 },
} as const;
