/**
 * Shared Country Transition Interpolator
 *
 * Creates a shared element transition between country grid items and the
 * country detail hero image. The country image morphs smoothly from its
 * grid position to the hero position while other elements fade/scale.
 *
 * Progress timeline: 0 → 1 → 2
 * - 0: Detail screen entering (country morphing from grid position)
 * - 1: Detail screen visible (country at hero position)
 * - 2: Detail screen exiting (country morphing back to grid position)
 */

import { interpolate } from 'react-native-reanimated';
import {
  SCALE_PREVIOUS_SCREEN,
  OPACITY_BACKGROUND,
  TRANSITION_SPEC_DEFAULT,
} from '../transitionConfig';

import type { BlankStackNavigationOptions } from 'react-native-screen-transitions/blank-stack';

/**
 * Screen style interpolator for country detail screen with shared element support.
 *
 * This interpolator creates a slide-from-right transition while the
 * shared element (country stamp) morphs between screens automatically
 * when both screens have matching sharedBoundTag values.
 */
export const sharedCountryInterpolator: BlankStackNavigationOptions['screenStyleInterpolator'] = ({
  progress,
  layouts: { screen },
}) => {
  'worklet';

  // Incoming screen slides from right with subtle fade
  const translateX = interpolate(progress, [0, 1, 2], [screen.width, 0, -screen.width * 0.3]);

  // Previous screen scales down and fades
  const scale = interpolate(progress, [0, 1, 2], [1, 1, SCALE_PREVIOUS_SCREEN]);
  const opacity = interpolate(progress, [0, 1, 2], [1, 1, OPACITY_BACKGROUND]);

  // Overlay darkens as detail screen comes in
  const overlayOpacity = interpolate(progress, [0, 1, 2], [0, 0.15, 0]);

  return {
    contentStyle: {
      transform: [{ translateX }, { scale }],
      opacity,
    },
    overlayStyle: {
      backgroundColor: 'black',
      opacity: overlayOpacity,
    },
  };
};

/**
 * Complete screen options preset for country detail with shared element.
 * Shared elements are handled automatically by matching sharedBoundTag
 * values between Transition.View/Transition.Pressable components.
 */
export const SharedCountryPreset: BlankStackNavigationOptions = {
  screenStyleInterpolator: sharedCountryInterpolator,
  transitionSpec: TRANSITION_SPEC_DEFAULT,
  gestureEnabled: true,
  gestureDirection: 'horizontal',
};
