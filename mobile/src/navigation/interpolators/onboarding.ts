/**
 * Onboarding Screen Transition Interpolator
 *
 * Every onboarding screen uses ONE push: the incoming screen slides in from
 * the right, fully opaque, and an exiting screen offsets left.
 *
 * Why only this (and never scale, translateY or opacity fades):
 * onboarding screens sit under ONE shared header that is fixed above the
 * stack (components/onboarding/OnboardingHeader.tsx, rendered by
 * navigation/OnboardingStackLayout.tsx).
 * - Scaling a screen or moving it vertically makes its content visibly shift
 *   underneath that fixed header on every push/pop.
 * - Fading a screen's opacity shows the white root background through it.
 * - Per-screen gentle/bouncy springs felt slow; one snappy spec
 *   (TRANSITION_SPEC_DEFAULT) keeps the whole flow consistent.
 * Guarded by __tests__/navigation/onboardingFixedHeaderMotion.test.tsx.
 *
 *
 * No dim overlay, and the parallax is mostly invisible: the navigator keeps
 * `detachPreviousScreen`, which detaches the screen directly beneath the top
 * one, so the underlayer isn't live during push/pop. There is no screen there
 * to dim (an overlay only tinted the bare background grey); what shows through
 * is the stack background, which OnboardingStackLayout paints cream. The
 * −0.3·width exit offset is kept so the exit motion stays a proper push if
 * that screen is ever visible underneath.
 *
 * Progress timeline: 0 → 1 → 2
 * - 0: Screen is entering (off-screen right)
 * - 1: Screen is fully visible (active)
 * - 2: Screen is exiting (offset left, under the next screen)
 */

import { interpolate } from 'react-native-reanimated';
import { TRANSITION_SPEC_DEFAULT } from '../transitionConfig';

import type { BlankStackNavigationOptions } from 'react-native-screen-transitions/blank-stack';
import type { ScreenInterpolationProps } from 'react-native-screen-transitions';

/** How far an exiting screen offsets left, as a fraction of width. */
const PARALLAX_FRACTION = 0.3;

export const onboardingPushInterpolator = ({
  progress,
  layouts: { screen },
}: ScreenInterpolationProps) => {
  'worklet';

  const translateX = interpolate(
    progress,
    [0, 1, 2],
    [screen.width, 0, -screen.width * PARALLAX_FRACTION]
  );

  return {
    contentStyle: {
      transform: [{ translateX }],
    },
  };
};

/** The single onboarding push used by every onboarding screen. */
export const OnboardingPushPreset: BlankStackNavigationOptions = {
  screenStyleInterpolator: onboardingPushInterpolator,
  transitionSpec: TRANSITION_SPEC_DEFAULT,
  gestureEnabled: true,
  gestureDirection: 'horizontal',
};
