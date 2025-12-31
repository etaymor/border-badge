/**
 * Shared Trip Transition Interpolator
 *
 * Creates a shared element transition between trip cards and the
 * trip detail hero image. The trip thumbnail morphs smoothly from its
 * card position to the full-screen hero position while other elements fade/scale.
 *
 * Progress timeline: 0 → 1 → 2
 * - 0: Detail screen entering (thumbnail morphing from card position)
 * - 1: Detail screen visible (image at hero position)
 * - 2: Detail screen exiting (image morphing back to card position)
 */

import { interpolate } from 'react-native-reanimated';
import {
  SCALE_PREVIOUS_SCREEN,
  OPACITY_BACKGROUND,
  TRANSITION_SPEC_DEFAULT,
} from '../transitionConfig';

import type { BlankStackNavigationOptions } from 'react-native-screen-transitions/blank-stack';

/**
 * Screen style interpolator for trip detail screen with shared element support.
 *
 * This interpolator creates a slide-from-right transition while the
 * shared element (trip cover image) morphs between screens automatically
 * when both screens have matching sharedBoundTag values.
 */
export const sharedTripInterpolator: BlankStackNavigationOptions['screenStyleInterpolator'] = ({
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
 * Complete screen options preset for trip detail with shared element.
 * Shared elements are handled automatically by matching sharedBoundTag
 * values between Transition.View/Transition.Pressable components.
 */
export const SharedTripPreset: BlankStackNavigationOptions = {
  screenStyleInterpolator: sharedTripInterpolator,
  transitionSpec: TRANSITION_SPEC_DEFAULT,
  gestureEnabled: true,
  gestureDirection: 'horizontal',
};
