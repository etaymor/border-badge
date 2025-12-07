import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

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
};

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
        const updated = current.includes(countryCode)
          ? current.filter((c) => c !== countryCode)
          : [...current, countryCode];
        set({ selectedCountries: updated });
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

      setHomeCountry: (code) => set({ homeCountry: code }),

      setDreamDestination: (code) => set({ dreamDestination: code }),

      toggleBucketListCountry: (countryCode) => {
        const current = get().bucketListCountries;
        const updated = current.includes(countryCode)
          ? current.filter((c) => c !== countryCode)
          : [...current, countryCode];
        set({ bucketListCountries: updated });
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

      reset: () => set(initialState),
    }),
    {
      name: 'onboarding-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
