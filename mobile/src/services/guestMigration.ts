import type { Session } from '@supabase/supabase-js';
import type { AxiosError } from 'axios';

import { queryClient } from '../queryClient';
import { api, getStoredToken, setSuppressAutoSignOut } from './api';
import { useOnboardingStore } from '@stores/onboardingStore';
import {
  getLocalUserCountries,
  clearLocalUserCountries,
  getHomeCountry,
  clearHomeCountry,
} from './countriesDb';

/**
 * Snapshot of onboarding state captured before session/navigation changes.
 * Prevents race conditions where Zustand persist middleware rehydration
 * could overwrite in-memory state (e.g. homeCountry reverting to null).
 */
export interface OnboardingSnapshot {
  selectedCountries: string[];
  bucketListCountries: string[];
  dreamDestination: string | null;
  homeCountry: string | null;
  motivationTags: string[];
  personaTags: string[];
  trackingPreference: string;
}

/**
 * Capture a defensive snapshot of the onboarding store.
 * Call this BEFORE setSession() to freeze state before navigation changes.
 */
export function captureOnboardingSnapshot(): OnboardingSnapshot {
  const state = useOnboardingStore.getState();
  return {
    selectedCountries: [...state.selectedCountries],
    bucketListCountries: [...state.bucketListCountries],
    dreamDestination: state.dreamDestination,
    homeCountry: state.homeCountry,
    motivationTags: [...state.motivationTags],
    personaTags: [...state.personaTags],
    trackingPreference: state.trackingPreference,
  };
}

// Helper to delay execution (useful for rate limiting)
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Helper to retry a function with exponential backoff on retryable errors
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000,
  retryableStatuses: number[] = [429]
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const axiosError = error as AxiosError;
      const status = axiosError?.response?.status;

      // Only retry on specified retryable status codes
      if (!status || !retryableStatuses.includes(status) || attempt === maxRetries) {
        throw error;
      }

      lastError = error as Error;
      const waitTime = baseDelay * Math.pow(2, attempt); // Exponential backoff
      console.log(
        `Retryable error (${status}), retrying in ${waitTime}ms (attempt ${attempt + 1}/${maxRetries})`
      );
      await delay(waitTime);
    }
  }

  throw lastError;
}

// Type for user country data returned by API
interface UserCountry {
  id: string;
  user_id: string;
  country_code: string;
  status: 'visited' | 'wishlist';
  created_at: string;
  added_during_onboarding: boolean;
}

// Helper to migrate a set of countries with a given status using batch endpoint
async function migrateCountries(
  countries: Set<string>,
  status: 'visited' | 'wishlist'
): Promise<{ data: UserCountry[]; errors: string[] }> {
  if (countries.size === 0) {
    return { data: [], errors: [] };
  }

  try {
    // Debug logging to diagnose network issues
    const token = await getStoredToken();
    console.log('Migration debug:', {
      status,
      countriesCount: countries.size,
      apiBaseURL: api.defaults.baseURL,
      hasToken: !!token,
    });

    // Batch all countries in a single request for performance
    // Mark all countries from onboarding so they're excluded from milestone calculations
    const payload = {
      countries: Array.from(countries).map((code) => ({
        country_code: code,
        status,
        added_during_onboarding: true,
      })),
    };

    // Retry on 429 (rate limit) and 404 (profile not yet created by DB trigger)
    const response = await retryWithBackoff(
      () => api.post('/countries/user/batch', payload),
      3,
      1000,
      [429, 404]
    );
    console.log('Migration success:', { status, count: response.data.length });
    return { data: response.data as UserCountry[], errors: [] };
  } catch (error) {
    console.error(`Failed to migrate ${status} countries:`, error);
    return { data: [], errors: [`Failed to migrate ${status} countries`] };
  }
}

export interface MigrationResult {
  success: boolean;
  migratedCountries: number;
  migratedProfile: boolean;
  errors: string[];
}

export async function migrateGuestData(
  session: Session,
  snapshot: OnboardingSnapshot
): Promise<MigrationResult> {
  // Note: isMigrating is set by the caller BEFORE calling this function
  // This ensures the session is available but query shows onboarding data during migration

  // Suppress auto-sign-out during migration to avoid race condition where
  // a 401 during token establishment could sign out the user prematurely
  setSuppressAutoSignOut(true);

  try {
    const result = await doMigration(session, snapshot);

    // Invalidate trips and profile caches (user-countries is set directly by doMigration)
    await queryClient.invalidateQueries({ queryKey: ['trips'] });
    await queryClient.invalidateQueries({ queryKey: ['profile'] });

    return result;
  } finally {
    setSuppressAutoSignOut(false);
    // Caller is responsible for clearing isMigrating
  }
}

async function doMigration(
  session: Session,
  snapshot: OnboardingSnapshot
): Promise<MigrationResult> {
  // Use the pre-captured snapshot instead of reading the store directly.
  // The store's homeCountry can be null by this point due to Zustand persist
  // middleware rehydration after setSession() triggers navigation changes.
  const {
    selectedCountries,
    bucketListCountries,
    dreamDestination,
    homeCountry,
    motivationTags,
    personaTags,
    trackingPreference,
  } = snapshot;

  const errors: string[] = [];
  let migratedCountries = 0;
  let migratedProfile = false;

  // Small delay to give the DB trigger time to create the user profile
  // after account creation, before we start making API calls
  await delay(500);

  // Also read from SQLite as backup source of truth
  // This ensures we capture all countries even if Zustand/AsyncStorage got out of sync
  let sqliteCountries: { country_code: string; status: 'visited' | 'wishlist' }[] = [];
  try {
    const localCountries = await getLocalUserCountries();
    sqliteCountries = localCountries.map((c) => ({
      country_code: c.country_code,
      status: c.status,
    }));
  } catch (err) {
    console.warn('Failed to read SQLite countries for migration:', err);
  }

  // Recover homeCountry from SQLite if the snapshot lost it due to Zustand persist rehydration
  let effectiveHomeCountry = homeCountry;
  if (!effectiveHomeCountry) {
    try {
      effectiveHomeCountry = await getHomeCountry();
      if (effectiveHomeCountry) {
        console.log('Recovered homeCountry from SQLite:', effectiveHomeCountry);
      }
    } catch (err) {
      console.warn('Failed to read homeCountry from SQLite:', err);
    }
  }

  // Combine all visited countries from both Zustand store and SQLite
  const allVisitedCountries = new Set(selectedCountries);
  if (effectiveHomeCountry) {
    allVisitedCountries.add(effectiveHomeCountry);
  }
  // Add visited countries from SQLite
  sqliteCountries
    .filter((c) => c.status === 'visited')
    .forEach((c) => allVisitedCountries.add(c.country_code));

  // Migrate visited countries
  const visitedResult = await migrateCountries(allVisitedCountries, 'visited');
  migratedCountries += visitedResult.data.length;
  errors.push(...visitedResult.errors);

  // Combine all wishlist countries from both Zustand store and SQLite
  const allWishlistCountries = new Set(bucketListCountries);
  if (dreamDestination) {
    allWishlistCountries.add(dreamDestination);
  }
  // Add wishlist countries from SQLite
  sqliteCountries
    .filter((c) => c.status === 'wishlist')
    .forEach((c) => allWishlistCountries.add(c.country_code));

  // Migrate wishlist countries
  const wishlistResult = await migrateCountries(allWishlistCountries, 'wishlist');
  migratedCountries += wishlistResult.data.length;
  errors.push(...wishlistResult.errors);

  // Directly populate the React Query cache with migrated data
  // This ensures the passport screen shows countries immediately after account creation
  // The query key includes the user ID to match useUserCountries query key format
  const allMigratedCountries = [...visitedResult.data, ...wishlistResult.data];
  queryClient.setQueryData(['user-countries', session.user.id], allMigratedCountries);

  // Migrate profile preferences (home country, travel motives, persona tags, tracking preference)
  // Add a small delay to avoid rate limiting after country migrations
  const hasProfileData =
    effectiveHomeCountry ||
    motivationTags.length > 0 ||
    personaTags.length > 0 ||
    trackingPreference !== 'full_atlas';
  if (hasProfileData) {
    try {
      // Small delay to avoid hitting rate limits after batch country requests
      await delay(500);

      // Build payload, only including home_country_code when it has a value
      // to avoid overwriting with null due to race conditions
      const profilePayload: Record<string, unknown> = {
        travel_motives: motivationTags,
        persona_tags: personaTags,
        tracking_preference: trackingPreference,
      };
      if (effectiveHomeCountry) {
        profilePayload.home_country_code = effectiveHomeCountry;
      }

      // Retry on 429 (rate limit) and 404 (profile not yet created by DB trigger)
      await retryWithBackoff(
        async () => {
          await api.patch('/profile', profilePayload);
        },
        3,
        1000,
        [429, 404]
      );
      migratedProfile = true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error('Profile migration failed:', err);
      errors.push(`Failed to migrate profile preferences: ${errorMessage}`);
    }
  }

  // If everything migrated successfully, clear the onboarding store and SQLite
  // On failure, the store is preserved so users can retry migration
  // Caller should present retry UI when success === false
  if (errors.length === 0) {
    useOnboardingStore.getState().reset(); // Clears Zustand store (which also clears SQLite via syncToSQLite)
    // Explicitly clear SQLite as backup in case store reset doesn't catch everything
    try {
      await clearLocalUserCountries();
    } catch (err) {
      console.warn('Failed to clear SQLite user countries after migration:', err);
    }
    try {
      await clearHomeCountry();
    } catch (err) {
      console.warn('Failed to clear SQLite home country after migration:', err);
    }
  }

  return {
    success: errors.length === 0,
    migratedCountries,
    migratedProfile,
    errors,
  };
}
