import type { RecognitionGroup } from '@constants/regions';

/**
 * Country status options for filtering.
 * Maps to user_countries status + "not visited" derived state.
 */
export type CountryStatus = 'visited' | 'dream' | 'not_visited';

/**
 * Filter state for the Explore filter sheet.
 * - status: Visited, Dream, or Not Visited (OR within)
 * - continents: Africa, Americas, Asia, Europe, Oceania (OR within)
 * - subregions: Granular regions within continents (OR within)
 * - recognitionGroups: UN Member, Special Status, Territory (OR within)
 *
 * Filters are AND across categories, OR within categories.
 */
export interface ExploreFilters {
  status: CountryStatus[];
  continents: string[];
  subregions: string[];
  recognitionGroups: RecognitionGroup[];
}

/**
 * Default empty filter state.
 * No filters active = show all countries.
 */
export const DEFAULT_FILTERS: ExploreFilters = {
  status: [],
  continents: [],
  subregions: [],
  recognitionGroups: [],
};

/**
 * Check if any filters are active.
 */
export function hasActiveFilters(filters: ExploreFilters): boolean {
  return (
    filters.status.length > 0 ||
    filters.continents.length > 0 ||
    filters.subregions.length > 0 ||
    filters.recognitionGroups.length > 0
  );
}

/**
 * Count total active filter selections.
 */
export function countActiveFilters(filters: ExploreFilters): number {
  return (
    filters.status.length +
    filters.continents.length +
    filters.subregions.length +
    filters.recognitionGroups.length
  );
}
