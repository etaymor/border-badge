import { api } from './api';
import { useOnboardingStore } from '@stores/onboardingStore';

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
  for (const countryCode of allVisitedCountries) {
    try {
      await api.post('/countries/user', {
        country_code: countryCode,
        status: 'visited',
      });
      migratedCountries++;
    } catch (error) {
      // 409 conflict means it already exists, which is fine
      if (error && typeof error === 'object' && 'response' in error) {
        const axiosError = error as { response?: { status?: number } };
        if (axiosError.response?.status === 409) {
          migratedCountries++;
          continue;
        }
      }
      errors.push(`Failed to migrate visited country ${countryCode}`);
    }
  }

  // Combine all wishlist countries (bucket list + dream destination)
  const allWishlistCountries = new Set(bucketListCountries);
  if (dreamDestination) {
    allWishlistCountries.add(dreamDestination);
  }

  // Migrate wishlist countries
  for (const countryCode of allWishlistCountries) {
    try {
      await api.post('/countries/user', {
        country_code: countryCode,
        status: 'wishlist',
      });
      migratedCountries++;
    } catch (error) {
      // 409 conflict means it already exists, which is fine
      if (error && typeof error === 'object' && 'response' in error) {
        const axiosError = error as { response?: { status?: number } };
        if (axiosError.response?.status === 409) {
          migratedCountries++;
          continue;
        }
      }
      errors.push(`Failed to migrate wishlist country ${countryCode}`);
    }
  }

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
    } catch {
      errors.push('Failed to migrate profile preferences');
    }
  }

  // If everything migrated successfully, clear the onboarding store
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
