/**
 * Onboarding Screen Transition Interpolators
 *
 * Unique transitions for each step of the onboarding journey, creating
 * a narrative flow that builds anticipation and celebrates milestones.
 *
 * Design Philosophy: Each transition should feel like turning pages in a
 * travel story, with motion that reinforces the emotional intent.
 *
 * Progress timeline: 0 → 1 → 2
 * - 0: Screen is entering (off-screen)
 * - 1: Screen is fully visible (active)
 * - 2: Screen is exiting (pushed back)
 */

import { interpolate } from 'react-native-reanimated';
import {
  TRANSITION_SPEC_DEFAULT,
  SPRING_CONFIG_GENTLE,
  SPRING_CONFIG_BOUNCY,
} from '../transitionConfig';

import type { BlankStackNavigationOptions } from 'react-native-screen-transitions/blank-stack';
import type { ScreenInterpolationProps } from 'react-native-screen-transitions';

// ============ TRANSITION SPECS ============

/** Gentle spec for reflective transitions */
const TRANSITION_SPEC_GENTLE = {
  open: SPRING_CONFIG_GENTLE,
  close: SPRING_CONFIG_GENTLE,
} as const;

/** Bouncy spec for celebratory transitions */
const TRANSITION_SPEC_BOUNCY = {
  open: SPRING_CONFIG_BOUNCY,
  close: SPRING_CONFIG_BOUNCY,
} as const;

// ============ INTERPOLATORS ============

/**
 * Parallax Slide Interpolator
 * WelcomeCarousel → OnboardingSlider
 *
 * Incoming screen slides in while the previous screen slides out at
 * a slower rate (parallax effect), creating depth perception.
 */
export const parallaxSlideInterpolator = ({
  progress,
  layouts: { screen },
}: ScreenInterpolationProps) => {
  'worklet';

  // Incoming slides from right at full speed
  const translateX = interpolate(progress, [0, 1, 2], [screen.width, 0, -screen.width * 0.5]);

  // Previous screen slides left at slower pace (parallax)
  const scale = interpolate(progress, [0, 1, 2], [1, 1, 0.92]);
  const opacity = interpolate(progress, [0, 1, 2], [1, 1, 0.6]);

  return {
    contentStyle: {
      transform: [{ translateX }, { scale }],
      opacity,
    },
  };
};

/**
 * Zoom Reveal Interpolator
 * OnboardingSlider → Motivation
 *
 * Previous screen zooms out (like stepping back) while new screen
 * fades in, creating a "reveal" effect with 3D card stack feel.
 */
export const zoomRevealInterpolator = ({
  progress,
  layouts: { screen },
}: ScreenInterpolationProps) => {
  'worklet';

  // Incoming screen fades in and scales up slightly
  const incomingScale = interpolate(progress, [0, 1, 2], [0.9, 1, 0.85]);
  const translateY = interpolate(
    progress,
    [0, 1, 2],
    [screen.height * 0.1, 0, -screen.height * 0.1]
  );
  const opacity = interpolate(progress, [0, 1, 2], [0, 1, 0.7]);

  return {
    contentStyle: {
      transform: [{ scale: incomingScale }, { translateY }],
      opacity,
    },
  };
};

/**
 * Slide with Lead Motion Interpolator
 * Motivation → HomeCountry
 *
 * Standard slide with slight anticipation - screen eases in with
 * a gentle spring, suggesting the location pin is "leading" the motion.
 */
export const slideWithLeadInterpolator = ({
  progress,
  layouts: { screen },
}: ScreenInterpolationProps) => {
  'worklet';

  // Slide from right with slight overshoot feel
  const translateX = interpolate(progress, [0, 1, 2], [screen.width, 0, -screen.width * 0.35]);
  const scale = interpolate(progress, [0, 1, 2], [1.02, 1, 0.95]);
  const opacity = interpolate(progress, [0, 1, 2], [0.8, 1, 0.9]);

  return {
    contentStyle: {
      transform: [{ translateX }, { scale }],
      opacity,
    },
  };
};

/**
 * Continent Zoom Interpolator
 * DreamDestination → ContinentIntro
 *
 * Creates a "zoom into map" effect - previous screen shrinks down
 * while new screen zooms in from the center.
 */
export const continentZoomInterpolator = ({
  progress,
  layouts: { screen },
}: ScreenInterpolationProps) => {
  'worklet';

  // New screen zooms in from slightly smaller
  const scale = interpolate(progress, [0, 1, 2], [0.85, 1, 0.9]);

  // Subtle slide for spatial continuity
  const translateX = interpolate(progress, [0, 1, 2], [screen.width * 0.3, 0, -screen.width * 0.2]);
  const opacity = interpolate(progress, [0, 1, 2], [0, 1, 0.8]);

  // Overlay for depth
  const overlayOpacity = interpolate(progress, [0, 0.5, 1, 2], [0, 0.1, 0, 0]);

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
 * Dramatic Reveal Interpolator
 * AntarcticaPrompt → ProgressSummary
 *
 * Grand reveal effect - previous screen scales down dramatically
 * while new screen emerges with scale and fade. Creates anticipation
 * for the "look at your collection" moment.
 */
export const dramaticRevealInterpolator = ({
  progress,
  layouts: { screen },
}: ScreenInterpolationProps) => {
  'worklet';

  // New screen scales up from smaller with fade in
  const scale = interpolate(progress, [0, 1, 2], [0.8, 1, 0.88]);
  const translateY = interpolate(
    progress,
    [0, 1, 2],
    [screen.height * 0.15, 0, -screen.height * 0.08]
  );
  const opacity = interpolate(progress, [0, 0.3, 1, 2], [0, 0.5, 1, 0.75]);

  // Stronger overlay for drama
  const overlayOpacity = interpolate(progress, [0, 0.5, 1, 2], [0, 0.2, 0, 0]);

  return {
    contentStyle: {
      transform: [{ scale }, { translateY }],
      opacity,
    },
    overlayStyle: {
      backgroundColor: 'black',
      opacity: overlayOpacity,
    },
  };
};

/**
 * Collect Animation Interpolator
 * ProgressSummary → NameEntry
 *
 * Subtle slide suggesting stamps are "collecting" into a passport.
 * More restrained to not compete with stamp animations on previous screen.
 */
export const collectInterpolator = ({
  progress,
  layouts: { screen },
}: ScreenInterpolationProps) => {
  'worklet';

  // Gentle slide from right
  const translateX = interpolate(progress, [0, 1, 2], [screen.width * 0.8, 0, -screen.width * 0.3]);
  const scale = interpolate(progress, [0, 1, 2], [0.95, 1, 0.92]);
  const opacity = interpolate(progress, [0, 0.5, 1, 2], [0, 0.8, 1, 0.85]);

  return {
    contentStyle: {
      transform: [{ translateX }, { scale }],
      opacity,
    },
  };
};

/**
 * Default onboarding slide (for screens without special transitions)
 * Used for TrackingPreference and other intermediate screens.
 */
export const onboardingSlideInterpolator = ({
  progress,
  layouts: { screen },
}: ScreenInterpolationProps) => {
  'worklet';

  const translateX = interpolate(progress, [0, 1, 2], [screen.width, 0, -screen.width * 0.3]);
  const scale = interpolate(progress, [0, 1, 2], [1, 1, 0.95]);
  const opacity = interpolate(progress, [0, 1, 2], [1, 1, 0.9]);

  return {
    contentStyle: {
      transform: [{ translateX }, { scale }],
      opacity,
    },
  };
};

// ============ PRESETS ============

/** WelcomeCarousel → OnboardingSlider: Parallax slide with video cross-dissolve feel */
export const ParallaxSlidePreset: BlankStackNavigationOptions = {
  screenStyleInterpolator: parallaxSlideInterpolator,
  transitionSpec: TRANSITION_SPEC_DEFAULT,
  gestureEnabled: true,
  gestureDirection: 'horizontal',
};

/** OnboardingSlider → Motivation: Zoom-out reveal with 3D card stack feel */
export const ZoomRevealPreset: BlankStackNavigationOptions = {
  screenStyleInterpolator: zoomRevealInterpolator,
  transitionSpec: TRANSITION_SPEC_GENTLE,
  gestureEnabled: true,
  gestureDirection: 'horizontal',
};

/** Motivation → HomeCountry: Slide with location pin leading motion */
export const SlideWithLeadPreset: BlankStackNavigationOptions = {
  screenStyleInterpolator: slideWithLeadInterpolator,
  transitionSpec: TRANSITION_SPEC_DEFAULT,
  gestureEnabled: true,
  gestureDirection: 'horizontal',
};

/** DreamDestination → ContinentIntro: Globe rotation / continent zoom effect */
export const ContinentZoomPreset: BlankStackNavigationOptions = {
  screenStyleInterpolator: continentZoomInterpolator,
  transitionSpec: TRANSITION_SPEC_DEFAULT,
  gestureEnabled: true,
  gestureDirection: 'horizontal',
};

/** AntarcticaPrompt → ProgressSummary: Dramatic reveal with stamps flying in */
export const DramaticRevealPreset: BlankStackNavigationOptions = {
  screenStyleInterpolator: dramaticRevealInterpolator,
  transitionSpec: TRANSITION_SPEC_BOUNCY,
  gestureEnabled: true,
  gestureDirection: 'horizontal',
};

/** ProgressSummary → NameEntry: Stamps collecting into passport animation */
export const CollectPreset: BlankStackNavigationOptions = {
  screenStyleInterpolator: collectInterpolator,
  transitionSpec: TRANSITION_SPEC_GENTLE,
  gestureEnabled: true,
  gestureDirection: 'horizontal',
};

/** Default onboarding transition for intermediate screens */
export const OnboardingSlidePreset: BlankStackNavigationOptions = {
  screenStyleInterpolator: onboardingSlideInterpolator,
  transitionSpec: TRANSITION_SPEC_DEFAULT,
  gestureEnabled: true,
  gestureDirection: 'horizontal',
};
