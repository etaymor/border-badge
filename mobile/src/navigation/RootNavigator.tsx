import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { createBlankStackNavigator } from 'react-native-screen-transitions/blank-stack';

import { useAuthStore } from '@stores/authStore';

import { AuthNavigator } from './AuthNavigator';
// LAUNCH_SIMPLIFICATION: Tab bar hidden for initial launch
// TODO: Re-enable MainTabNavigator when ready to add Dreams, Trips List, and Friends features
// import { MainTabNavigator } from './MainTabNavigator';
import { PassportNavigator } from './PassportNavigator';
import { OnboardingNavigator } from './OnboardingNavigator';
import { SlideWithScalePreset } from './interpolators';
import type { RootStackParamList } from './types';

const Stack = createBlankStackNavigator<RootStackParamList>();

function LoadingScreen() {
  return (
    <View style={styles.loading} testID="loading-screen">
      <ActivityIndicator size="large" color="#007AFF" />
    </View>
  );
}

export function RootNavigator() {
  const { session, hasCompletedOnboarding, isLoading } = useAuthStore();

  if (isLoading) {
    return <LoadingScreen />;
  }

  // When unauthenticated, show onboarding (if incomplete) and keep auth stack available
  const isUnauthenticated = !session;
  const shouldShowOnboarding = isUnauthenticated && !hasCompletedOnboarding;

  return (
    <Stack.Navigator
      screenOptions={{
        ...SlideWithScalePreset,
      }}
    >
      {isUnauthenticated ? (
        <>
          {shouldShowOnboarding && (
            <Stack.Screen name="Onboarding" component={OnboardingNavigator} />
          )}
          <Stack.Screen name="Auth" component={AuthNavigator} />
        </>
      ) : (
        // LAUNCH_SIMPLIFICATION: Using PassportNavigator directly instead of MainTabNavigator
        // This hides the tab bar and simplifies the app for initial launch
        // TODO: Replace with MainTabNavigator when ready to re-enable Dreams, Trips List, and Friends
        <Stack.Screen name="Main" component={PassportNavigator} />
      )}
    </Stack.Navigator>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
});
