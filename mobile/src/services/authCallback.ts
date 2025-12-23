/**
 * Auth Callback Service
 *
 * This service handles deep link callbacks from Supabase authentication.
 * It processes magic link authentication by extracting tokens from the callback URL
 * and setting the session in Supabase.
 *
 * The callback URL format is:
 * borderbadge://auth-callback#access_token=xxx&refresh_token=xxx&...
 *
 * This is triggered when:
 * 1. User clicks a magic link in their email
 * 2. OAuth provider redirects back to the app (though OAuth uses expo-web-browser directly)
 */

import { clearTokens, storeOnboardingComplete, storeTokens } from '@services/api';
import { migrateGuestData } from '@services/guestMigration';
import { supabase } from '@services/supabase';
import { useAuthStore } from '@stores/authStore';
import { hasUserOnboarded } from '@utils/authHelpers';

/**
 * Check if the URL is an auth callback deep link
 *
 * @param url - The deep link URL to check
 * @returns True if this is an auth callback deep link
 */
export function isAuthCallbackDeepLink(url: string | null): boolean {
  if (!url) return false;
  return url.startsWith('borderbadge://auth-callback');
}

/**
 * Extract auth tokens from the callback URL
 *
 * @param url - The callback URL containing tokens
 * @returns Object with access_token and refresh_token, or null if not found
 */
export function extractAuthTokens(
  url: string
): { accessToken: string; refreshToken: string | null } | null {
  try {
    // Tokens can be in fragment (#) or query params (?)
    const fragmentOrQuery = url.split('#')[1] || url.split('?')[1];
    if (!fragmentOrQuery) return null;

    const params = new URLSearchParams(fragmentOrQuery);
    const accessToken = params.get('access_token');

    if (!accessToken) return null;

    return {
      accessToken,
      refreshToken: params.get('refresh_token'),
    };
  } catch {
    // Don't log the error as it may contain token data
    console.error('Failed to extract auth tokens from callback URL');
    return null;
  }
}

/**
 * Process an auth callback deep link
 * Extracts tokens and sets the Supabase session
 *
 * @param url - The callback URL containing tokens
 * @returns True if session was set successfully, false otherwise
 */
export async function processAuthCallback(url: string): Promise<boolean> {
  const tokens = extractAuthTokens(url);
  if (!tokens) {
    console.error('No tokens found in auth callback URL');
    return false;
  }

  try {
    // Set the session in Supabase
    const { data, error } = await supabase.auth.setSession({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken || '',
    });

    if (error) {
      console.error('Failed to set session from auth callback:', error);
      return false;
    }

    if (data.session) {
      // Clear any old tokens first
      await clearTokens();
      // Store new tokens
      await storeTokens(data.session.access_token, data.session.refresh_token ?? '');

      // Check if returning user using shared helper
      const onboarded = await hasUserOnboarded(data.session.user.id);
      const authStore = useAuthStore.getState();

      if (onboarded) {
        authStore.setHasCompletedOnboarding(true);
        await storeOnboardingComplete();
      } else {
        // New user - attempt migration
        try {
          await migrateGuestData(data.session);
        } catch {
          console.warn('Migration failed for magic link user');
        }
      }

      // Update auth store with session
      authStore.setSession(data.session);
      return true;
    }

    return false;
  } catch {
    console.error('Error processing auth callback');
    return false;
  }
}
