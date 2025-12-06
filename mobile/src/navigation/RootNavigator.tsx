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
  const { session, hasCompletedOnboarding, isLoading } = useAuthStore();

  if (isLoading) {
    return <LoadingScreen />;
  }

  // Show onboarding if user has no session AND hasn't completed onboarding
  // After completing onboarding (which creates an account), they'll have a session
  const showOnboarding = !session && !hasCompletedOnboarding;

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {showOnboarding ? (
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
