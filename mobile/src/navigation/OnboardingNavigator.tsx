import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { ForgotPasswordScreen } from '@screens/auth/ForgotPasswordScreen';
import { LoginScreen } from '@screens/auth/LoginScreen';
import { SignUpScreen } from '@screens/auth/SignUpScreen';
import { AccountCreationScreen } from '@screens/onboarding/AccountCreationScreen';
import { ContinentCountryGridScreen } from '@screens/onboarding/ContinentCountryGridScreen';
import { ContinentIntroScreen } from '@screens/onboarding/ContinentIntroScreen';
import { DreamDestinationScreen } from '@screens/onboarding/DreamDestinationScreen';
import { HomeCountryScreen } from '@screens/onboarding/HomeCountryScreen';
import { MotivationScreen } from '@screens/onboarding/MotivationScreen';
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
      <Stack.Screen name="Motivation" component={MotivationScreen} />
      <Stack.Screen name="HomeCountry" component={HomeCountryScreen} />
      <Stack.Screen name="DreamDestination" component={DreamDestinationScreen} />
      <Stack.Screen name="ContinentIntro" component={ContinentIntroScreen} />
      <Stack.Screen name="ContinentCountryGrid" component={ContinentCountryGridScreen} />
      <Stack.Screen name="ProgressSummary" component={ProgressSummaryScreen} />
      <Stack.Screen name="Paywall" component={PaywallScreen} />
      <Stack.Screen name="AccountCreation" component={AccountCreationScreen} />
      {/* Auth screens accessible from onboarding */}
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="SignUp" component={SignUpScreen} />
      <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
    </Stack.Navigator>
  );
}
