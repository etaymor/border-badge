import { useEffect } from 'react';

import { NavigationContainer } from '@react-navigation/native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { RootNavigator } from '@navigation/RootNavigator';
import { setSignOutCallback } from '@services/api';
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
  const signOut = useAuthStore((state) => state.signOut);

  // Wire up API sign-out callback on mount
  useEffect(() => {
    setSignOutCallback(signOut);
  }, [signOut]);

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
