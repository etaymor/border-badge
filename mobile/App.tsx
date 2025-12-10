import { useEffect } from 'react';

import {
  useFonts,
  PlayfairDisplay_400Regular,
  PlayfairDisplay_700Bold,
} from '@expo-google-fonts/playfair-display';
import { DawningofaNewDay_400Regular } from '@expo-google-fonts/dawning-of-a-new-day';
import {
  OpenSans_400Regular,
  OpenSans_600SemiBold,
  OpenSans_700Bold,
} from '@expo-google-fonts/open-sans';
import { NavigationContainer } from '@react-navigation/native';
import { QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useCountriesSync } from '@hooks/useCountriesSync';
import { RootNavigator } from '@navigation/RootNavigator';
import { queryClient } from './src/queryClient';
import { clearTokens, getOnboardingComplete, setSignOutCallback, storeTokens } from '@services/api';
import { supabase } from '@services/supabase';
import { useAuthStore } from '@stores/authStore';

export default function App() {
  const { signOut, setSession, setIsLoading, setHasCompletedOnboarding } = useAuthStore();

  const [fontsLoaded] = useFonts({
    PlayfairDisplay_400Regular,
    PlayfairDisplay_700Bold,
    DawningofaNewDay_400Regular,
    OpenSans_400Regular,
    OpenSans_600SemiBold,
    OpenSans_700Bold,
  });

  // Sync countries to local SQLite database on app launch
  // The hook handles errors internally - sync failures don't block the app
  const syncState = useCountriesSync();

  // Log sync errors for debugging (users will see empty lists but we'll know why)
  useEffect(() => {
    if (syncState.error) {
      console.error('Countries sync failed:', syncState.error);
    }
  }, [syncState.error]);

  useEffect(() => {
    // Wire up API sign-out callback
    setSignOutCallback(signOut);

    // TODO: [Memory] Use ref to track mounted state - if component unmounts before
    // initAuth completes, subscription callback can fire on unmounted component
    let subscription: { unsubscribe: () => void } | null = null;
    let isMounted = true;

    const initAuth = async () => {
      try {
        // First restore existing session
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (session) {
          setSession(session);
          await storeTokens(session.access_token, session.refresh_token ?? '');
          // Restore onboarding state for returning users
          const onboardingComplete = await getOnboardingComplete();
          if (onboardingComplete) {
            setHasCompletedOnboarding(true);
          }
        }
      } catch (error) {
        console.error('Failed to restore session:', error);
      } finally {
        setIsLoading(false);
      }

      // Then set up listener for future changes (after session restore completes)
      const {
        data: { subscription: sub },
      } = supabase.auth.onAuthStateChange(async (event, session) => {
        // Skip INITIAL_SESSION as we already handled it above
        if (event === 'INITIAL_SESSION') return;
        // Guard against updates after unmount
        if (!isMounted) return;

        console.log('Auth state changed:', event);
        setSession(session);
        if (session) {
          await storeTokens(session.access_token, session.refresh_token ?? '');
        } else {
          // User signed out - reset onboarding state so they see WelcomeCarousel
          setHasCompletedOnboarding(false);
          await clearTokens();
        }
      });
      subscription = sub;
    };

    initAuth();

    return () => {
      isMounted = false;
      subscription?.unsubscribe();
    };
  }, [signOut, setSession, setIsLoading, setHasCompletedOnboarding]);

  if (!fontsLoaded) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <SafeAreaProvider>
          <NavigationContainer>
            <RootNavigator />
            <StatusBar style="auto" />
          </NavigationContainer>
        </SafeAreaProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
