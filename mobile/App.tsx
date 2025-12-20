import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import * as Crypto from 'expo-crypto';

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
import { Oswald_500Medium, Oswald_700Bold } from '@expo-google-fonts/oswald';
import { NavigationContainer } from '@react-navigation/native';
import { QueryClientProvider } from '@tanstack/react-query';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AnimatedSplash } from '@components/splash';
import { useCountriesSync } from '@hooks/useCountriesSync';
import { RootNavigator } from '@navigation/RootNavigator';
import { queryClient } from './src/queryClient';
import { clearTokens, getOnboardingComplete, setSignOutCallback, storeTokens } from '@services/api';
import { Analytics, identifyUser, initAnalytics, resetUser } from '@services/analytics';
import { supabase } from '@services/supabase';
import { useAuthStore } from '@stores/authStore';

// Prevent the native splash screen from auto-hiding
SplashScreen.preventAutoHideAsync();

// Generate a cryptographically secure session ID for app_opened events
function generateSessionId(): string {
  return Crypto.randomUUID();
}

export default function App() {
  const { signOut, setSession, setIsLoading, setHasCompletedOnboarding, session } = useAuthStore();
  const [showSplash, setShowSplash] = useState(true);
  const [isAppReady, setIsAppReady] = useState(false);
  const nativeSplashHiddenRef = useRef(false);
  const appStateRef = useRef(AppState.currentState);
  const sessionIdRef = useRef(generateSessionId());
  const hasTrackedInitialOpenRef = useRef(false);

  const [fontsLoaded] = useFonts({
    PlayfairDisplay_400Regular,
    PlayfairDisplay_700Bold,
    DawningofaNewDay_400Regular,
    OpenSans_400Regular,
    OpenSans_600SemiBold,
    OpenSans_700Bold,
    Oswald_500Medium,
    Oswald_700Bold,
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

  // Initialize analytics
  useEffect(() => {
    initAnalytics();
  }, []);

  // Track app_opened when app comes to foreground
  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      // Track when app comes to foreground (only if user is authenticated)
      if (
        appStateRef.current.match(/inactive|background/) &&
        nextAppState === 'active' &&
        session?.user?.id
      ) {
        // Generate new session ID for this foreground event
        sessionIdRef.current = generateSessionId();
        Analytics.appOpened(sessionIdRef.current);
      }
      appStateRef.current = nextAppState;
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);

    // Track initial app open if authenticated (only once to prevent double-tracking)
    if (session?.user?.id && !hasTrackedInitialOpenRef.current) {
      hasTrackedInitialOpenRef.current = true;
      Analytics.appOpened(sessionIdRef.current);
    }

    return () => {
      subscription.remove();
    };
  }, [session?.user?.id]);

  useEffect(() => {
    // Wire up API sign-out callback
    setSignOutCallback(signOut);

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
          // Identify user in analytics
          identifyUser(session.user.id);
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
        // Mark app as ready for the animated splash to transition
        setIsAppReady(true);
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
          // Identify user in analytics
          identifyUser(session.user.id);
        } else {
          // User signed out - clear tokens first, then reset onboarding state
          await clearTokens();
          setHasCompletedOnboarding(false);
          // Reset analytics user
          resetUser();
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

  // Handle splash animation complete
  const handleSplashComplete = useCallback(() => {
    setShowSplash(false);
  }, []);

  // Hide the native splash only once the animated splash is ready to display
  const handleSplashVisible = useCallback(() => {
    if (nativeSplashHiddenRef.current) {
      return;
    }
    nativeSplashHiddenRef.current = true;
    SplashScreen.hideAsync().catch((error) => {
      console.warn('Failed to hide native splash screen:', error);
    });
  }, []);

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
          {showSplash && (
            <AnimatedSplash
              isAppReady={isAppReady}
              onAnimationComplete={handleSplashComplete}
              onSplashVisible={handleSplashVisible}
            />
          )}
        </SafeAreaProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
