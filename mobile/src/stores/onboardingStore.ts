import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { TrackingPreset } from '@constants/trackingPreferences';
import {
  saveLocalUserCountry,
  removeLocalUserCountry,
  clearLocalUserCountries,
  type LocalUserCountry,
} from '@services/countriesDb';

interface OnboardingState {
  // Existing fields
  motivationTags: string[]; // "Why I Travel" tags
  selectedCountries: string[]; // Visited countries
  currentStep: number;

  // New fields for revised onboarding flow
  personaTags: string[]; // "I Am A..." tags
  homeCountry: string | null; // Country code
  dreamDestination: string | null; // Country code (bucket list seed)
  bucketListCountries: string[]; // Countries added to bucket list during onboarding
  visitedContinents: string[]; // Tracks which continents user said "Yes" to
  displayName: string | null; // User's display name for account creation
  trackingPreference: TrackingPreset; // Country tracking preference

  // Actions - existing
  setMotivationTags: (tags: string[]) => void;
  toggleMotivationTag: (tag: string) => void;
  setSelectedCountries: (countries: string[]) => void;
  toggleCountry: (countryCode: string) => void;
  setCurrentStep: (step: number) => void;
  reset: () => void;

  // Actions - new
  setPersonaTags: (tags: string[]) => void;
  togglePersonaTag: (tag: string) => void;
  setHomeCountry: (code: string | null) => void;
  setDreamDestination: (code: string | null) => void;
  toggleBucketListCountry: (countryCode: string) => void;
  addVisitedContinent: (region: string) => void;
  removeVisitedContinent: (region: string) => void;
  setDisplayName: (name: string | null) => void;
  setTrackingPreference: (preference: TrackingPreset) => void;
}

const initialState = {
  motivationTags: [] as string[],
  selectedCountries: [] as string[],
  currentStep: 0,
  personaTags: [] as string[],
  homeCountry: null as string | null,
  dreamDestination: null as string | null,
  bucketListCountries: [] as string[],
  visitedContinents: [] as string[],
  displayName: null as string | null,
  trackingPreference: 'full_atlas' as TrackingPreset,
};

/**
 * Helper to create a LocalUserCountry object for SQLite storage.
 */
function createLocalUserCountry(
  countryCode: string,
  status: 'visited' | 'wishlist'
): LocalUserCountry {
  return {
    id: `local-${status}-${countryCode}`,
    country_code: countryCode,
    status,
    created_at: new Date().toISOString(),
    added_during_onboarding: true,
  };
}

/**
 * Sync a country selection to SQLite (fire and forget - don't block UI).
 */
function syncToSQLite(
  countryCode: string,
  status: 'visited' | 'wishlist',
  isAdding: boolean
): void {
  if (isAdding) {
    saveLocalUserCountry(createLocalUserCountry(countryCode, status)).catch((err) =>
      console.warn('Failed to save country to SQLite:', err)
    );
  } else {
    removeLocalUserCountry(countryCode).catch((err) =>
      console.warn('Failed to remove country from SQLite:', err)
    );
  }
}

export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set, get) => ({
      ...initialState,

      setMotivationTags: (tags) => set({ motivationTags: tags }),

      toggleMotivationTag: (tag) => {
        const current = get().motivationTags;
        const updated = current.includes(tag)
          ? current.filter((t) => t !== tag)
          : [...current, tag];
        set({ motivationTags: updated });
      },

      setSelectedCountries: (countries) => set({ selectedCountries: countries }),

      toggleCountry: (countryCode) => {
        const current = get().selectedCountries;
        const isAdding = !current.includes(countryCode);
        const updated = isAdding
          ? [...current, countryCode]
          : current.filter((c) => c !== countryCode);
        set({ selectedCountries: updated });
        // Sync to SQLite for immediate display on passport screen
        syncToSQLite(countryCode, 'visited', isAdding);
      },

      setCurrentStep: (step) => set({ currentStep: step }),

      // New actions
      setPersonaTags: (tags) => set({ personaTags: tags }),

      togglePersonaTag: (tag) => {
        const current = get().personaTags;
        const updated = current.includes(tag)
          ? current.filter((t) => t !== tag)
          : [...current, tag];
        set({ personaTags: updated });
      },

      setHomeCountry: (code) => {
        const prev = get().homeCountry;
        set({ homeCountry: code });
        // Sync to SQLite - home country is also a visited country
        if (prev && prev !== code) {
          // Remove old home country if it was set
          syncToSQLite(prev, 'visited', false);
        }
        if (code) {
          syncToSQLite(code, 'visited', true);
        }
      },

      setDreamDestination: (code) => {
        const prev = get().dreamDestination;
        set({ dreamDestination: code });
        // Sync to SQLite - dream destination is a wishlist country
        if (prev && prev !== code) {
          syncToSQLite(prev, 'wishlist', false);
        }
        if (code) {
          syncToSQLite(code, 'wishlist', true);
        }
      },

      toggleBucketListCountry: (countryCode) => {
        const current = get().bucketListCountries;
        const isAdding = !current.includes(countryCode);
        const updated = isAdding
          ? [...current, countryCode]
          : current.filter((c) => c !== countryCode);
        set({ bucketListCountries: updated });
        // Sync to SQLite for immediate display on passport screen
        syncToSQLite(countryCode, 'wishlist', isAdding);
      },

      addVisitedContinent: (region) => {
        const current = get().visitedContinents;
        if (!current.includes(region)) {
          set({ visitedContinents: [...current, region] });
        }
      },

      removeVisitedContinent: (region) => {
        const current = get().visitedContinents;
        set({ visitedContinents: current.filter((r) => r !== region) });
      },

      setDisplayName: (name) => set({ displayName: name }),

      setTrackingPreference: (preference) => set({ trackingPreference: preference }),

      reset: () => {
        set(initialState);
        // Clear SQLite user countries when resetting onboarding
        clearLocalUserCountries().catch((err) =>
          console.warn('Failed to clear SQLite user countries:', err)
        );
      },
    }),
    {
      name: 'onboarding-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);

// Selectors - use these to prevent re-renders when unrelated state changes
export const selectMotivationTags = (state: OnboardingState) => state.motivationTags;
export const selectSelectedCountries = (state: OnboardingState) => state.selectedCountries;
export const selectCurrentStep = (state: OnboardingState) => state.currentStep;
export const selectPersonaTags = (state: OnboardingState) => state.personaTags;
export const selectHomeCountry = (state: OnboardingState) => state.homeCountry;
export const selectDreamDestination = (state: OnboardingState) => state.dreamDestination;
export const selectBucketListCountries = (state: OnboardingState) => state.bucketListCountries;
export const selectVisitedContinents = (state: OnboardingState) => state.visitedContinents;
export const selectDisplayName = (state: OnboardingState) => state.displayName;
export const selectTrackingPreference = (state: OnboardingState) => state.trackingPreference;
