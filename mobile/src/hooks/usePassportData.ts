import { useEffect, useMemo, useRef, useState } from 'react';
import { Analytics } from '@services/analytics';
import { CONTINENT_TOTALS, getCountryRarity } from '@constants/countryRarity';
import { ALL_REGIONS, RECOGNITION_GROUPS } from '@constants/regions';
import {
  isCountryAllowedByPreference,
  getCountryCountForPreference,
  getAllowedRecognitionGroupsForPreference,
} from '@constants/trackingPreferences';
import { useCountries } from '@hooks/useCountries';
import { useProfile } from '@hooks/useProfile';
import { useTrips } from '@hooks/useTrips';
import { useAddUserCountry, useRemoveUserCountry, useUserCountries } from '@hooks/useUserCountries';
import { getTravelStatus as getTravelTier } from '@utils/travelTier';
import {
  DEFAULT_FILTERS,
  hasActiveFilters,
  countActiveFilters,
  type ExploreFilters,
} from '../types/filters';
import type { OnboardingShareContext } from '@components/share';
import type {
  CountryDisplayItem,
  UnvisitedCountry,
  ListItem,
  PassportStats,
} from '../screens/passport/passportTypes';

export function usePassportData() {
  const { data: userCountries, isLoading: loadingUserCountries } = useUserCountries();
  const { data: countries, isLoading: loadingCountries } = useCountries();
  const { data: trips, isLoading: loadingTrips } = useTrips();
  const { data: profile, isLoading: loadingProfile } = useProfile();
  const addUserCountry = useAddUserCountry();
  const removeUserCountry = useRemoveUserCountry();

  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState<ExploreFilters>(DEFAULT_FILTERS);
  const [filterSheetVisible, setFilterSheetVisible] = useState(false);

  const trackingPreference = profile?.tracking_preference ?? 'full_atlas';
  const isLoading = loadingUserCountries || loadingCountries || loadingTrips || loadingProfile;

  // Track passport view only when visited count changes
  const lastTrackedCountRef = useRef<number | null>(null);
  useEffect(() => {
    if (!loadingUserCountries && userCountries) {
      const visitedCount = userCountries.filter((uc) => uc.status === 'visited').length;
      if (lastTrackedCountRef.current !== visitedCount) {
        lastTrackedCountRef.current = visitedCount;
        Analytics.viewPassport(visitedCount);
      }
    }
  }, [loadingUserCountries, userCountries]);

  // Sync recognitionGroups filter when tracking preference changes
  useEffect(() => {
    if (filters.recognitionGroups.length === 0) return;

    const allowedGroups = getAllowedRecognitionGroupsForPreference(trackingPreference);
    const validGroups = filters.recognitionGroups.filter((group) => allowedGroups.has(group));

    if (validGroups.length !== filters.recognitionGroups.length) {
      setFilters((prev) => ({
        ...prev,
        recognitionGroups: validGroups,
      }));
    }
  }, [trackingPreference, filters.recognitionGroups]);

  // Compute visited and wishlist countries
  const { visitedCountries, wishlistCountries } = useMemo(() => {
    if (!userCountries) return { visitedCountries: [], wishlistCountries: [] };
    return {
      visitedCountries: userCountries.filter((uc) => uc.status === 'visited'),
      wishlistCountries: userCountries.filter((uc) => uc.status === 'wishlist'),
    };
  }, [userCountries]);

  // Pre-compute visited, wishlist, and trip code sets
  const { visitedCodes, wishlistCodes, countriesWithTrips } = useMemo(() => {
    return {
      visitedCodes: new Set(visitedCountries.map((uc) => uc.country_code)),
      wishlistCodes: new Set(wishlistCountries.map((uc) => uc.country_code)),
      countriesWithTrips: new Set(trips?.map((t) => t.country_code) ?? []),
    };
  }, [visitedCountries, wishlistCountries, trips]);

  // Pre-compute searchable country data filtered by tracking preference
  const searchableCountries = useMemo(() => {
    if (!countries) return [];
    return countries
      .filter((c) => isCountryAllowedByPreference(c.recognition, trackingPreference))
      .map((c) => ({
        ...c,
        searchName: c.name.toLowerCase(),
      }));
  }, [countries, trackingPreference]);

  // Apply explore filters to countries
  const filteredCountries = useMemo(() => {
    if (!searchableCountries.length) return [];

    let filtered = [...searchableCountries];

    if (filters.status.length > 0) {
      filtered = filtered.filter((country) => {
        const isVisited = visitedCodes.has(country.code);
        const isWishlisted = wishlistCodes.has(country.code);
        const isNotVisited = !isVisited && !isWishlisted;
        const hasTrips = countriesWithTrips.has(country.code);

        return (
          (filters.status.includes('visited') && isVisited) ||
          (filters.status.includes('dream') && isWishlisted) ||
          (filters.status.includes('not_visited') && isNotVisited) ||
          (filters.status.includes('has_trips') && hasTrips)
        );
      });
    }

    if (filters.continents.length > 0) {
      filtered = filtered.filter((country) => filters.continents.includes(country.region));
    }

    if (filters.subregions.length > 0) {
      filtered = filtered.filter(
        (country) => country.subregion && filters.subregions.includes(country.subregion)
      );
    }

    if (filters.recognitionGroups.length > 0) {
      const allowedRecognitions = filters.recognitionGroups.flatMap(
        (group) => RECOGNITION_GROUPS[group]
      );
      filtered = filtered.filter(
        (country) =>
          country.recognition &&
          allowedRecognitions.includes(country.recognition as (typeof allowedRecognitions)[number])
      );
    }

    return filtered;
  }, [searchableCountries, filters, visitedCodes, wishlistCodes, countriesWithTrips]);

  // Combine visited countries with country metadata for display
  const displayItems = useMemo((): CountryDisplayItem[] => {
    if (!visitedCountries.length || !filteredCountries.length) return [];

    const query = searchQuery.toLowerCase().trim();

    return filteredCountries
      .filter((c) => visitedCodes.has(c.code))
      .filter((c) => !query || c.searchName.includes(query))
      .map((c) => ({
        code: c.code,
        name: c.name,
        region: c.region,
        status: 'visited' as const,
        hasTrips: countriesWithTrips.has(c.code),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [visitedCountries, filteredCountries, searchQuery, countriesWithTrips, visitedCodes]);

  // Compute all stats
  const stats: PassportStats = useMemo(() => {
    const allowedVisitedCountries = visitedCountries.filter((uc) => {
      const country = countries?.find((c) => c.code === uc.country_code);
      return country && isCountryAllowedByPreference(country.recognition, trackingPreference);
    });
    const allowedWishlistCountries = wishlistCountries.filter((uc) => {
      const country = countries?.find((c) => c.code === uc.country_code);
      return country && isCountryAllowedByPreference(country.recognition, trackingPreference);
    });

    const stampedCount = allowedVisitedCountries.length;
    const dreamsCount = allowedWishlistCountries.length;
    const totalCountries = getCountryCountForPreference(trackingPreference);
    const worldPercentage =
      totalCountries > 0 ? Math.round((stampedCount / totalCountries) * 100) : 0;

    const visitedCodesSet = new Set(allowedVisitedCountries.map((uc) => uc.country_code));
    const visitedCountryDetails = countries?.filter((c) => visitedCodesSet.has(c.code)) || [];
    const uniqueRegions = new Set(visitedCountryDetails.map((c) => c.region));
    const regionsCount = uniqueRegions.size;

    const travelStatus = getTravelTier(stampedCount).status;

    return {
      stampedCount,
      dreamsCount,
      totalCountries,
      worldPercentage,
      regionsCount,
      travelStatus,
    };
  }, [visitedCountries, wishlistCountries, countries, trackingPreference]);

  // Build share context for passport share overlay
  const passportShareContext: OnboardingShareContext | null = useMemo(() => {
    if (!countries?.length || !visitedCountries?.length) return null;

    const visitedCodesArray = visitedCountries.map((uc) => uc.country_code);
    const visitedCountryData = countries.filter((c) => visitedCodes.has(c.code));

    const regions = [...new Set(visitedCountryData.map((c) => c.region))];
    const subregions = [
      ...new Set(visitedCountryData.map((c) => c.subregion).filter(Boolean)),
    ] as string[];

    const continentStats = ALL_REGIONS.map((region) => {
      const visitedInRegion = visitedCountryData.filter((c) => c.region === region);

      let rarestCountryCode: string | null = null;
      if (visitedInRegion.length > 0) {
        const rarest = visitedInRegion.reduce((best, c) =>
          getCountryRarity(c.code) > getCountryRarity(best.code) ? c : best
        );
        rarestCountryCode = rarest.code;
      }

      return {
        name: region,
        visitedCount: visitedInRegion.length,
        totalCount: CONTINENT_TOTALS[region] || 0,
        rarestCountryCode,
      };
    });

    return {
      visitedCountries: visitedCodesArray,
      totalCountries: visitedCodesArray.length,
      regions,
      regionCount: regions.length,
      subregions,
      subregionCount: subregions.length,
      travelTier: getTravelTier(visitedCodesArray.length),
      continentStats,
      motivationTags: profile?.travel_motives ?? [],
      personaTags: profile?.persona_tags ?? [],
    };
  }, [countries, visitedCountries, visitedCodes, profile]);

  // Compute unvisited countries for the Explore section
  const unvisitedCountries = useMemo((): UnvisitedCountry[] => {
    if (!filteredCountries.length) return [];

    const query = searchQuery.toLowerCase().trim();

    return filteredCountries
      .filter((c) => !visitedCodes.has(c.code))
      .filter((c) => !query || c.searchName.includes(query))
      .map((c) => ({
        code: c.code,
        name: c.name,
        region: c.region,
        isWishlisted: wishlistCodes.has(c.code),
        hasTrips: countriesWithTrips.has(c.code),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [filteredCountries, visitedCodes, wishlistCodes, countriesWithTrips, searchQuery]);

  // Flatten data into single array with section markers
  const flatListData = useMemo((): ListItem[] => {
    const items: ListItem[] = [];

    if (displayItems.length > 0 || !searchQuery) {
      items.push({ type: 'section-header', title: "Where you've been", key: 'header-visited' });
    }

    if (!searchQuery && displayItems.length === 0 && stats.stampedCount === 0) {
      items.push({ type: 'empty-state', key: 'empty-state' });
    }

    for (let i = 0; i < displayItems.length; i += 2) {
      const rowItems = displayItems.slice(i, i + 2);
      const rowKey = rowItems.map((item) => item.code).join('-');
      items.push({ type: 'stamp-row', data: rowItems, key: `stamps-${rowKey}` });
    }

    if (unvisitedCountries.length > 0) {
      items.push({ type: 'section-header', title: 'Explore the World', key: 'header-explore' });
      for (let i = 0; i < unvisitedCountries.length; i += 2) {
        const rowItems = unvisitedCountries.slice(i, i + 2);
        const rowKey = rowItems.map((item) => item.code).join('-');
        items.push({ type: 'unvisited-row', data: rowItems, key: `unvisited-${rowKey}` });
      }
    }

    return items;
  }, [displayItems, unvisitedCountries, searchQuery, stats.stampedCount]);

  const activeFilterCount = countActiveFilters(filters);
  const filtersActive = hasActiveFilters(filters);

  return {
    // Loading state
    isLoading,
    // Data
    userCountries,
    countries,
    visitedCountries,
    wishlistCountries,
    // Computed data
    stats,
    passportShareContext,
    flatListData,
    displayItems,
    unvisitedCountries,
    // Filter state
    searchQuery,
    setSearchQuery,
    filters,
    setFilters,
    filterSheetVisible,
    setFilterSheetVisible,
    filtersActive,
    activeFilterCount,
    trackingPreference,
    // Mutations
    addUserCountry,
    removeUserCountry,
  };
}
