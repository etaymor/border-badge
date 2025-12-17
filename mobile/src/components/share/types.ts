import type { TravelTier } from '@utils/travelTier';

export type OnboardingShareVariant = 'stamps' | 'stats' | 'map';

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
}

export interface VariantProps {
  context: OnboardingShareContext;
}
