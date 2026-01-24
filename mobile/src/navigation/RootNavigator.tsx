import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { createBlankStackNavigator } from 'react-native-screen-transitions/blank-stack';

import ErrorBoundary from '@components/ui/ErrorBoundary';
import { useAuthStore } from '@stores/authStore';

import { AuthNavigator } from './AuthNavigator';
import { MainTabNavigator } from './MainTabNavigator';
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
    <ErrorBoundary>
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
          <Stack.Screen name="Main" component={MainTabNavigator} />
        )}
      </Stack.Navigator>
    </ErrorBoundary>
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
