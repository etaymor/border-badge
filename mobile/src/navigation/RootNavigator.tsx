import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { createBlankStackNavigator } from 'react-native-screen-transitions/blank-stack';

import ErrorBoundary from '@components/ui/ErrorBoundary';
import {
  useAuthStore,
  selectSession,
  selectHasCompletedOnboarding,
  selectIsLoading,
} from '@stores/authStore';

import { PaywallModalScreen } from '@screens/paywall';

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
  const session = useAuthStore(selectSession);
  const hasCompletedOnboarding = useAuthStore(selectHasCompletedOnboarding);
  const isLoading = useAuthStore(selectIsLoading);
  const needsPostSignupFlow = useAuthStore((s) => s.needsPostSignupFlow);

  if (isLoading) {
    return <LoadingScreen />;
  }

  const isUnauthenticated = !session;
  const shouldShowOnboarding =
    (isUnauthenticated && !hasCompletedOnboarding) || needsPostSignupFlow;

  return (
    <ErrorBoundary>
      <Stack.Navigator
        screenOptions={{
          ...SlideWithScalePreset,
        }}
      >
        {shouldShowOnboarding ? (
          <>
            <Stack.Screen name="Onboarding" component={OnboardingNavigator} />
            {isUnauthenticated && <Stack.Screen name="Auth" component={AuthNavigator} />}
          </>
        ) : isUnauthenticated ? (
          <Stack.Screen name="Auth" component={AuthNavigator} />
        ) : (
          <>
            <Stack.Screen name="Main" component={MainTabNavigator} />
            <Stack.Screen name="PaywallModal" component={PaywallModalScreen} />
          </>
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
