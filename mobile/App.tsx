import { useCallback, useEffect } from 'react';
import { LogBox } from 'react-native';

// Suppress known harmless Reanimated warnings about off-screen FlatList items
LogBox.ignoreLogs([
  '[Reanimated] The view has some undefined, not-yet-computed or meaningless value of `LayoutMetrics` type',
]);

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
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { QueryClientProvider } from '@tanstack/react-query';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useRef, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AnimatedSplash } from '@components/splash';
import { ResponsiveProvider } from '@contexts/ResponsiveContext';
import { useAppStateTracking } from '@hooks/useAppStateTracking';
import { useAuthSession } from '@hooks/useAuthSession';
import { useCountriesSync } from '@hooks/useCountriesSync';
import { useNavigationPersistence } from '@hooks/useNavigationPersistence';
import { useShareExtensionHandler } from '@hooks/useShareExtensionHandler';
import { RootNavigator } from '@navigation/RootNavigator';
import type { RootStackParamList } from '@navigation/types';
import { queryClient } from './src/queryClient';
import { initAnalytics } from '@services/analytics';
import { initializeRevenueCat } from '@services/revenueCat';
import {
  syncApiUrlToAppGroup,
  syncShareExtensionUsageFromAppGroup,
} from '@services/shareExtensionBridge';
import { env } from '@config/env';
import { useAuthStore } from '@stores/authStore';
import { useOnboardingStore, selectHomeCountry } from '@stores/onboardingStore';
import { useSubscriptionStore } from '@stores/subscriptionStore';

// Prevent the native splash screen from auto-hiding
SplashScreen.preventAutoHideAsync();

// Navigation container ref for programmatic navigation
const navigationRef = createNavigationContainerRef<RootStackParamList>();

/**
 * Deep linking configuration for the app.
 * Handles atlasi:// URLs from the Share Extension.
 */
const linking = {
  prefixes: ['atlasi://'],
  config: {
    screens: {
      Main: {
        screens: {
          Passport: {
            screens: {
              ShareCapture: {
                path: 'share',
                parse: {
                  url: (value: string) => decodeURIComponent(value),
                },
              },
              CountryDetail: 'country/:countryId',
            },
          },
        },
      },
    },
  },
};

// Initialize analytics, RevenueCat, and sync API URL to App Group for Share Extension
function useAppInitialization() {
  useEffect(() => {
    void initAnalytics();
    initializeRevenueCat()
      .then(() => {
        return useSubscriptionStore.getState().fetchCustomerInfo();
      })
      .catch((error) => {
        console.error('Failed to initialize RevenueCat:', error);
      });
    syncApiUrlToAppGroup(env.apiUrl).catch((error) => {
      console.error('Failed to sync API URL to App Group:', error);
    });
    syncShareExtensionUsageFromAppGroup().catch((error) => {
      console.error('Failed to sync share extension usage:', error);
    });
  }, []);
}

export default function App() {
  const { session } = useAuthStore();
  const homeCountry = useOnboardingStore(selectHomeCountry);
  const [showSplash, setShowSplash] = useState(true);
  const nativeSplashHiddenRef = useRef(false);

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
  const syncState = useCountriesSync();
  useEffect(() => {
    if (syncState.error) {
      console.error('Countries sync failed:', syncState.error);
    }
  }, [syncState.error]);

  // Initialize third-party services
  useAppInitialization();

  // Auth session management
  const { isAppReady } = useAuthSession();

  // Share extension deep link handling
  const { handleNavigationReady, checkAppGroupForSharedURL } = useShareExtensionHandler(
    navigationRef,
    session
  );

  // Navigation state persistence
  const { isNavigationReady, initialNavigationState, handleNavigationStateChange } =
    useNavigationPersistence(session);

  // App foreground/background tracking
  useAppStateTracking(session, checkAppGroupForSharedURL, homeCountry);

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

  if (!fontsLoaded || !isNavigationReady) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <SafeAreaProvider>
          <ResponsiveProvider>
            <NavigationContainer
              ref={navigationRef}
              linking={linking}
              initialState={initialNavigationState}
              onStateChange={handleNavigationStateChange}
              onReady={handleNavigationReady}
            >
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
          </ResponsiveProvider>
        </SafeAreaProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
