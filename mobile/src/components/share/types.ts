import type { TravelTier } from '@utils/travelTier';

export type OnboardingShareVariant = 'stamps' | 'stats' | 'vibe';

export interface ContinentStats {
  name: string;
  visitedCount: number;
  totalCount: number;
  rarestCountryCode: string | null;
}

export interface OnboardingShareContext {
  visitedCountries: string[];
  totalCountries: number;
  regions: string[];
  regionCount: number;
  subregions: string[];
  subregionCount: number;
  travelTier: TravelTier;
  continentStats: ContinentStats[];
  // Profile tags for traveler classification
  motivationTags: string[];
  personaTags: string[];
  // Home country code - excluded from signature country selection (unless it's the only one)
  homeCountry: string | null;
}

export interface VariantProps {
  context: OnboardingShareContext;
}
