/**
 * Default screen transition interpolator: Slide from right with scale
 *
 * Creates an iOS-style navigation transition where:
 * - Incoming screen slides in from the right
 * - Previous screen scales down slightly (0.95) and fades
 * - Creates depth perception and spatial continuity
 *
 * Progress timeline: 0 → 1 → 2
 * - 0: Screen is entering (off-screen right)
 * - 1: Screen is fully visible (active)
 * - 2: Screen is exiting (scaled down, faded)
 */

import { interpolate } from 'react-native-reanimated';
import {
  SCALE_PREVIOUS_SCREEN,
  OPACITY_BACKGROUND,
  TRANSITION_SPEC_DEFAULT,
} from '../transitionConfig';

import type { BlankStackNavigationOptions } from 'react-native-screen-transitions/blank-stack';

type ScreenStyleInterpolatorParams = {
  progress: number;
  layouts: {
    screen: { width: number; height: number };
  };
};

/**
 * Interpolator function for slide-from-right with scale effect
 */
export const slideWithScaleInterpolator = ({
  progress,
  layouts: { screen },
}: ScreenStyleInterpolatorParams) => {
  'worklet';

  // Incoming screen slides from right (progress 0→1)
  // Outgoing screen slides left (progress 1→2)
  const translateX = interpolate(progress, [0, 1, 2], [screen.width, 0, -screen.width * 0.3]);

  // Previous screen scales down when new screen is on top
  const scale = interpolate(progress, [0, 1, 2], [1, 1, SCALE_PREVIOUS_SCREEN]);

  // Fade previous screen slightly
  const opacity = interpolate(progress, [0, 1, 2], [1, 1, OPACITY_BACKGROUND]);

  return {
    contentStyle: {
      transform: [{ translateX }, { scale }],
      opacity,
    },
  };
};

/**
 * Complete screen options preset for slide-with-scale transition
 * Use this directly in Stack.Screen options
 */
export const SlideWithScalePreset: BlankStackNavigationOptions = {
  screenStyleInterpolator: slideWithScaleInterpolator,
  transitionSpec: TRANSITION_SPEC_DEFAULT,
  gestureEnabled: true,
  gestureDirection: 'horizontal',
};

/**
 * Variant with gesture disabled (for screens that shouldn't be swipe-dismissable)
 */
export const SlideWithScaleNoGesturePreset: BlankStackNavigationOptions = {
  screenStyleInterpolator: slideWithScaleInterpolator,
  transitionSpec: TRANSITION_SPEC_DEFAULT,
  gestureEnabled: false,
};
