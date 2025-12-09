import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { AccountCreationScreen } from '@screens/onboarding/AccountCreationScreen';
import { AntarcticaPromptScreen } from '@screens/onboarding/AntarcticaPromptScreen';
import { ContinentCountryGridScreen } from '@screens/onboarding/ContinentCountryGridScreen';
import { ContinentIntroScreen } from '@screens/onboarding/ContinentIntroScreen';
import { DreamDestinationScreen } from '@screens/onboarding/DreamDestinationScreen';
import { HomeCountryScreen } from '@screens/onboarding/HomeCountryScreen';
import { MotivationScreen } from '@screens/onboarding/MotivationScreen';
import { NameEntryScreen } from '@screens/onboarding/NameEntryScreen';
import { OnboardingSliderScreen } from '@screens/onboarding/OnboardingSliderScreen';
import { PaywallScreen } from '@screens/onboarding/PaywallScreen';
import { ProgressSummaryScreen } from '@screens/onboarding/ProgressSummaryScreen';
import { WelcomeCarouselScreen } from '@screens/onboarding/WelcomeCarouselScreen';

import type { OnboardingStackParamList } from './types';

const Stack = createNativeStackNavigator<OnboardingStackParamList>();

export function OnboardingNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
      }}
    >
      <Stack.Screen name="WelcomeCarousel" component={WelcomeCarouselScreen} />
      <Stack.Screen name="OnboardingSlider" component={OnboardingSliderScreen} />
      <Stack.Screen name="Motivation" component={MotivationScreen} />
      <Stack.Screen name="HomeCountry" component={HomeCountryScreen} />
      <Stack.Screen name="DreamDestination" component={DreamDestinationScreen} />
      <Stack.Screen name="ContinentIntro" component={ContinentIntroScreen} />
      <Stack.Screen name="ContinentCountryGrid" component={ContinentCountryGridScreen} />
      <Stack.Screen name="AntarcticaPrompt" component={AntarcticaPromptScreen} />
      <Stack.Screen name="ProgressSummary" component={ProgressSummaryScreen} />
      <Stack.Screen name="Paywall" component={PaywallScreen} />
      <Stack.Screen name="NameEntry" component={NameEntryScreen} />
      <Stack.Screen name="AccountCreation" component={AccountCreationScreen} />
    </Stack.Navigator>
  );
}
