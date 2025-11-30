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
      retry: 2,
    },
  },
});

export default function App() {
  const { signOut, setSession, setIsLoading } = useAuthStore();

  // Sync countries to local SQLite database on app launch
  // The hook runs on mount and syncs data to SQLite; we don't need the return value here
  useCountriesSync();

  useEffect(() => {
    // Wire up API sign-out callback
    setSignOutCallback(signOut);

    // Restore session on app launch
    const restoreSession = async () => {
      try {
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
    };

    restoreSession();

    // Subscribe to auth state changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('Auth state changed:', event);
      setSession(session);
      if (session) {
        await storeTokens(session.access_token, session.refresh_token ?? '');
      } else {
        await clearTokens();
      }
    });

    return () => {
      subscription.unsubscribe();
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
