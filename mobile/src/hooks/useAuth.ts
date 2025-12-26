import { useMutation } from '@tanstack/react-query';
import { Alert } from 'react-native';

import {
  clearOnboardingComplete,
  clearTokens,
  storeOnboardingComplete,
  storeTokens,
} from '@services/api';
import { migrateGuestData } from '@services/guestMigration';
import { registerForPushNotifications } from '@services/pushNotifications';
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
  username?: string;
}

/**
 * Hook to sign up with email and password.
 * Creates a new account in Supabase.
 * Note: Requires "Enable email confirmations" to be disabled in Supabase
 * dashboard for immediate sign-in without email verification.
 */
export function useSignUpWithPassword() {
  const { setSession, setHasCompletedOnboarding } = useAuthStore();

  return useMutation({
    mutationFn: async ({ email, password, displayName, username }: PasswordAuthInput) => {
      const userData: Record<string, string> = {};
      if (displayName) userData.display_name = displayName;
      if (username) userData.username = username;

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: Object.keys(userData).length > 0 ? userData : undefined,
        },
      });

      if (error) throw error;

      // If email confirmation is required, session will be null
      if (!data.session) {
        throw new Error('Email confirmation required. Check your inbox.');
      }

      return data;
    },
    onSuccess: async (data) => {
      if (data.session) {
        await clearTokens();
        await storeTokens(data.session.access_token, data.session.refresh_token ?? '');

        // New user - attempt migration of guest data
        try {
          await migrateGuestData(data.session);
        } catch {
          console.warn('Migration failed for new password user');
        }

        // Request push notification permission and register token
        // Non-blocking - don't await to avoid delaying auth flow
        registerForPushNotifications().catch((err) =>
          console.warn('Push notification registration failed:', err)
        );

        // New sign-up, so onboarding not completed
        setHasCompletedOnboarding(false);
        setSession(data.session);
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
  const { setSession, setHasCompletedOnboarding } = useAuthStore();

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
        await clearTokens();
        await storeTokens(data.session.access_token, data.session.refresh_token ?? '');

        // Check if returning user
        const onboarded = await hasUserOnboarded(data.session.user.id);

        if (onboarded) {
          setHasCompletedOnboarding(true);
          await storeOnboardingComplete();
        } else {
          // User exists but hasn't onboarded - attempt migration
          try {
            await migrateGuestData(data.session);
          } catch {
            console.warn('Migration failed for password user');
          }
        }

        // Register for push notifications (returning users may not have registered)
        // Non-blocking - don't await to avoid delaying auth flow
        registerForPushNotifications().catch((err) =>
          console.warn('Push notification registration failed:', err)
        );

        setSession(data.session);
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
