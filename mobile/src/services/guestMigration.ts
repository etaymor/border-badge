import type { Session } from '@supabase/supabase-js';

import { queryClient } from '../queryClient';
import { api, getStoredToken, setSuppressAutoSignOut } from './api';
import { useAuthStore } from '@stores/authStore';
import { useOnboardingStore } from '@stores/onboardingStore';

// Type for user country data returned by API
interface UserCountry {
  id: string;
  user_id: string;
  country_code: string;
  status: 'visited' | 'wishlist';
  created_at: string;
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
      tokenPrefix: token ? token.substring(0, 20) + '...' : 'none',
    });

    // Batch all countries in a single request for performance
    const payload = {
      countries: Array.from(countries).map((code) => ({
        country_code: code,
        status,
      })),
    };
    const response = await api.post('/countries/user/batch', payload);
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

export async function migrateGuestData(session: Session): Promise<MigrationResult> {
  const { setIsMigrating } = useAuthStore.getState();

  // Mark migration as in progress so UI can show onboarding store data
  setIsMigrating(true);

  // Suppress auto-sign-out during migration to avoid race condition where
  // a 401 during token establishment could sign out the user prematurely
  setSuppressAutoSignOut(true);

  try {
    const result = await doMigration(session);

    // Invalidate trips and profile caches (user-countries is set directly by doMigration)
    await queryClient.invalidateQueries({ queryKey: ['trips'] });
    await queryClient.invalidateQueries({ queryKey: ['profile'] });

    return result;
  } finally {
    setSuppressAutoSignOut(false);
    setIsMigrating(false);
  }
}

async function doMigration(session: Session): Promise<MigrationResult> {
  const {
    selectedCountries,
    bucketListCountries,
    dreamDestination,
    homeCountry,
    motivationTags,
    personaTags,
    reset,
  } = useOnboardingStore.getState();

  const errors: string[] = [];
  let migratedCountries = 0;
  let migratedProfile = false;

  // Combine all visited countries (home country is already in selectedCountries if set)
  const allVisitedCountries = new Set(selectedCountries);
  if (homeCountry) {
    allVisitedCountries.add(homeCountry);
  }

  // Migrate visited countries
  const visitedResult = await migrateCountries(allVisitedCountries, 'visited');
  migratedCountries += visitedResult.data.length;
  errors.push(...visitedResult.errors);

  // Combine all wishlist countries (bucket list + dream destination)
  const allWishlistCountries = new Set(bucketListCountries);
  if (dreamDestination) {
    allWishlistCountries.add(dreamDestination);
  }

  // Migrate wishlist countries
  const wishlistResult = await migrateCountries(allWishlistCountries, 'wishlist');
  migratedCountries += wishlistResult.data.length;
  errors.push(...wishlistResult.errors);

  // Directly populate the React Query cache with migrated data
  // This ensures the passport screen shows countries immediately after account creation
  // The query key includes the user ID to match useUserCountries query key format
  const allMigratedCountries = [...visitedResult.data, ...wishlistResult.data];
  queryClient.setQueryData(['user-countries', session.user.id], allMigratedCountries);

  // Migrate profile preferences (home country, travel motives, persona tags)
  const hasProfileData = homeCountry || motivationTags.length > 0 || personaTags.length > 0;
  if (hasProfileData) {
    try {
      await api.patch('/profile', {
        home_country_code: homeCountry,
        travel_motives: motivationTags,
        persona_tags: personaTags,
      });
      migratedProfile = true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error('Profile migration failed:', err);
      errors.push(`Failed to migrate profile preferences: ${errorMessage}`);
    }
  }

  // If everything migrated successfully, clear the onboarding store
  // On failure, the store is preserved so users can retry migration
  // Caller should present retry UI when success === false
  if (errors.length === 0) {
    reset();
  }

  return {
    success: errors.length === 0,
    migratedCountries,
    migratedProfile,
    errors,
  };
}
