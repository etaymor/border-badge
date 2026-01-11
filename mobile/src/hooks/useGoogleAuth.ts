import * as WebBrowser from 'expo-web-browser';
import { makeRedirectUri } from 'expo-auth-session';
import { useMutation } from '@tanstack/react-query';
import { Alert } from 'react-native';

import { clearTokens, storeOnboardingComplete, storeTokens } from '@services/api';
import { migrateGuestData } from '@services/guestMigration';
import { supabase } from '@services/supabase';
import { useAuthStore } from '@stores/authStore';
import { getAuthErrorMessage, getSafeLogMessage } from '@utils/authErrors';
import { extractAuthTokensFromUrl, hasUserOnboarded } from '@utils/authHelpers';

interface GoogleSignInParams {
  displayName?: string;
}

type GoogleSignInVariables = GoogleSignInParams | void;

// Ensure web browser auth sessions are properly handled
WebBrowser.maybeCompleteAuthSession();

/**
 * Hook to sign in with Google.
 * Uses Supabase OAuth with expo-web-browser for the OAuth flow.
 * Works on both iOS and Android.
 */
export function useGoogleSignIn() {
  const { setSession, setHasCompletedOnboarding, setIsMigrating } = useAuthStore();

  return useMutation<
    Awaited<ReturnType<typeof supabase.auth.setSession>>['data'],
    Error,
    GoogleSignInVariables
  >({
    mutationFn: async (params) => {
      // Create redirect URL for OAuth callback (matches atlasi://auth-callback)
      const redirectUrl = makeRedirectUri({ scheme: 'atlasi', path: 'auth-callback' });

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
      // Use preferEphemeralSession to avoid iOS SSO prompts and cookie issues
      // that can cause double-redirect problems with OAuth flows
      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectUrl, {
        preferEphemeralSession: true,
      });

      if (result.type !== 'success') {
        // User cancelled or browser was dismissed
        throw new Error('ERR_REQUEST_CANCELED');
      }

      // Validate the callback URL origin for security using proper URL parsing
      try {
        const expectedUrl = new URL(redirectUrl);
        const actualUrl = new URL(result.url);

        if (
          actualUrl.protocol !== expectedUrl.protocol ||
          actualUrl.host !== expectedUrl.host ||
          actualUrl.pathname !== expectedUrl.pathname
        ) {
          throw new Error('Invalid OAuth callback origin');
        }
      } catch (urlError) {
        // Re-throw our own error, wrap parsing errors
        if (urlError instanceof Error && urlError.message === 'Invalid OAuth callback origin') {
          throw urlError;
        }
        throw new Error('Invalid OAuth callback URL format');
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

      // Update display name if provided from onboarding
      if (params?.displayName) {
        const { error: updateError } = await supabase.rpc('update_display_name', {
          new_display_name: params.displayName,
        });
        if (updateError) {
          // Non-critical failure - user can update name later in settings
          console.warn('Failed to update display name from Google Sign-In:', updateError.message);
        }
      }

      return sessionData;
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

        // Check if returning user using shared helper
        const onboarded = await hasUserOnboarded(data.session.user.id);

        if (onboarded) {
          setHasCompletedOnboarding(true);
          await storeOnboardingComplete();
          setSession(data.session);
        } else {
          // New user - set isMigrating before session to prevent empty state
          setIsMigrating(true);
          setSession(data.session);

          // Migrate in background
          migrateGuestData(data.session)
            .catch(() => console.warn('Migration failed for Google user'))
            .finally(() => setIsMigrating(false));
        }
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
