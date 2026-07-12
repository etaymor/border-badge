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
          // Suspend off-screen screens' re-renders (requires enableFreeze() in App.tsx).
          //
          // Do NOT add `detachPreviousScreen` here. react-native-screen-transitions
          // derives activeScreensLimit from the top route's descriptor; setting the
          // flag collapses the limit from 2 to 1, which drives the screen directly
          // beneath the top route to activityState 0 and freezes it. This root stack
          // is 2-deep (Main → PaywallModal/Auth), so that screen is exactly the one
          // that must stay live and co-animate under the pop — detaching it kills the
          // pop animation and flashes on return, and buys nothing (no deeper screens).
          freezeOnBlur: true,
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
