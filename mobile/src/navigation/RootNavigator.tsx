import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { useAuthStore } from '@stores/authStore';

import { AuthNavigator } from './AuthNavigator';
import { MainTabNavigator } from './MainTabNavigator';
import { OnboardingNavigator } from './OnboardingNavigator';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

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
    <Stack.Navigator screenOptions={{ headerShown: false }}>
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
