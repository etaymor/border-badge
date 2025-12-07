import { useMutation } from '@tanstack/react-query';
import { Alert } from 'react-native';

import {
  clearOnboardingComplete,
  clearTokens,
  storeOnboardingComplete,
  storeTokens,
} from '@services/api';
import { migrateGuestData, MigrationResult } from '@services/guestMigration';
import { supabase } from '@services/supabase';
import { useAuthStore } from '@stores/authStore';
import { useOnboardingStore } from '@stores/onboardingStore';

// ============================================================================
// Phone OTP Authentication Hooks
// ============================================================================

interface SendOTPInput {
  phone: string; // E.164 format: +1234567890
}

interface VerifyOTPInput {
  phone: string; // E.164 format: +1234567890
  token: string; // 6-digit OTP code
  displayName?: string; // Optional display name for new users
}

interface VerifyOTPOptions {
  onMigrationComplete?: (result: MigrationResult) => void;
}

/**
 * Hook to send OTP code to a phone number.
 * Uses Supabase signInWithOtp which handles both signup and login.
 */
export function useSendOTP() {
  return useMutation({
    mutationFn: async ({ phone }: SendOTPInput) => {
      const { error } = await supabase.auth.signInWithOtp({
        phone,
      });
      if (error) throw error;
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Failed to send verification code';
      Alert.alert('Error', message);
    },
  });
}

/**
 * Hook to verify OTP code and establish session.
 * Handles both new users (runs migration) and returning users (skips migration).
 */
export function useVerifyOTP(options?: VerifyOTPOptions) {
  const { setSession, setHasCompletedOnboarding } = useAuthStore();

  return useMutation({
    mutationFn: async ({ phone, token, displayName }: VerifyOTPInput) => {
      const { data, error } = await supabase.auth.verifyOtp({
        phone,
        token,
        type: 'sms',
      });
      if (error) throw error;

      // If a display name is provided, persist it (non-blocking).
      // The session is already valid, so we don't want display name failures
      // to block the entire auth flow.
      const userId = data.session?.user.id ?? data.user?.id;
      if (displayName && userId) {
        const updateDisplayName = async () => {
          try {
            const { error: metadataError } = await supabase.auth.updateUser({
              data: { display_name: displayName },
            });
            if (metadataError) {
              console.warn('Failed to update user metadata:', metadataError.message);
            }
          } catch (error) {
            console.warn('Display name metadata update rejected:', error);
          }

          try {
            const { error: profileError } = await supabase
              .from('user_profile')
              .update({ display_name: displayName })
              .eq('user_id', userId);

            if (profileError) {
              console.warn('Failed to update user profile:', profileError.message);
            }
          } catch (error) {
            console.warn('Display name profile update rejected:', error);
          }
        };

        // Run asynchronously so auth/session flow is non-blocking
        void updateDisplayName();
      }

      return data;
    },
    onSuccess: async (data) => {
      if (data.session) {
        // Clear any stale tokens first, then store new ones
        await clearTokens();
        await storeTokens(data.session.access_token, data.session.refresh_token ?? '');

        // Check if this is a returning user (has existing data)
        try {
          const { data: userCountries } = await supabase
            .from('user_countries')
            .select('id')
            .eq('user_id', data.session.user.id)
            .limit(1);

          const hasOnboarded = userCountries && userCountries.length > 0;

          if (hasOnboarded) {
            // Returning user - skip migration, mark onboarding complete
            setHasCompletedOnboarding(true);
            await storeOnboardingComplete();
          } else {
            // New user - run migration if there's onboarding data
            const migrationResult = await migrateGuestData(data.session);
            options?.onMigrationComplete?.(migrationResult);
          }
        } catch {
          // If check fails, try migration anyway (it handles empty data gracefully)
          const migrationResult = await migrateGuestData(data.session);
          options?.onMigrationComplete?.(migrationResult);
        }

        // Set session last to trigger navigation
        setSession(data.session);
      }
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Invalid verification code';
      Alert.alert('Verification Failed', message);
    },
  });
}

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
      await clearTokens();
      await clearOnboardingComplete();
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Failed to sign out';
      Alert.alert('Sign Out Failed', message);
    },
  });
}

// Note: useResetPassword removed - not needed with phone OTP authentication
