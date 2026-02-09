import { useMutation } from '@tanstack/react-query';
import { Alert } from 'react-native';

import {
  api,
  clearOnboardingComplete,
  clearTokens,
  storeOnboardingComplete,
  storeTokens,
} from '@services/api';
import { Analytics } from '@services/analytics';
import { migrateGuestData, captureOnboardingSnapshot } from '@services/guestMigration';
import { clearPhotoCache } from '@services/photoImport/photoCacheDb';
import { queryClient } from '../queryClient';
import { supabase } from '@services/supabase';
import { useAuthStore } from '@stores/authStore';
import { useOnboardingStore } from '@stores/onboardingStore';
import { getAuthErrorMessage, getSafeLogMessage } from '@utils/authErrors';
import { hasUserOnboarded } from '@utils/authHelpers';

// ============================================================================
// Email + Password Authentication Hooks
// ============================================================================

interface PasswordAuthInput {
  email: string;
  password: string;
  displayName?: string;
}

/**
 * Hook to sign up with email and password.
 * Creates a new account in Supabase.
 * Note: Requires "Enable email confirmations" to be disabled in Supabase
 * dashboard for immediate sign-in without email verification.
 */
export function useSignUpWithPassword() {
  const { setSession, setHasCompletedOnboarding, setIsMigrating } = useAuthStore();

  return useMutation({
    mutationFn: async ({ email, password, displayName }: PasswordAuthInput) => {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: displayName ? { display_name: displayName } : undefined,
        },
      });

      if (error) throw error;

      // If email confirmation is required, session will be null
      if (!data.session) {
        throw new Error('Email confirmation required. Check your inbox.');
      }

      return data;
    },
    onSuccess: async (data, variables) => {
      if (data.session) {
        // Store tokens explicitly for Share Extension access
        // Supabase stores under 'supabase.auth.token' but Share Extension looks for 'auth_token'
        try {
          await clearTokens();
          await storeTokens(data.session.access_token, data.session.refresh_token ?? '');
        } catch (tokenError) {
          // Token storage failed - rollback to safe state
          console.error('Failed to store tokens for Share Extension:', tokenError);
          try {
            await clearTokens(); // Ensure no partial tokens remain
          } catch {
            // Ignore cleanup errors
          }
          // Sign out from Supabase to avoid session without Share Extension access
          await supabase.auth.signOut();
          throw new Error('Failed to store authentication tokens. Please try again.');
        }

        // Capture onboarding state BEFORE any session/navigation changes.
        // After setSession(), React re-renders can cause Zustand persist middleware
        // rehydration that resets homeCountry to null.
        const snapshot = captureOnboardingSnapshot();

        // Set isMigrating BEFORE setting session to prevent empty state flash
        // This ensures useUserCountries shows onboarding data immediately
        setIsMigrating(true);

        // Schedule welcome emails for new user
        try {
          await api.post('/welcome/emails', {
            display_name: variables.displayName,
          });
        } catch (error) {
          console.warn('Failed to schedule welcome emails:', error);
        }

        // New sign-up, so onboarding not completed
        setHasCompletedOnboarding(false);
        setSession(data.session);

        // Track onboarding completion analytics
        const uniqueCountries = new Set([
          ...snapshot.selectedCountries,
          ...(snapshot.homeCountry ? [snapshot.homeCountry] : []),
        ]);
        Analytics.completeOnboarding({
          countriesCount: uniqueCountries.size,
          homeCountry: snapshot.homeCountry,
          trackingPreference: snapshot.trackingPreference,
        });

        // Migrate in background - isMigrating will be cleared when done
        migrateGuestData(data.session, snapshot)
          .catch(() => console.warn('Migration failed for new password user'))
          .finally(() => setIsMigrating(false));
      }
    },
    onError: (error) => {
      console.error('Password sign-up failed:', getSafeLogMessage(error));
      const message = getAuthErrorMessage(error) || 'Failed to create account';
      Alert.alert('Sign Up Failed', message);
    },
  });
}

/**
 * Hook to sign in with email and password.
 * Authenticates an existing account.
 */
export function useSignInWithPassword() {
  const { setSession, setHasCompletedOnboarding, setIsMigrating } = useAuthStore();

  return useMutation({
    mutationFn: async ({ email, password }: PasswordAuthInput) => {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;
      return data;
    },
    onSuccess: async (data) => {
      if (data.session) {
        // Store tokens explicitly for Share Extension access
        // Supabase stores under 'supabase.auth.token' but Share Extension looks for 'auth_token'
        try {
          await clearTokens();
          await storeTokens(data.session.access_token, data.session.refresh_token ?? '');
        } catch (tokenError) {
          // Token storage failed - rollback to safe state
          console.error('Failed to store tokens for Share Extension:', tokenError);
          try {
            await clearTokens(); // Ensure no partial tokens remain
          } catch {
            // Ignore cleanup errors
          }
          // Sign out from Supabase to avoid session without Share Extension access
          await supabase.auth.signOut();
          throw new Error('Failed to store authentication tokens. Please try again.');
        }

        // Check if returning user
        const onboarded = await hasUserOnboarded(data.session.user.id);

        if (onboarded) {
          setHasCompletedOnboarding(true);
          await storeOnboardingComplete();
          setSession(data.session);
        } else {
          // Capture onboarding state before session change triggers re-renders
          const snapshot = captureOnboardingSnapshot();

          // User exists but hasn't onboarded - set isMigrating before session
          setIsMigrating(true);
          setSession(data.session);

          // Migrate in background
          migrateGuestData(data.session, snapshot)
            .catch(() => console.warn('Migration failed for password user'))
            .finally(() => setIsMigrating(false));
        }
      }
    },
    onError: (error) => {
      console.error('Password sign-in failed:', getSafeLogMessage(error));
      const message = getAuthErrorMessage(error) || 'Failed to sign in';
      Alert.alert('Sign In Failed', message);
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
      // Ignore "Auth session missing" error - user is effectively signed out
      // This can happen if the session was already cleared or expired
      if (error && !error.message.includes('Auth session missing')) {
        throw error;
      }
    },
    onSuccess: async () => {
      signOut();
      resetOnboarding();
      queryClient.clear(); // Clear all cached data
      await clearTokens();
      await clearOnboardingComplete();
      // Clear cached GPS data to prevent leaking location data to next user
      await clearPhotoCache().catch(() => {});
    },
    onError: (error) => {
      console.error('Sign out failed:', getSafeLogMessage(error));
      const message = getAuthErrorMessage(error) || 'Failed to sign out';
      Alert.alert('Sign Out Failed', message);
    },
  });
}

// ============================================================================
// Delete Account Hook
// ============================================================================

/**
 * Hook to permanently delete the user's account.
 * This is irreversible and will delete all user data.
 */
export function useDeleteAccount() {
  const { signOut } = useAuthStore();
  const { reset: resetOnboarding } = useOnboardingStore();

  return useMutation({
    mutationFn: async () => {
      // Call backend to delete account (uses Supabase Admin API)
      await api.delete('/profile');
    },
    onSuccess: async () => {
      // No need to call supabase.auth.signOut() - the backend already deleted
      // the auth record via Admin API. Just clear local state.
      signOut();
      resetOnboarding();
      queryClient.clear();
      await clearTokens();
      await clearOnboardingComplete();
      // Clear cached GPS data to prevent leaking location data to next user
      await clearPhotoCache().catch(() => {});
    },
    onError: (error) => {
      console.error('Account deletion failed:', getSafeLogMessage(error));
      Alert.alert(
        'Deletion Failed',
        'Failed to delete your account. Please try again or contact support.'
      );
    },
  });
}
