/**
 * useBreathingAnimation - Subtle looping scale animation for "alive" feel
 *
 * Creates a gentle breathing effect where the element slowly pulses
 * between a base scale and a slightly larger scale. Used for visited
 * stamps to give them a subtle "living" quality.
 *
 * Usage:
 * const { breathingScale, startBreathing, stopBreathing } = useBreathingAnimation();
 * <Animated.View style={{ transform: [{ scale: breathingScale }] }}>
 *   ...
 * </Animated.View>
 */

import { useCallback, useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';

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
  /** Whether the animation is currently running */
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

  const breathingScale = useRef(new Animated.Value(minScale)).current;
  const animationRef = useRef<Animated.CompositeAnimation | null>(null);
  const isBreathingRef = useRef(false);

  const stopBreathing = useCallback(() => {
    if (animationRef.current) {
      animationRef.current.stop();
      animationRef.current = null;
    }
    isBreathingRef.current = false;
    breathingScale.setValue(minScale);
  }, [breathingScale, minScale]);

  const startBreathing = useCallback(() => {
    if (isBreathingRef.current) return;

    isBreathingRef.current = true;

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

  // Auto-start if requested
  useEffect(() => {
    if (autoStart) {
      startBreathing();
    }

    // Cleanup on unmount
    return () => {
      stopBreathing();
    };
  }, [autoStart, startBreathing, stopBreathing]);

  return {
    breathingScale,
    startBreathing,
    stopBreathing,
    isBreathing: isBreathingRef.current,
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
