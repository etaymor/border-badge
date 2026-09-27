import type { ComponentProps } from 'react';
import { createBlankStackNavigator } from 'react-native-screen-transitions/blank-stack';

import { useAuthStore } from '@stores/authStore';
import { AccountCreationScreen } from '@screens/onboarding/AccountCreationScreen';
import { AntarcticaPromptScreen } from '@screens/onboarding/AntarcticaPromptScreen';
import { ContinentCountryGridScreen } from '@screens/onboarding/ContinentCountryGridScreen';
import { ContinentIntroScreen } from '@screens/onboarding/ContinentIntroScreen';
import { DreamDestinationScreen } from '@screens/onboarding/DreamDestinationScreen';
import { HomeCountryScreen } from '@screens/onboarding/HomeCountryScreen';
import { MotivationScreen } from '@screens/onboarding/MotivationScreen';
import { EmotionalHookScreen } from '@screens/onboarding/EmotionalHookScreen';
import { FirstQuizOfferScreen } from '@screens/onboarding/FirstQuizOfferScreen';
import { FunctionalHookScreen } from '@screens/onboarding/FunctionalHookScreen';
import { NameEntryScreen } from '@screens/onboarding/NameEntryScreen';
import { OnboardingSliderScreen } from '@screens/onboarding/OnboardingSliderScreen';
import { PaywallScreen } from '@screens/onboarding/PaywallScreen';
import { ProgressSummaryScreen } from '@screens/onboarding/ProgressSummaryScreen';
// LAUNCH_SIMPLIFICATION: Tracking preference hidden - all users get full_atlas (227 countries)
// import TrackingPreferenceScreen from '@screens/onboarding/TrackingPreferenceScreen';
import { OnboardingPushPreset } from './interpolators';

import { OnboardingStackLayout } from './OnboardingStackLayout';
import type { OnboardingStackParamList } from './types';

const Stack = createBlankStackNavigator<OnboardingStackParamList>();

type StackLayoutProps = Parameters<
  NonNullable<ComponentProps<typeof Stack.Navigator>['layout']>
>[0];

// Module-level so the navigator's `layout` keeps a stable identity. It renders
// the one shared onboarding header above the stack (see OnboardingStackLayout).
function renderStackLayout({ state, navigation, children }: StackLayoutProps) {
  return (
    <OnboardingStackLayout state={state} navigation={navigation}>
      {children}
    </OnboardingStackLayout>
  );
}

/**
 * OnboardingNavigator
 *
 * Every screen uses the same push (OnboardingPushPreset): the new screen
 * slides in from the right, fully opaque, on one snappy spring for the whole
 * flow. Because `detachPreviousScreen` detaches the screen beneath the top one,
 * the underlayer isn't live during push/pop: there is nothing to dim (a dim
 * overlay only tinted the bare background grey), and the stack background
 * shows through instead, so OnboardingStackLayout paints it cream. Screens never scale, move
 * vertically or fade, because the shared onboarding header (rendered once by
 * `layout`, see OnboardingStackLayout) stays fixed above the stack while only
 * screen content moves (see interpolators/onboarding.ts).
 *
 * Flow: OnboardingSlider → Motivation → HomeCountry → DreamDestination →
 * ContinentIntro (→ ContinentCountryGrid, per region) → AntarcticaPrompt →
 * ProgressSummary → NameEntry → AccountCreation → EmotionalHook →
 * FunctionalHook → Paywall → FirstQuizOffer (post-signup flow; the offer
 * screen finishes it)
 */
export function OnboardingNavigator() {
  const needsPostSignupFlow = useAuthStore((s) => s.needsPostSignupFlow);

  return (
    <Stack.Navigator
      layout={renderStackLayout}
      screenOptions={{
        // The one onboarding push for every screen (no per-screen overrides)
        ...OnboardingPushPreset,
        // Suspend off-screen onboarding screens from re-rendering. Requires
        // enableFreeze() at app root (see App.tsx). With ~14 onboarding screens
        // (including 6 country grids and several video screens), this prevents
        // the cumulative lag the user notices by the end of the flow.
        freezeOnBlur: true,
        // Detach buried onboarding screens so react-freeze actually engages.
        // freezeOnBlur alone never froze anything here: the blank-stack's
        // active-screens window only shrinks past a screen that declares
        // `detachPreviousScreen`, so without it every screen stayed active
        // (activityState = 1) and kept running store updates + animations.
        // Applying it on screenOptions covers every route — including each
        // ContinentIntro instance pushed by the "No" chain — so screens below
        // the top freeze. Detach does NOT unmount; back-navigation still
        // restores the previous screen, so the intentional ContinentIntro "No"
        // push chain and grid→intro back navigation keep working. No transition
        // preset changes; this only affects lifecycle (freeze), not motion.
        detachPreviousScreen: true,
      }}
      initialRouteName={needsPostSignupFlow ? 'EmotionalHook' : 'OnboardingSlider'}
    >
      {/* First screen - the animated intro */}
      <Stack.Screen name="OnboardingSlider" component={OnboardingSliderScreen} />

      <Stack.Screen name="Motivation" component={MotivationScreen} />

      <Stack.Screen name="HomeCountry" component={HomeCountryScreen} />

      {/* LAUNCH_SIMPLIFICATION: Tracking preference hidden - all users get full_atlas (227 countries) */}
      {/* <Stack.Screen name="TrackingPreference" component={TrackingPreferenceScreen} /> */}

      <Stack.Screen name="DreamDestination" component={DreamDestinationScreen} />

      {/* One instance per region; the "No" answer pushes the next region */}
      <Stack.Screen name="ContinentIntro" component={ContinentIntroScreen} />

      {/* Country grid for the region the user said "Yes" to */}
      <Stack.Screen name="ContinentCountryGrid" component={ContinentCountryGridScreen} />

      <Stack.Screen name="AntarcticaPrompt" component={AntarcticaPromptScreen} />

      <Stack.Screen name="ProgressSummary" component={ProgressSummaryScreen} />

      <Stack.Screen name="NameEntry" component={NameEntryScreen} />

      {/* Create account before paywall so RevenueCat purchases attach to the
          Supabase UUID */}
      <Stack.Screen name="AccountCreation" component={AccountCreationScreen} />

      {/* AccountCreation → EmotionalHook: Value proposition (memories) */}
      <Stack.Screen name="EmotionalHook" component={EmotionalHookScreen} />

      {/* EmotionalHook → FunctionalHook: Value proposition (social saving) */}
      <Stack.Screen name="FunctionalHook" component={FunctionalHookScreen} />

      {/* FunctionalHook → Paywall: Show subscription options (user is now authenticated) */}
      <Stack.Screen name="Paywall" component={PaywallScreen} />

      {/* Paywall → FirstQuizOffer: post-paywall "make your first quiz" offer.
          The offer owns finishing the post-signup flow; accept arms
          pendingFirstQuizLaunch so Main opens QuizCreation on arrival. */}
      <Stack.Screen name="FirstQuizOffer" component={FirstQuizOfferScreen} />
    </Stack.Navigator>
  );
}
