import { useCallback, useEffect } from 'react';
import { Linking, LogBox } from 'react-native';
import { enableFreeze } from 'react-native-screens';

// Suspend off-screen native screens from re-rendering. Must run once at module
// load before any navigators mount. Pairs with freezeOnBlur on heavy stacks
// (notably OnboardingNavigator).
enableFreeze(true);

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
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
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
import { useInviteLinkHandler } from '@hooks/useInviteLinkHandler';
import { useNavigationPersistence } from '@hooks/useNavigationPersistence';
import { useShareExtensionHandler } from '@hooks/useShareExtensionHandler';
import { socialKeys } from '@hooks/queryKeys';
import { fetchSocialHomePage, SOCIAL_HOME_DEFAULT_LIMIT } from '@hooks/useSocialHome';
import { linking, shouldHandleUrlWithNavigation } from '@navigation/linking';
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
import { features } from '@config/features';
import { useAuthStore, selectSession } from '@stores/authStore';
import { useOnboardingStore, selectHomeCountry } from '@stores/onboardingStore';
import { useFrameMetrics, PerfOverlay } from '@utils/perf';

// Prevent the native splash screen from auto-hiding
SplashScreen.preventAutoHideAsync();

// Navigation container ref for programmatic navigation
const navigationRef = createNavigationContainerRef<RootStackParamList>();

// Persists the React Query cache (incl. the prefetched social home payload)
// across launches for instant cold-start rendering.
const queryPersister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: 'atlasi-query-cache',
  throttleTime: 1000,
});

// Deep linking configuration lives in @navigation/linking: universal
// links (/u, /t, /l) are handled by React Navigation; share-extension, auth
// callback, and invite URLs are filtered out for the manual handlers below.

// Initialize analytics, RevenueCat, and sync API URL to App Group for Share Extension
function useAppInitialization() {
  useEffect(() => {
    void initAnalytics();
    initializeRevenueCat().catch((error) => {
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
  const session = useAuthStore(selectSession);
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

  // Prefetch the social home feed so the Friends tab renders instantly.
  // Only runs when social features are enabled.
  useEffect(() => {
    if (!features.enableSocial || !session?.user?.id) {
      return;
    }

    queryClient
      .prefetchInfiniteQuery({
        queryKey: socialKeys.socialHomePage(SOCIAL_HOME_DEFAULT_LIMIT),
        queryFn: ({ pageParam }) =>
          fetchSocialHomePage(SOCIAL_HOME_DEFAULT_LIMIT, (pageParam as string | null) ?? null),
        initialPageParam: null,
      })
      .catch((error) => {
        console.warn('Prefetch social home failed:', error);
      });
  }, [session?.user?.id]);

  // Auth session management
  const { isAppReady } = useAuthSession();

  // Share extension deep link handling
  const { handleNavigationReady: handleShareNavigationReady, checkAppGroupForSharedURL } =
    useShareExtensionHandler(navigationRef, session);

  // Invite deep link handling (/invite?code=...)
  const { handleNavigationReady: handleInviteNavigationReady } = useInviteLinkHandler(
    navigationRef,
    session
  );

  const handleNavigationReady = useCallback(() => {
    handleShareNavigationReady();
    handleInviteNavigationReady();
  }, [handleShareNavigationReady, handleInviteNavigationReady]);

  // Navigation state persistence
  const { isNavigationReady, initialNavigationState, handleNavigationStateChange } =
    useNavigationPersistence(session);

  // Cold-start precedence: when the app is launched from a universal
  // link that React Navigation should handle (/u, /t, /l), the link wins
  // over restored navigation state — passing `initialState` would otherwise
  // suppress linking's initial-URL handling entirely.
  const [initialUrlChecked, setInitialUrlChecked] = useState(false);
  const [linkingOwnsInitialUrl, setLinkingOwnsInitialUrl] = useState(false);
  useEffect(() => {
    Linking.getInitialURL()
      .then((url) => {
        setLinkingOwnsInitialUrl(!!url && shouldHandleUrlWithNavigation(url));
        setInitialUrlChecked(true);
      })
      .catch(() => {
        setInitialUrlChecked(true);
      });
  }, []);

  // App foreground/background tracking
  useAppStateTracking(session, checkAppGroupForSharedURL, homeCountry);

  // Dev-gated frame-drop instrumentation (U1). No-op unless the harness is armed.
  useFrameMetrics();

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

  if (!fontsLoaded || !isNavigationReady || !initialUrlChecked) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{
          persister: queryPersister,
          maxAge: 1000 * 60 * 60 * 24, // 24 hours
          buster: 'v2',
        }}
      >
        <SafeAreaProvider>
          <ResponsiveProvider>
            <NavigationContainer
              ref={navigationRef}
              linking={linking}
              initialState={linkingOwnsInitialUrl ? undefined : initialNavigationState}
              onStateChange={handleNavigationStateChange}
              onReady={handleNavigationReady}
            >
              <RootNavigator />
              <StatusBar style="auto" />
            </NavigationContainer>
            <PerfOverlay />
            {showSplash && (
              <AnimatedSplash
                isAppReady={isAppReady}
                onAnimationComplete={handleSplashComplete}
                onSplashVisible={handleSplashVisible}
              />
            )}
          </ResponsiveProvider>
        </SafeAreaProvider>
      </PersistQueryClientProvider>
    </GestureHandlerRootView>
  );
}
