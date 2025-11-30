import axios from 'axios';

import { api } from './api';
import { useOnboardingStore } from '@stores/onboardingStore';

// Helper to migrate a set of countries with a given status
async function migrateCountries(
  countries: Set<string>,
  status: 'visited' | 'wishlist'
): Promise<{ count: number; errors: string[] }> {
  let count = 0;
  const errors: string[] = [];

  for (const countryCode of countries) {
    try {
      await api.post('/countries/user', {
        country_code: countryCode,
        status,
      });
      count++;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 409) {
        console.log(`Country ${countryCode} already exists as ${status}, skipping`);
        continue;
      }
      errors.push(`Failed to migrate ${status} country ${countryCode}`);
    }
  }

  return { count, errors };
}

interface MigrationResult {
  success: boolean;
  migratedCountries: number;
  migratedProfile: boolean;
  errors: string[];
}

export async function migrateGuestData(): Promise<MigrationResult> {
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
  migratedCountries += visitedResult.count;
  errors.push(...visitedResult.errors);

  // Combine all wishlist countries (bucket list + dream destination)
  const allWishlistCountries = new Set(bucketListCountries);
  if (dreamDestination) {
    allWishlistCountries.add(dreamDestination);
  }

  // Migrate wishlist countries
  const wishlistResult = await migrateCountries(allWishlistCountries, 'wishlist');
  migratedCountries += wishlistResult.count;
  errors.push(...wishlistResult.errors);

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
