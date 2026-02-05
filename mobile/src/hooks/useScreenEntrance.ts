/**
 * useScreenEntrance - Premium entrance animations for onboarding screens
 *
 * Creates choreographed, staggered entrance animations that give the app
 * a polished, premium feel. Every screen follows the same dance:
 *
 * 1. Headline slides up and fades in first
 * 2. Supporting text follows 100ms later
 * 3. Interactive content enters 200ms later
 * 4. Call to action "blooms" into place 300ms later
 *
 * Usage:
 * ```typescript
 * const { getAnimatedStyle, getButtonStyle } = useScreenEntrance({ elementCount: 4 });
 *
 * <Animated.View style={getAnimatedStyle(0)}><Title /></Animated.View>
 * <Animated.View style={getAnimatedStyle(1)}><Subtitle /></Animated.View>
 * <Animated.View style={getAnimatedStyle(2)}><Content /></Animated.View>
 * <Animated.View style={getButtonStyle(3)}><Button /></Animated.View>
 * ```
 *
 * @see https://www.w3.org/WAI/WCAG21/Understanding/animation-from-interactions
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, ViewStyle } from 'react-native';
import { useReducedMotion } from './useReducedMotion';

// Animation timing constants - the rhythm of the choreography
const STAGGER_DELAY = 100; // ms between elements
const SLIDE_DISTANCE = 10; // px slide up
const CONTENT_DURATION = 250; // ms for fade/slide
const SPRING_FRICTION = 8; // organic, not bouncy
const SPRING_TENSION = 60; // responsive, not snappy
const BUTTON_SCALE_FROM = 0.95; // subtle bloom

// Maximum elements to prevent memory issues
const MAX_ELEMENTS = 8;

export interface UseScreenEntranceOptions {
  /** Number of elements to stagger (typically 3-5) */
  elementCount: number;
  /** Delay between elements in ms. Default: 100 */
  staggerDelay?: number;
  /** Slide distance in pixels. Default: 10 */
  slideDistance?: number;
  /** Whether to start automatically on mount. Default: true */
  autoStart?: boolean;
}

export interface UseScreenEntranceResult {
  /** Get animated style for content elements (opacity + translateY) */
  getAnimatedStyle: (index: number) => Animated.WithAnimatedObject<ViewStyle>;
  /** Get animated style for button elements (opacity + scale bloom) */
  getButtonStyle: (index: number) => Animated.WithAnimatedObject<ViewStyle>;
  /** Manually trigger animation (for re-entry scenarios) */
  startAnimation: () => void;
  /** Reset to initial state (call before startAnimation for re-entry) */
  resetAnimation: () => void;
  /** Whether all animations have completed */
  isComplete: boolean;
}

export function useScreenEntrance(options: UseScreenEntranceOptions): UseScreenEntranceResult {
  const {
    elementCount,
    staggerDelay = STAGGER_DELAY,
    slideDistance = SLIDE_DISTANCE,
    autoStart = true,
  } = options;

  const reduceMotion = useReducedMotion();
  const [isComplete, setIsComplete] = useState(reduceMotion);
  const isMountedRef = useRef(true);

  // Clamp element count for safety
  const count = Math.min(Math.max(elementCount, 1), MAX_ELEMENTS);

  // Create stable animation values (one per element)
  // Using a ref to ensure values persist across renders
  const animationValues = useRef<Animated.Value[]>(
    Array.from({ length: count }, () => new Animated.Value(reduceMotion ? 1 : 0))
  ).current;

  // Start the choreographed entrance animation
  const startAnimation = useCallback(() => {
    if (!isMountedRef.current) return;

    // If reduce motion is enabled, set all values to final state immediately
    if (reduceMotion) {
      animationValues.forEach((v) => v.setValue(1));
      setIsComplete(true);
      return;
    }

    // Reset all values to initial state
    animationValues.forEach((v) => v.setValue(0));
    setIsComplete(false);

    // Create the staggered animation sequence
    const animations = animationValues.map((animValue, index) => {
      // Last element (typically the button) uses spring for bloom effect
      const isButton = index === count - 1;

      if (isButton) {
        return Animated.spring(animValue, {
          toValue: 1,
          friction: SPRING_FRICTION,
          tension: SPRING_TENSION,
          useNativeDriver: true,
        });
      }

      // Content elements use timing for smooth fade + slide
      return Animated.timing(animValue, {
        toValue: 1,
        duration: CONTENT_DURATION,
        useNativeDriver: true,
      });
    });

    // Stagger the animations for the choreographed effect
    Animated.stagger(staggerDelay, animations).start(({ finished }) => {
      if (finished && isMountedRef.current) {
        setIsComplete(true);
      }
    });
  }, [count, staggerDelay, reduceMotion]);

  // Reset animation values to initial state
  const resetAnimation = useCallback(() => {
    animationValues.forEach((v) => {
      v.stopAnimation();
      v.setValue(reduceMotion ? 1 : 0);
    });
    setIsComplete(reduceMotion);
  }, [reduceMotion]);

  // Auto-start on mount if enabled
  useEffect(() => {
    isMountedRef.current = true;

    if (autoStart) {
      startAnimation();
    }

    // Cleanup on unmount
    return () => {
      isMountedRef.current = false;
      animationValues.forEach((v) => v.stopAnimation());
    };
  }, [autoStart, startAnimation]);

  // Get animated style for content elements (slide up + fade)
  const getAnimatedStyle = useCallback(
    (index: number): Animated.WithAnimatedObject<ViewStyle> => {
      const clampedIndex = Math.min(Math.max(index, 0), count - 1);
      const animValue = animationValues[clampedIndex];

      return {
        opacity: animValue,
        transform: [
          {
            translateY: animValue.interpolate({
              inputRange: [0, 1],
              outputRange: [slideDistance, 0],
            }),
          },
        ],
      };
    },
    [count, slideDistance]
  );

  // Get animated style for button elements (scale bloom + fade)
  const getButtonStyle = useCallback(
    (index: number): Animated.WithAnimatedObject<ViewStyle> => {
      const clampedIndex = Math.min(Math.max(index, 0), count - 1);
      const animValue = animationValues[clampedIndex];

      return {
        opacity: animValue,
        transform: [
          {
            scale: animValue.interpolate({
              inputRange: [0, 1],
              outputRange: [BUTTON_SCALE_FROM, 1],
            }),
          },
        ],
      };
    },
    [count]
  );

  return {
    getAnimatedStyle,
    getButtonStyle,
    startAnimation,
    resetAnimation,
    isComplete,
  };
}
