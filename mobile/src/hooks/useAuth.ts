import { useMutation } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import { Alert } from 'react-native';

import { clearOnboardingComplete, clearTokens } from '@services/api';
import { queryClient } from '../queryClient';
import { supabase } from '@services/supabase';
import { useAuthStore } from '@stores/authStore';
import { useOnboardingStore } from '@stores/onboardingStore';
import { getAuthErrorMessage, getSafeLogMessage } from '@utils/authErrors';

// ============================================================================
// Email Magic Link Authentication Hooks
// ============================================================================

interface SendMagicLinkInput {
  email: string;
  displayName?: string; // Optional display name to set in user metadata
}

/**
 * Hook to send a magic link to an email address.
 * Uses Supabase signInWithOtp which handles both signup and login.
 * The magic link will redirect back to the app via deep link.
 */
export function useSendMagicLink() {
  return useMutation({
    mutationFn: async ({ email, displayName }: SendMagicLinkInput) => {
      // Create redirect URL for magic link callback
      const redirectUrl = Linking.createURL('auth-callback');

      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: redirectUrl,
          data: displayName ? { display_name: displayName } : undefined,
        },
      });
      if (error) throw error;
    },
    onError: (error) => {
      console.error('Magic link send failed:', getSafeLogMessage(error));
      const message = getAuthErrorMessage(error) || 'Failed to send magic link';
      Alert.alert('Error', message);
    },
  });
}

// ============================================================================
// Sign Out Hook
// ============================================================================

export function useSignOut() {
  const { signOut } = useAuthStore();
  const { reset: resetOnboarding } = useOnboardingStore();

  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    },
    onSuccess: async () => {
      signOut();
      resetOnboarding();
      queryClient.clear(); // Clear all cached data
      await clearTokens();
      await clearOnboardingComplete();
    },
    onError: (error) => {
      console.error('Sign out failed:', getSafeLogMessage(error));
      const message = getAuthErrorMessage(error) || 'Failed to sign out';
      Alert.alert('Sign Out Failed', message);
    },
  });
}
