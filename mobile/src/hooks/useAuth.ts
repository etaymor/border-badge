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
import {
  DISPLAY_NAME_MAX_LENGTH,
  DISPLAY_NAME_MIN_LENGTH,
  validateDisplayName,
} from '@utils/displayNameValidation';

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
  onMigrationComplete?: (result: MigrationResult | undefined) => void;
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

      // If a display name is provided, persist it as a fallback.
      // The primary mechanism is via signInWithOtp options.data, but this handles
      // cases where that didn't work (e.g., returning users, edge cases).
      if (displayName) {
        // Validate display name before sending to database
        const validation = validateDisplayName(displayName);
        if (!validation.isValid) {
          throw new Error(validation.error);
        }

        // Use database function to update display name (single API call)
        const { error: rpcError } = await supabase.rpc('update_display_name', {
          new_display_name: validation.trimmedValue,
        });

        if (rpcError) {
          console.error('Failed to update display name:', rpcError.message);

          // Provide specific error messages based on known error patterns from DB
          if (rpcError.message.includes('at least 2 characters')) {
            throw new Error(
              `Name is too short. Please enter at least ${DISPLAY_NAME_MIN_LENGTH} characters.`
            );
          }
          if (rpcError.message.includes('50 characters')) {
            throw new Error(
              `Name is too long. Please use ${DISPLAY_NAME_MAX_LENGTH} characters or less.`
            );
          }

          throw new Error('Failed to save your name. Please try again.');
        }
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
              options?.onMigrationComplete?.(undefined);
            }
          }
        } catch {
          // If check fails, try migration anyway (it handles empty data gracefully)
          try {
            const migrationResult = await migrateGuestData(data.session);
            options?.onMigrationComplete?.(migrationResult);
          } catch (migrationError) {
            console.warn('Migration failed after user check error:', migrationError);
            options?.onMigrationComplete?.(undefined);
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
