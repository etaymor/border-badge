/**
 * Auth Helper Utilities
 *
 * Shared authentication helper functions used across auth hooks and services.
 */

import { supabase } from '@services/supabase';

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
