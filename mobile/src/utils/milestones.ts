/**
 * Milestone detection for country achievements.
 * Detects round numbers, new continents, new subregions, and region completions.
 */

import type { Ionicons } from '@expo/vector-icons';

import { colors } from '@constants/colors';
import type { Country } from '@services/countriesDb';
import type { UserCountry } from '@hooks/useUserCountries';
import { logger } from '@utils/logger';

/** Round number thresholds that trigger milestones */
const ROUND_NUMBER_MILESTONES = [10, 25, 50, 100] as const;

export type MilestoneType = 'round_number' | 'new_continent' | 'new_subregion' | 'region_complete';

export interface Milestone {
  type: MilestoneType;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
}

export interface MilestoneContext {
  countryCode: string;
  countryName: string;
  countryRegion: string;
  countrySubregion: string | null;
  newTotalCount: number;
  milestones: Milestone[];
}

/**
 * Detects all milestones achieved when adding a new country.
 * @param newCountryCode - The country code being added
 * @param allCountries - Full list of all countries
 * @param visitedCountries - User's current visited countries (before adding new one)
 * @returns Array of detected milestones
 */
export function detectMilestones(
  newCountryCode: string,
  allCountries: Country[],
  visitedCountries: UserCountry[]
): Milestone[] {
  const milestones: Milestone[] = [];
  const newCountry = allCountries.find((c) => c.code === newCountryCode);
  if (!newCountry) {
    logger.warn(`detectMilestones: Country not found in allCountries list: ${newCountryCode}`);
    return milestones;
  }

  // Get previously visited (excluding the new one in case of re-visit edge case)
  const previousVisited = visitedCountries.filter(
    (uc) => uc.status === 'visited' && uc.country_code !== newCountryCode
  );
  const newTotalCount = previousVisited.length + 1;

  // 1. Round number milestones (10, 25, 50, 100)
  if (ROUND_NUMBER_MILESTONES.includes(newTotalCount as (typeof ROUND_NUMBER_MILESTONES)[number])) {
    milestones.push({
      type: 'round_number',
      label: `${newTotalCount} Countries!`,
      icon: 'trophy',
      color: colors.sunsetGold,
    });
  }

  // 2. New continent (first country in a new region)
  // Log warning for any visited countries not found in allCountries (indicates stale data)
  const missingCountries = previousVisited.filter(
    (uc) => !allCountries.find((c) => c.code === uc.country_code)
  );
  if (missingCountries.length > 0) {
    logger.warn(
      `detectMilestones: ${missingCountries.length} visited countries not found in allCountries: ${missingCountries.map((uc) => uc.country_code).join(', ')}`
    );
  }

  const previousContinents = new Set(
    previousVisited
      .map((uc) => allCountries.find((c) => c.code === uc.country_code)?.region)
      .filter((region): region is string => Boolean(region))
  );
  if (!previousContinents.has(newCountry.region)) {
    milestones.push({
      type: 'new_continent',
      label: `First in ${newCountry.region}!`,
      icon: 'globe',
      color: colors.mossGreen,
    });
  }

  // 3. New subregion (first country in a new subregion)
  if (newCountry.subregion) {
    const previousSubregions = new Set(
      previousVisited
        .map((uc) => allCountries.find((c) => c.code === uc.country_code)?.subregion)
        .filter((subregion): subregion is string => Boolean(subregion))
    );
    if (!previousSubregions.has(newCountry.subregion)) {
      milestones.push({
        type: 'new_subregion',
        label: `First in ${newCountry.subregion}!`,
        icon: 'flag',
        color: colors.lakeBlue,
      });
    }
  }

  // 4. Region completion (all countries in a subregion visited)
  if (newCountry.subregion) {
    const countriesInSubregion = allCountries.filter((c) => c.subregion === newCountry.subregion);
    const visitedCodes = new Set([...previousVisited.map((uc) => uc.country_code), newCountryCode]);
    const visitedInSubregion = countriesInSubregion.filter((c) => visitedCodes.has(c.code));

    if (visitedInSubregion.length === countriesInSubregion.length) {
      milestones.push({
        type: 'region_complete',
        label: `All of ${newCountry.subregion}!`,
        icon: 'checkmark-circle',
        color: colors.adobeBrick,
      });
    }
  }

  return milestones;
}

/**
 * Builds a complete milestone context for displaying in the share card.
 * @param countryCode - The country code being added
 * @param allCountries - Full list of all countries
 * @param visitedCountries - User's current visited countries (before adding new one)
 * @returns MilestoneContext or null if country not found
 */
export function buildMilestoneContext(
  countryCode: string,
  allCountries: Country[],
  visitedCountries: UserCountry[]
): MilestoneContext | null {
  const country = allCountries.find((c) => c.code === countryCode);
  if (!country) {
    logger.warn(`buildMilestoneContext: Country not found in allCountries list: ${countryCode}`);
    return null;
  }

  const previousVisited = visitedCountries.filter(
    (uc) => uc.status === 'visited' && uc.country_code !== countryCode
  );

  return {
    countryCode,
    countryName: country.name,
    countryRegion: country.region,
    countrySubregion: country.subregion,
    newTotalCount: previousVisited.length + 1,
    milestones: detectMilestones(countryCode, allCountries, visitedCountries),
  };
}
