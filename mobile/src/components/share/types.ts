import type { TravelTier } from '@utils/travelTier';

export type OnboardingShareVariant = 'stamps' | 'stats' | 'vibe' | 'quizChallenge';

/** The onboarding trio shown in the share overlay pager. */
export type OnboardingPagerVariant = Exclude<OnboardingShareVariant, 'quizChallenge'>;

/**
 * Context for the quiz challenge results card (Travel Photo Quiz).
 * The card is the PUBLIC share artifact: it carries only the score-to-beat
 * and attribution - never quiz photos (messaging-app caches outlive
 * revocation, mirroring the link-unfurl decision).
 */
export interface QuizChallengeContext {
  /** Owner display name (2-50 chars) or null when the profile has none. */
  ownerDisplayName: string | null;
  scoreToBeat: {
    correct: number;
    total: number;
  };
}

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
