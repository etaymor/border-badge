/**
 * Shared regions constant for continent-based navigation.
 * Used in onboarding flow to iterate through continents.
 */
export const REGIONS = ['Africa', 'Americas', 'Asia', 'Europe', 'Oceania'] as const;

/**
 * All regions including Antarctica.
 * Used for progress indicators that include the Antarctica prompt.
 */
export const ALL_REGIONS = [...REGIONS, 'Antarctica'] as const;

export type Region = (typeof REGIONS)[number];
export type AllRegion = (typeof ALL_REGIONS)[number];
