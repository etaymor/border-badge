/**
 * useStaggeredEntrance - Reusable hook for staggering list item entrance animations
 *
 * Creates animation values for a list of items with configurable stagger delay.
 * Each item fades in and slides up with a spring animation.
 *
 * Usage:
 * const { getAnimatedStyle, startAnimation, resetAnimation } = useStaggeredEntrance({
 *   itemCount: items.length,
 *   staggerDelay: 50,
 * });
 *
 * // In render:
 * items.map((item, index) => (
 *   <Animated.View key={item.id} style={[styles.item, getAnimatedStyle(index)]}>
 *     ...
 *   </Animated.View>
 * ))
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, ViewStyle } from 'react-native';
import { STAGGER_DELAY_DEFAULT, STAGGER_MAX_DURATION } from '../navigation/transitionConfig';
import { useReducedMotion } from './useReducedMotion';

export interface UseStaggeredEntranceOptions {
  /** Number of items to animate */
  itemCount: number;
  /** Delay between each item's animation start (ms). Default: 50 */
  staggerDelay?: number;
  /** Maximum total duration for stagger sequence (ms). Default: 1500 */
  maxDuration?: number;
  /** Whether to start animation automatically on mount. Default: true */
  autoStart?: boolean;
  /** Spring friction (lower = more bouncy). Default: 6 */
  springFriction?: number;
  /** Spring tension (higher = faster). Default: 40 */
  springTension?: number;
  /** Vertical slide distance in pixels. Default: 20 */
  slideDistance?: number;
}

export interface UseStaggeredEntranceResult {
  /** Get animated style object for a specific item index */
  getAnimatedStyle: (index: number) => Animated.WithAnimatedObject<ViewStyle>;
  /** Get raw animation value for a specific item index (for custom animations) */
  getAnimationValue: (index: number) => Animated.Value;
  /** Start the stagger animation sequence */
  startAnimation: () => void;
  /** Reset all animation values to initial state (0) */
  resetAnimation: () => void;
  /** Whether animation has completed */
  isComplete: boolean;
}

/**
 * Calculate the stagger delay for a specific item index,
 * capping at maxDuration to prevent overly long sequences.
 */
export function calculateStaggerDelay(
  index: number,
  staggerDelay: number,
  maxDuration: number
): number {
  return Math.min(index * staggerDelay, maxDuration);
}

/**
 * Hook for creating staggered entrance animations for lists.
 *
 * @param options Configuration options
 * @returns Animation controls and style getter
 */
export function useStaggeredEntrance(
  options: UseStaggeredEntranceOptions
): UseStaggeredEntranceResult {
  const {
    itemCount,
    staggerDelay = STAGGER_DELAY_DEFAULT,
    maxDuration = STAGGER_MAX_DURATION,
    autoStart = true,
    springFriction = 6,
    springTension = 40,
    slideDistance = 20,
  } = options;

  // Check for reduced motion preference (WCAG 2.1 Level AA)
  const reduceMotion = useReducedMotion();

  // Track completion state
  const [isComplete, setIsComplete] = useState(false);
  const runIdRef = useRef(0);
  const timeoutIdsRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  // Create animation values for each item (no mutation in memo)
  const animationValues = useMemo<Animated.Value[]>(() => {
    const initialValue = reduceMotion ? 1 : 0;
    return Array.from({ length: itemCount }, () => new Animated.Value(initialValue));
  }, [itemCount, reduceMotion]);

  // Memoize interpolation configurations to prevent recreation
  const opacityInterpolation = useMemo(
    () => ({
      inputRange: [0, 1],
      outputRange: [0, 1] as number[],
    }),
    []
  );

  const translateInterpolation = useMemo(
    () => ({
      inputRange: [0, 1],
      outputRange: [slideDistance, 0] as number[],
    }),
    [slideDistance]
  );

  // Get animated style for a specific index
  const getAnimatedStyle = useCallback(
    (index: number): Animated.WithAnimatedObject<ViewStyle> => {
      if (index < 0 || index >= animationValues.length) {
        return { opacity: 1, transform: [{ translateY: 0 }] };
      }

      const animValue = animationValues[index];
      return {
        opacity: animValue.interpolate(opacityInterpolation),
        transform: [
          {
            translateY: animValue.interpolate(translateInterpolation),
          },
        ],
      };
    },
    [animationValues, opacityInterpolation, translateInterpolation]
  );

  // Get raw animation value for custom use
  const getAnimationValue = useCallback(
    (index: number): Animated.Value => {
      if (index < 0 || index >= animationValues.length) {
        return new Animated.Value(1);
      }
      return animationValues[index];
    },
    [animationValues]
  );

  // Start the stagger animation
  const startAnimation = useCallback(() => {
    // Clear pending timeouts/animations before starting
    timeoutIdsRef.current.forEach((id) => clearTimeout(id));
    timeoutIdsRef.current.clear();
    animationValues.forEach((av) => av.stopAnimation());

    // New run id to ignore stale callbacks
    runIdRef.current += 1;
    const currentRunId = runIdRef.current;
    setIsComplete(false);

    // Skip animation if reduce motion is enabled - just set all values to 1
    if (reduceMotion) {
      animationValues.forEach((animValue) => animValue.setValue(1));
      setIsComplete(true);
      return;
    }

    // Track completion
    let completedCount = 0;
    const totalItems = animationValues.length;

    if (totalItems === 0) {
      setIsComplete(true);
      return;
    }

    animationValues.forEach((animValue, index) => {
      const delay = calculateStaggerDelay(index, staggerDelay, maxDuration);

      const startSpring = () => {
        Animated.spring(animValue, {
          toValue: 1,
          friction: springFriction,
          tension: springTension,
          useNativeDriver: true,
        }).start(() => {
          if (runIdRef.current !== currentRunId) return;
          completedCount++;
          if (completedCount === totalItems) {
            setIsComplete(true);
          }
        });
      };

      if (delay === 0) {
        startSpring();
      } else {
        const timeoutId = setTimeout(() => {
          timeoutIdsRef.current.delete(timeoutId);
          if (runIdRef.current !== currentRunId) return;
          startSpring();
        }, delay);
        timeoutIdsRef.current.add(timeoutId);
      }
    });
  }, [animationValues, staggerDelay, maxDuration, springFriction, springTension, reduceMotion]);

  // Reset all animations to initial state
  const resetAnimation = useCallback(() => {
    // Clear pending timeouts
    timeoutIdsRef.current.forEach((id) => clearTimeout(id));
    timeoutIdsRef.current.clear();
    animationValues.forEach((av) => av.stopAnimation());
    runIdRef.current += 1;

    // Stop and reset all animation values
    animationValues.forEach((animValue) => {
      animValue.stopAnimation();
      animValue.setValue(reduceMotion ? 1 : 0);
    });

    setIsComplete(false);
  }, [animationValues, reduceMotion]);

  // Auto-start animation on mount if enabled (unless reduce motion is enabled)
  useEffect(() => {
    if (autoStart && itemCount > 0) {
      startAnimation();
    }
  }, [autoStart, itemCount, startAnimation, reduceMotion]);

  // Cleanup on unmount and when animationValues ref changes
  useEffect(() => {
    const timeoutIds = timeoutIdsRef.current;
    const anims = animationValues;

    return () => {
      // Invalidate any in-flight callbacks
      runIdRef.current += 1;

      // Clear pending timeouts
      timeoutIds.forEach((id) => clearTimeout(id));
      timeoutIds.clear();

      // Stop any running animations
      anims.forEach((animValue) => {
        animValue.stopAnimation();
      });
    };
  }, [animationValues]);

  return {
    getAnimatedStyle,
    getAnimationValue,
    startAnimation,
    resetAnimation,
    isComplete,
  };
}

/**
 * Preset configurations for common use cases
 */
export const StaggeredEntrancePresets = {
  /** Default stagger - 50ms delay, 20px slide */
  default: {
    staggerDelay: STAGGER_DELAY_DEFAULT,
    slideDistance: 20,
    springFriction: 6,
    springTension: 40,
  },
  /** Fast stagger - 30ms delay, 15px slide */
  fast: {
    staggerDelay: 30,
    slideDistance: 15,
    springFriction: 7,
    springTension: 50,
  },
  /** Slow dramatic stagger - 80ms delay, 30px slide */
  dramatic: {
    staggerDelay: 80,
    slideDistance: 30,
    springFriction: 5,
    springTension: 35,
  },
  /** Subtle stagger - 40ms delay, 10px slide */
  subtle: {
    staggerDelay: 40,
    slideDistance: 10,
    springFriction: 8,
    springTension: 60,
  },
} as const;
