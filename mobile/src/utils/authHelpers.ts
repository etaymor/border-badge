/**
 * Auth Helper Utilities
 *
 * Shared authentication helper functions used across auth hooks and services.
 */

import { supabase } from '@services/supabase';

/**
 * Auth tokens extracted from a callback URL
 */
export interface AuthTokens {
  accessToken: string;
  refreshToken: string | null;
}

/**
 * Extract auth tokens from a callback URL.
 * Tokens can be in the URL fragment (#) or query params (?).
 *
 * Used by both OAuth and magic link authentication flows.
 *
 * @param url - The callback URL containing tokens
 * @returns Object with access_token and refresh_token, or null if not found
 */
export function extractAuthTokensFromUrl(url: string): AuthTokens | null {
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
    return null;
  }
}

/**
 * Check if a user has completed onboarding by checking for existing country data.
 *
 * Used to determine whether to run guest data migration for new users
 * or skip it for returning users.
 *
 * @param userId - The user's ID from Supabase auth
 * @returns true if user has existing country data (returning user), false otherwise
 */
export async function hasUserOnboarded(userId: string): Promise<boolean> {
  try {
    const { data: userCountries } = await supabase
      .from('user_countries')
      .select('id')
      .eq('user_id', userId)
      .limit(1);

    return !!(userCountries && userCountries.length > 0);
  } catch {
    // On error, assume not onboarded - this will trigger migration
    // which is safe (migration is idempotent and handles existing data)
    console.warn('Failed to check onboarding status');
    return false;
  }
}
