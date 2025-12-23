import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { useMutation } from '@tanstack/react-query';
import { Alert } from 'react-native';

import { clearTokens, storeOnboardingComplete, storeTokens } from '@services/api';
import { migrateGuestData } from '@services/guestMigration';
import { supabase } from '@services/supabase';
import { useAuthStore } from '@stores/authStore';
import { getAuthErrorMessage, getSafeLogMessage } from '@utils/authErrors';
import { extractAuthTokensFromUrl, hasUserOnboarded } from '@utils/authHelpers';

// Ensure web browser auth sessions are properly handled
WebBrowser.maybeCompleteAuthSession();

/**
 * Hook to sign in with Google.
 * Uses Supabase OAuth with expo-web-browser for the OAuth flow.
 * Works on both iOS and Android.
 */
export function useGoogleSignIn() {
  const { setSession, setHasCompletedOnboarding } = useAuthStore();

  return useMutation({
    mutationFn: async () => {
      // Create redirect URL for OAuth callback
      const redirectUrl = Linking.createURL('auth-callback');

      // Start OAuth flow with Supabase
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectUrl,
          skipBrowserRedirect: true, // We'll handle the browser ourselves
        },
      });

      if (error) throw error;
      if (!data.url) throw new Error('No OAuth URL received from Supabase');

      // Open the OAuth URL in the browser
      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectUrl);

      if (result.type !== 'success') {
        // User cancelled or browser was dismissed
        throw new Error('ERR_REQUEST_CANCELED');
      }

      // Validate the callback URL origin for security (exact match, not prefix)
      const expectedBase = redirectUrl.split('#')[0].split('?')[0];
      const actualBase = result.url.split('#')[0].split('?')[0];
      if (actualBase !== expectedBase) {
        throw new Error('Invalid OAuth callback origin');
      }

      // Extract the tokens from the callback URL using shared utility
      const tokens = extractAuthTokensFromUrl(result.url);
      if (!tokens) {
        throw new Error('No access token received from Google');
      }

      const { accessToken, refreshToken } = tokens;

      // Validate refresh token - OAuth providers should always provide one
      // Without it, session refresh will fail and user will be logged out unexpectedly
      if (!refreshToken) {
        throw new Error('No refresh token received - session cannot be refreshed');
      }

      // Set the session in Supabase using the tokens
      const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });

      if (sessionError) throw sessionError;

      // Validate that a session was actually created
      if (!sessionData.session) {
        throw new Error('Failed to create session from Google OAuth tokens');
      }

      return sessionData;
    },
    onSuccess: async (data) => {
      if (data.session) {
        await clearTokens();
        await storeTokens(data.session.access_token, data.session.refresh_token ?? '');

        // Check if returning user using shared helper
        const onboarded = await hasUserOnboarded(data.session.user.id);

        if (onboarded) {
          setHasCompletedOnboarding(true);
          await storeOnboardingComplete();
        } else {
          // New user - attempt migration
          try {
            await migrateGuestData(data.session);
          } catch {
            console.warn('Migration failed for Google user');
          }
        }

        setSession(data.session);
      }
    },
    onError: (error) => {
      // Log sanitized error for debugging
      console.error('Google Sign-In failed:', getSafeLogMessage(error));

      // Get user-friendly message (null means silent - user cancelled)
      const message = getAuthErrorMessage(error);
      if (message) {
        Alert.alert('Sign In Failed', message);
      }
    },
  });
}

/**
 * Returns true if Google Sign In is available on this device.
 * Google Sign In works on all platforms (iOS and Android).
 */
export function useGoogleAuthAvailable(): boolean {
  return true;
}
