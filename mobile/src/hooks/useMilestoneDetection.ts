/**
 * Hook for detecting milestones when a user visits a new country.
 * Uses the countries and user countries data to calculate achievements.
 */

import { useMemo } from 'react';

import { useCountries } from '@hooks/useCountries';
import { useUserCountries } from '@hooks/useUserCountries';
import { buildMilestoneContext, type MilestoneContext } from '@utils/milestones';

/**
 * Returns a function to calculate milestones for a given country code.
 * Uses memoized data from useCountries and useUserCountries.
 */
export function useMilestoneDetection() {
  const { data: countries } = useCountries();
  const { data: userCountries } = useUserCountries();

  const getMilestoneContext = useMemo(() => {
    return (countryCode: string): MilestoneContext | null => {
      if (!countries || !userCountries) return null;
      return buildMilestoneContext(countryCode, countries, userCountries);
    };
  }, [countries, userCountries]);

  return { getMilestoneContext };
}
