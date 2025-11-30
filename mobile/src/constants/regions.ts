/**
 * Shared regions constant for continent-based navigation.
 * Used in onboarding flow to iterate through continents.
 */
export const REGIONS = ['Africa', 'Americas', 'Asia', 'Europe', 'Oceania'] as const;

export type Region = (typeof REGIONS)[number];
