import { createBlankStackNavigator } from 'react-native-screen-transitions/blank-stack';

import { AccountCreationScreen } from '@screens/onboarding/AccountCreationScreen';
import { AntarcticaPromptScreen } from '@screens/onboarding/AntarcticaPromptScreen';
import { ContinentCountryGridScreen } from '@screens/onboarding/ContinentCountryGridScreen';
import { ContinentIntroScreen } from '@screens/onboarding/ContinentIntroScreen';
import { DreamDestinationScreen } from '@screens/onboarding/DreamDestinationScreen';
import { HomeCountryScreen } from '@screens/onboarding/HomeCountryScreen';
import { MotivationScreen } from '@screens/onboarding/MotivationScreen';
import { NameEntryScreen } from '@screens/onboarding/NameEntryScreen';
import { OnboardingSliderScreen } from '@screens/onboarding/OnboardingSliderScreen';
// LAUNCH_SIMPLIFICATION: Paywall hidden for initial launch
// import { PaywallScreen } from '@screens/onboarding/PaywallScreen';
import { ProgressSummaryScreen } from '@screens/onboarding/ProgressSummaryScreen';
// LAUNCH_SIMPLIFICATION: Tracking preference hidden - all users get full_atlas (227 countries)
// import TrackingPreferenceScreen from '@screens/onboarding/TrackingPreferenceScreen';
import { WelcomeCarouselScreen } from '@screens/onboarding/WelcomeCarouselScreen';
import {
  SlideWithScalePreset,
  ParallaxSlidePreset,
  ZoomRevealPreset,
  SlideWithLeadPreset,
  ContinentZoomPreset,
  DramaticRevealPreset,
  CollectPreset,
  OnboardingSlidePreset,
} from './interpolators';

import type { OnboardingStackParamList } from './types';

const Stack = createBlankStackNavigator<OnboardingStackParamList>();

/**
 * OnboardingNavigator with unique per-screen transitions
 *
 * Each transition is designed to reinforce the emotional narrative:
 * - WelcomeCarousel → OnboardingSlider: Parallax slide (beginning the journey)
 * - OnboardingSlider → Motivation: Zoom reveal (step back and reflect)
 * - Motivation → HomeCountry: Lead motion (pin leading to map)
 * - HomeCountry → TrackingPreference: Default slide (continuation)
 * - TrackingPreference → DreamDestination: Default slide (continuation)
 * - DreamDestination → ContinentIntro: Continent zoom (explore the map)
 * - ContinentIntro → ContinentCountryGrid: Default slide (into details)
 * - ContinentCountryGrid cycles: Default slide (progress through regions)
 * - AntarcticaPrompt → ProgressSummary: Dramatic reveal (celebration moment)
 * - ProgressSummary → NameEntry: Collect animation (making it official)
 * - NameEntry → AccountCreation: Default slide (sealing the deal)
 */
export function OnboardingNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        // Default transition for screens without specific overrides
        ...OnboardingSlidePreset,
      }}
    >
      {/* First screen - no incoming transition needed */}
      <Stack.Screen name="WelcomeCarousel" component={WelcomeCarouselScreen} />

      {/* WelcomeCarousel → OnboardingSlider: Parallax slide with depth */}
      <Stack.Screen
        name="OnboardingSlider"
        component={OnboardingSliderScreen}
        options={ParallaxSlidePreset}
      />

      {/* OnboardingSlider → Motivation: Zoom-out reveal */}
      <Stack.Screen name="Motivation" component={MotivationScreen} options={ZoomRevealPreset} />

      {/* Motivation → HomeCountry: Slide with pin leading motion */}
      <Stack.Screen
        name="HomeCountry"
        component={HomeCountryScreen}
        options={SlideWithLeadPreset}
      />

      {/* LAUNCH_SIMPLIFICATION: Tracking preference hidden - all users get full_atlas (227 countries) */}
      {/* <Stack.Screen name="TrackingPreference" component={TrackingPreferenceScreen} /> */}

      {/* DreamDestination: Default onboarding slide */}
      <Stack.Screen name="DreamDestination" component={DreamDestinationScreen} />

      {/* DreamDestination → ContinentIntro: Continent zoom effect */}
      <Stack.Screen
        name="ContinentIntro"
        component={ContinentIntroScreen}
        options={ContinentZoomPreset}
      />

      {/* ContinentCountryGrid: Default slide for cycling through regions */}
      <Stack.Screen name="ContinentCountryGrid" component={ContinentCountryGridScreen} />

      {/* AntarcticaPrompt: Default slide */}
      <Stack.Screen name="AntarcticaPrompt" component={AntarcticaPromptScreen} />

      {/* AntarcticaPrompt → ProgressSummary: Dramatic reveal */}
      <Stack.Screen
        name="ProgressSummary"
        component={ProgressSummaryScreen}
        options={DramaticRevealPreset}
      />

      {/* LAUNCH_SIMPLIFICATION: Paywall hidden for initial launch */}
      {/* <Stack.Screen name="Paywall" component={PaywallScreen} /> */}

      {/* ProgressSummary → NameEntry: Stamps collecting into passport */}
      <Stack.Screen name="NameEntry" component={NameEntryScreen} options={CollectPreset} />

      {/* NameEntry → AccountCreation: Default slide (sealing the deal) */}
      <Stack.Screen
        name="AccountCreation"
        component={AccountCreationScreen}
        options={SlideWithScalePreset}
      />
    </Stack.Navigator>
  );
}
