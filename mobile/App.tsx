import { useEffect } from 'react';

import { NavigationContainer } from '@react-navigation/native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useCountriesSync } from '@hooks/useCountriesSync';
import { RootNavigator } from '@navigation/RootNavigator';
import { clearTokens, setSignOutCallback, storeTokens } from '@services/api';
import { supabase } from '@services/supabase';
import { useAuthStore } from '@stores/authStore';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      gcTime: 1000 * 60 * 30, // 30 minutes - keep unused data in cache longer
      retry: 2,
      refetchOnWindowFocus: false, // Don't refetch when app comes to foreground
      refetchOnReconnect: true, // Refetch when network reconnects
    },
    mutations: {
      retry: 1,
    },
  },
});

export default function App() {
  const { signOut, setSession, setIsLoading } = useAuthStore();

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
  }, [signOut, setSession, setIsLoading]);

  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <NavigationContainer>
          <RootNavigator />
          <StatusBar style="auto" />
        </NavigationContainer>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}
