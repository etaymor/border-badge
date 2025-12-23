import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus, Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
import {
  NavigationContainer,
  NavigationState,
  createNavigationContainerRef,
} from '@react-navigation/native';
import { QueryClientProvider } from '@tanstack/react-query';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AnimatedSplash } from '@components/splash';
import { useCountriesSync } from '@hooks/useCountriesSync';
import { RootNavigator } from '@navigation/RootNavigator';
import type { ShareCaptureSource } from '@navigation/types';
// Note: RootStackParamList would be imported here for type-safe navigation,
// but during LAUNCH_SIMPLIFICATION the navigation structure doesn't match types
import { queryClient } from './src/queryClient';
import { clearTokens, getOnboardingComplete, setSignOutCallback, storeTokens } from '@services/api';
import { Analytics, identifyUser, initAnalytics, resetUser } from '@services/analytics';
import { isAuthCallbackDeepLink, processAuthCallback } from '@services/authCallback';
import {
  isShareExtensionDeepLink,
  parseDeepLinkParams,
  savePendingShare,
  getPendingShare,
  clearPendingShare,
} from '@services/shareExtensionBridge';
import { supabase } from '@services/supabase';
import { useAuthStore } from '@stores/authStore';
import {
  NAVIGATION_STATE_TTL_MS,
  NAVIGATION_STATE_VERSION,
  sanitizeNavigationState,
  isValidNavigationState,
  type PersistedNavigationState,
} from '@utils/navigationPersistence';

// Prevent the native splash screen from auto-hiding
SplashScreen.preventAutoHideAsync();

// Key for storing navigation state in AsyncStorage
const NAVIGATION_STATE_KEY = 'navigation-state';

// Generate a cryptographically secure session ID for app_opened events
function generateSessionId(): string {
  return Crypto.randomUUID();
}

// Navigation container ref for programmatic navigation
// Using any type due to LAUNCH_SIMPLIFICATION navigation structure
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const navigationRef = createNavigationContainerRef<any>();

/**
 * Deep linking configuration for the app.
 * Handles atlasi:// URLs from the Share Extension.
 *
 * Note: During LAUNCH_SIMPLIFICATION, Main uses PassportNavigator directly
 * which makes the type system complex. We use a minimal linking config
 * and handle ShareCapture navigation manually in the useEffect.
 */
const linking = {
  prefixes: ['atlasi://'],
  // Minimal config - actual ShareCapture navigation is handled manually
  // in the useEffect to avoid complex nested navigation types
  config: {
    screens: {},
  },
};

type ShareCaptureNavigationParams = {
  url: string;
  caption?: string;
  source: ShareCaptureSource;
};

export default function App() {
  const { signOut, setSession, setIsLoading, setHasCompletedOnboarding, session } = useAuthStore();
  const [showSplash, setShowSplash] = useState(true);
  const [isAppReady, setIsAppReady] = useState(false);
  const [isNavigationReady, setIsNavigationReady] = useState(false);
  const [initialNavigationState, setInitialNavigationState] = useState<
    NavigationState | undefined
  >();
  // Note: pendingShareUrl state could be added here for UI feedback (e.g., showing a banner)
  const nativeSplashHiddenRef = useRef(false);
  const appStateRef = useRef(AppState.currentState);
  const sessionIdRef = useRef(generateSessionId());
  const hasTrackedInitialOpenRef = useRef(false);
  const hasProcessedInitialDeepLinkRef = useRef(false);
  const pendingAuthedShareRef = useRef<ShareCaptureNavigationParams | null>(null);
  const shouldClearPendingShareRef = useRef(false);

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
    void initAnalytics();
  }, []);

  // Attempt to navigate to ShareCapture; queues the share if navigation isn't ready yet.
  const tryNavigateToShareCapture = useCallback(
    (params: ShareCaptureNavigationParams): 'navigated' | 'queued' | 'unauthenticated' => {
      if (!session?.user?.id) {
        return 'unauthenticated';
      }

      if (!navigationRef.isReady()) {
        pendingAuthedShareRef.current = params;
        return 'queued';
      }

      navigationRef.navigate('Main', {
        screen: 'ShareCapture',
        params,
      });
      pendingAuthedShareRef.current = null;
      return 'navigated';
    },
    [session?.user?.id]
  );

  const flushPendingAuthedShare = useCallback(() => {
    if (!pendingAuthedShareRef.current) return;

    const result = tryNavigateToShareCapture(pendingAuthedShareRef.current);
    if (result === 'navigated' && shouldClearPendingShareRef.current) {
      shouldClearPendingShareRef.current = false;
      void clearPendingShare();
    }
  }, [tryNavigateToShareCapture]);

  const processPendingShare = useCallback(async () => {
    if (!session?.user?.id) return;

    const pendingShare = await getPendingShare();
    if (pendingShare) {
      const result = tryNavigateToShareCapture({
        url: pendingShare.url,
        source: 'share_extension',
      });

      if (result === 'navigated') {
        await clearPendingShare();
      } else if (result === 'queued') {
        shouldClearPendingShareRef.current = true;
      }
    }
  }, [session?.user?.id, tryNavigateToShareCapture]);

  const handleNavigationReady = useCallback(() => {
    flushPendingAuthedShare();
    void processPendingShare();
  }, [flushPendingAuthedShare, processPendingShare]);

  // If user signs out before we could navigate, persist the queued share for later.
  useEffect(() => {
    if (session?.user?.id) {
      flushPendingAuthedShare();
      return;
    }

    if (pendingAuthedShareRef.current) {
      const urlToPersist = pendingAuthedShareRef.current.url;
      pendingAuthedShareRef.current = null;
      shouldClearPendingShareRef.current = false;
      void savePendingShare(urlToPersist);
    } else {
      shouldClearPendingShareRef.current = false;
    }
  }, [flushPendingAuthedShare, session?.user?.id]);

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

    // Reset tracking ref on sign out so next sign-in can track initial open
    if (!session?.user?.id) {
      hasTrackedInitialOpenRef.current = false;
      sessionIdRef.current = generateSessionId();
    }

    // Track initial app open if authenticated (only once to prevent double-tracking)
    if (session?.user?.id && !hasTrackedInitialOpenRef.current) {
      hasTrackedInitialOpenRef.current = true;
      Analytics.appOpened(sessionIdRef.current);
    }

    return () => {
      subscription.remove();
    };
  }, [session?.user?.id]);

  // Handle deep links: auth callbacks and share extension
  useEffect(() => {
    /**
     * Process an auth callback deep link (magic links, OAuth).
     * Extracts tokens and sets the Supabase session.
     */
    const handleAuthCallbackDeepLink = async (deepLinkUrl: string) => {
      if (!isAuthCallbackDeepLink(deepLinkUrl)) return;

      console.log('Processing auth callback deep link');
      const result = await processAuthCallback(deepLinkUrl);
      if (!result.success) {
        console.error('Failed to process auth callback:', result.error);
      }
    };

    /**
     * Process a share extension deep link.
     * Extracts the shared URL from the deep link query parameter and navigates to ShareCaptureScreen.
     */
    const handleShareDeepLink = async (deepLinkUrl: string) => {
      // Only process share extension deep links
      if (!isShareExtensionDeepLink(deepLinkUrl)) return;

      // Extract the shared URL from the deep link query parameter
      const params = parseDeepLinkParams(deepLinkUrl);
      const sharedUrl = params.url;

      if (sharedUrl) {
        const result = tryNavigateToShareCapture({
          url: sharedUrl,
          source: 'share_extension',
        });

        if (result === 'unauthenticated') {
          // User not authenticated - save for later
          await savePendingShare(sharedUrl);
        }
      }
    };

    /**
     * Route incoming deep links to the appropriate handler.
     */
    const handleDeepLink = async (deepLinkUrl: string) => {
      if (isAuthCallbackDeepLink(deepLinkUrl)) {
        await handleAuthCallbackDeepLink(deepLinkUrl);
      } else if (isShareExtensionDeepLink(deepLinkUrl)) {
        await handleShareDeepLink(deepLinkUrl);
      }
    };

    // Subscribe to deep link events
    const subscription = Linking.addEventListener('url', ({ url }) => {
      void handleDeepLink(url);
    });

    // Check for initial URL (app opened via deep link - auth callback or share extension)
    // This handles cold start scenarios where the app is opened via a magic link or share
    // Note: We set the ref inside the promise to avoid race conditions where a URL
    // could arrive between setting the ref and promise resolution
    if (!hasProcessedInitialDeepLinkRef.current) {
      Linking.getInitialURL()
        .then((url) => {
          // Set ref after getting URL to prevent race condition
          hasProcessedInitialDeepLinkRef.current = true;
          if (url) {
            void handleDeepLink(url);
          }
        })
        .catch((error) => {
          hasProcessedInitialDeepLinkRef.current = true;
          console.error('Failed to get initial deep link URL:', error);
        });
    }

    return () => {
      subscription.remove();
    };
  }, [tryNavigateToShareCapture]);

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

  // Restore navigation state on app launch (only for authenticated users)
  useEffect(() => {
    const restoreNavigationState = async () => {
      try {
        // Only restore navigation state if user is authenticated
        // This prevents navigating to auth-required screens before auth is ready
        if (!session) {
          setIsNavigationReady(true);
          return;
        }

        const savedData = await AsyncStorage.getItem(NAVIGATION_STATE_KEY);
        if (savedData) {
          const persisted = JSON.parse(savedData) as PersistedNavigationState;

          // Check version compatibility
          if (persisted.version !== NAVIGATION_STATE_VERSION) {
            console.warn('Navigation state version mismatch, discarding');
            await AsyncStorage.removeItem(NAVIGATION_STATE_KEY);
            setIsNavigationReady(true);
            return;
          }

          // Check TTL expiration
          const age = Date.now() - persisted.timestamp;
          if (age > NAVIGATION_STATE_TTL_MS) {
            console.warn('Navigation state expired, discarding');
            await AsyncStorage.removeItem(NAVIGATION_STATE_KEY);
            setIsNavigationReady(true);
            return;
          }

          // Validate state structure
          if (!isValidNavigationState(persisted.state)) {
            console.warn('Navigation state invalid, discarding');
            await AsyncStorage.removeItem(NAVIGATION_STATE_KEY);
            setIsNavigationReady(true);
            return;
          }

          setInitialNavigationState(persisted.state);
        }
      } catch (error) {
        console.warn('Failed to restore navigation state:', error);
        // Clean up corrupted state
        AsyncStorage.removeItem(NAVIGATION_STATE_KEY).catch(() => {});
      } finally {
        setIsNavigationReady(true);
      }
    };

    restoreNavigationState();
  }, [session]);

  // Clear navigation state when user signs out
  useEffect(() => {
    if (!session) {
      AsyncStorage.removeItem(NAVIGATION_STATE_KEY).catch((error) => {
        console.warn('Failed to clear navigation state:', error);
      });
    }
  }, [session]);

  // Save navigation state when it changes
  const handleNavigationStateChange = useCallback(
    (state: NavigationState | undefined) => {
      if (state && session) {
        // Sanitize state to remove sensitive params before persisting
        const sanitizedState = sanitizeNavigationState(state);
        const persistedState: PersistedNavigationState = {
          state: sanitizedState,
          timestamp: Date.now(),
          version: NAVIGATION_STATE_VERSION,
        };
        AsyncStorage.setItem(NAVIGATION_STATE_KEY, JSON.stringify(persistedState)).catch(
          (error) => {
            console.warn('Failed to save navigation state:', error);
          }
        );
      }
    },
    [session]
  );

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
        </SafeAreaProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
