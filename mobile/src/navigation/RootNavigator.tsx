import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { useAuthStore } from '@stores/authStore';

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
  const { session, isGuest, hasCompletedOnboarding, isLoading, setIsGuest } = useAuthStore();

  // Auto-start as guest if no session and not already a guest
  useEffect(() => {
    if (!isLoading && !session && !isGuest) {
      setIsGuest(true);
    }
  }, [isLoading, session, isGuest, setIsGuest]);

  if (isLoading) {
    return <LoadingScreen />;
  }

  // If still waiting for guest mode to be set, show loading
  if (!session && !isGuest) {
    return <LoadingScreen />;
  }

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {!hasCompletedOnboarding ? (
        <Stack.Screen name="Onboarding" component={OnboardingNavigator} />
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
