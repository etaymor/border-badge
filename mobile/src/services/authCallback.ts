/**
 * Auth Callback Service
 *
 * This service handles deep link callbacks from Supabase authentication.
 * It processes magic link authentication by extracting tokens from the callback URL
 * and setting the session in Supabase.
 *
 * The callback URL format is:
 * atlasi://auth-callback#access_token=xxx&refresh_token=xxx&...
 *
 * This is triggered when:
 * 1. User clicks a magic link in their email
 * 2. OAuth provider redirects back to the app (though OAuth uses expo-web-browser directly)
 */

import { clearTokens, storeOnboardingComplete, storeTokens } from '@services/api';
import { migrateGuestData } from '@services/guestMigration';
import { supabase } from '@services/supabase';
import { useAuthStore } from '@stores/authStore';
import { getSafeLogMessage } from '@utils/authErrors';
import { extractAuthTokensFromUrl, hasUserOnboarded } from '@utils/authHelpers';

/** Expected auth callback URL prefix for origin validation */
const EXPECTED_CALLBACK_PREFIX = 'atlasi://auth-callback';

/**
 * Check if the URL is an auth callback deep link
 *
 * @param url - The deep link URL to check
 * @returns True if this is an auth callback deep link
 */
export function isAuthCallbackDeepLink(url: string | null): boolean {
  if (!url) return false;
  return url.startsWith(EXPECTED_CALLBACK_PREFIX);
}

/**
 * Validate that the URL origin matches our expected auth callback prefix.
 * This prevents potential attacks from malicious apps crafting fake callback URLs.
 *
 * @param url - The deep link URL to validate
 * @returns True if the URL has the expected origin
 */
function validateCallbackOrigin(url: string): boolean {
  // Extract base URL without fragment or query params
  const baseUrl = url.split('#')[0].split('?')[0];
  return baseUrl === EXPECTED_CALLBACK_PREFIX;
}

/**
 * Extract auth tokens from the callback URL.
 * Re-exports the shared utility for backward compatibility.
 *
 * @param url - The callback URL containing tokens
 * @returns Object with access_token and refresh_token, or null if not found
 */
export const extractAuthTokens = extractAuthTokensFromUrl;

/** Error codes for auth callback processing */
export type AuthCallbackError =
  | 'invalid_origin'
  | 'no_tokens'
  | 'session_error'
  | 'no_session'
  | 'unknown_error';

/** Result of processing an auth callback */
export interface AuthCallbackResult {
  success: boolean;
  error?: AuthCallbackError;
}

/**
 * Process an auth callback deep link
 * Extracts tokens and sets the Supabase session
 *
 * @param url - The callback URL containing tokens
 * @returns Result with success status and optional error code
 */
export async function processAuthCallback(url: string): Promise<AuthCallbackResult> {
  // Security: Validate URL origin before processing tokens
  if (!validateCallbackOrigin(url)) {
    console.error('Invalid auth callback origin - rejecting potentially malicious URL');
    return { success: false, error: 'invalid_origin' };
  }

  const tokens = extractAuthTokens(url);
  if (!tokens) {
    console.error('No tokens found in auth callback URL');
    return { success: false, error: 'no_tokens' };
  }

  try {
    // Set the session in Supabase
    const { data, error } = await supabase.auth.setSession({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken || '',
    });

    if (error) {
      console.error('Failed to set session from auth callback:', error);
      return { success: false, error: 'session_error' };
    }

    // Explicit null check for session
    if (!data?.session) {
      console.error('No session returned from auth callback');
      return { success: false, error: 'no_session' };
    }

    // Session exists - process it
    const session = data.session;

    // Clear any old tokens first
    await clearTokens();
    // Store new tokens
    await storeTokens(session.access_token, session.refresh_token ?? '');

    // Check if returning user using shared helper
    const onboarded = await hasUserOnboarded(session.user.id);
    const authStore = useAuthStore.getState();

    if (onboarded) {
      authStore.setHasCompletedOnboarding(true);
      await storeOnboardingComplete();
    } else {
      // New user - attempt migration
      try {
        await migrateGuestData(session);
      } catch {
        console.warn('Migration failed for magic link user');
      }
    }

    // Update auth store with session
    authStore.setSession(session);
    return { success: true };
  } catch (error) {
    // Use sanitized logging to prevent token exposure in error messages
    console.error('Error processing auth callback:', getSafeLogMessage(error));
    return { success: false, error: 'unknown_error' };
  }
}
