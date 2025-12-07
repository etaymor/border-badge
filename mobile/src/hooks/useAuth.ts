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
  displayName?: string; // Optional display name to set in user metadata
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
    mutationFn: async ({ phone, displayName }: SendOTPInput) => {
      const { error } = await supabase.auth.signInWithOtp({
        phone,
        options: displayName ? { data: { display_name: displayName } } : undefined,
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

      // If a display name is provided, persist it with a timeout.
      // We wait for this to complete (up to 5s) but don't fail auth if it times out.
      const userId = data.session?.user.id ?? data.user?.id;
      if (displayName && userId) {
        const updateDisplayName = async () => {
          // Update auth metadata
          const metadataPromise = (async () => {
            try {
              const { error } = await supabase.auth.updateUser({
                data: { display_name: displayName },
              });
              if (error) console.warn('Failed to update user metadata:', error.message);
            } catch (err) {
              console.warn('Display name metadata update rejected:', err);
            }
          })();

          // Update user_profile table
          const profilePromise = (async () => {
            try {
              const { error } = await supabase
                .from('user_profile')
                .update({ display_name: displayName })
                .eq('user_id', userId);
              if (error) console.warn('Failed to update user profile:', error.message);
            } catch (err) {
              console.warn('Display name profile update rejected:', err);
            }
          })();

          // Wait for both with a timeout
          await Promise.race([
            Promise.all([metadataPromise, profilePromise]),
            new Promise((resolve) => setTimeout(resolve, 5000)), // 5s timeout
          ]);
        };

        // Await but don't fail if it times out
        await updateDisplayName();
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
            try {
              const migrationResult = await migrateGuestData(data.session);
              options?.onMigrationComplete?.(migrationResult);
            } catch (migrationError) {
              console.warn('Migration failed for new user:', migrationError);
              options?.onMigrationComplete?.(undefined as unknown as MigrationResult);
            }
          }
        } catch {
          // If check fails, try migration anyway (it handles empty data gracefully)
          try {
            const migrationResult = await migrateGuestData(data.session);
            options?.onMigrationComplete?.(migrationResult);
          } catch (migrationError) {
            console.warn('Migration failed after user check error:', migrationError);
            options?.onMigrationComplete?.(undefined as unknown as MigrationResult);
          }
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
