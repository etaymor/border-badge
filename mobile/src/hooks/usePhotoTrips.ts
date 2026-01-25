/**
 * Hook for accessing photo-discovered trips from SQLite cache.
 *
 * Provides:
 * - All trips segmented from cached photos
 * - Grouping by country
 * - Search/filter by country name
 * - Refresh capability for incremental photo scans
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { TripCandidateDisplay } from '@services/photoImport/types';
import type { OptimizedTripData } from '@services/photoImport/photoClustering';
import {
  getAllCachedPhotos,
  getCachedPhotoCount,
  getLastImportTime,
  segmentTripsFromCache,
} from '@services/photoImport';
import { useOnboardingStore, selectHomeCountry } from '@stores/onboardingStore';
import { useCountries, type Country } from './useCountries';

export interface UsePhotoTripsResult {
  /** All trip candidates */
  trips: TripCandidateDisplay[];
  /** Trips grouped by country code */
  tripsByCountry: Map<string, TripCandidateDisplay[]>;
  /** Total number of cached photos */
  totalPhotoCount: number;
  /** Whether initial data is loading */
  isLoading: boolean;
  /** Whether a refresh is in progress */
  isRefreshing: boolean;
  /** Timestamp of last photo import (null if never imported) */
  lastImportTime: number | null;
  /** Whether user has completed at least one photo import */
  hasInitialImport: boolean;
  /** Trigger a refresh to check for new photos */
  refresh: () => Promise<void>;
  /** Current search query */
  searchQuery: string;
  /** Set search query for filtering */
  setSearchQuery: (query: string) => void;
  /** Trips filtered by search query */
  filteredTrips: TripCandidateDisplay[];
  /** Filtered trips grouped by country */
  filteredTripsByCountry: Map<string, TripCandidateDisplay[]>;
  /** Preview URIs from recent trips (for callout display) */
  previewUris: string[];
  /** Full optimized data including lookup maps */
  optimizedData: OptimizedTripData | null;
  /** Filtered trips grouped by year (most recent first) */
  filteredTripsByYear: Map<number, TripCandidateDisplay[]>;
  /** Years in descending order (most recent first) */
  sortedYears: number[];
}

/**
 * Build a map from country code to country name for search filtering.
 */
function buildCountryNameMap(countries: Country[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const country of countries) {
    map.set(country.code, country.name.toLowerCase());
  }
  return map;
}

/**
 * Group trips by country code.
 */
function groupByCountry(trips: TripCandidateDisplay[]): Map<string, TripCandidateDisplay[]> {
  const map = new Map<string, TripCandidateDisplay[]>();
  for (const trip of trips) {
    if (!map.has(trip.countryCode)) {
      map.set(trip.countryCode, []);
    }
    map.get(trip.countryCode)!.push(trip);
  }
  return map;
}

/**
 * Group trips by year based on their start date.
 * Returns a map with year as key and trips sorted by date (most recent first) within each year.
 */
function groupByYear(trips: TripCandidateDisplay[]): Map<number, TripCandidateDisplay[]> {
  const map = new Map<number, TripCandidateDisplay[]>();

  for (const trip of trips) {
    const year = trip.dateRange.start.getFullYear();
    if (!map.has(year)) {
      map.set(year, []);
    }
    map.get(year)!.push(trip);
  }

  // Sort trips within each year by date (most recent first)
  for (const [, yearTrips] of map) {
    yearTrips.sort((a, b) => b.dateRange.start.getTime() - a.dateRange.start.getTime());
  }

  return map;
}

export function usePhotoTrips(): UsePhotoTripsResult {
  const homeCountry = useOnboardingStore(selectHomeCountry);
  const { data: countries } = useCountries();

  const [trips, setTrips] = useState<TripCandidateDisplay[]>([]);
  const [optimizedData, setOptimizedData] = useState<OptimizedTripData | null>(null);
  const [totalPhotoCount, setTotalPhotoCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastImportTime, setLastImportTime] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Use ref for cleanup to avoid memory leaks
  const isMountedRef = useRef(true);
  const dataRef = useRef<OptimizedTripData | null>(null);

  // Build country name lookup for search filtering
  const countryNameMap = useMemo(() => buildCountryNameMap(countries), [countries]);

  // Load data from SQLite cache
  const loadFromCache = useCallback(async () => {
    try {
      const [cachedPhotos, importTime, photoCount] = await Promise.all([
        getAllCachedPhotos(),
        getLastImportTime(),
        getCachedPhotoCount(),
      ]);

      if (!isMountedRef.current) return;

      setLastImportTime(importTime);
      setTotalPhotoCount(photoCount);

      if (cachedPhotos.length > 0) {
        const data = segmentTripsFromCache(cachedPhotos, homeCountry);
        dataRef.current = data;
        setOptimizedData(data);
        setTrips(data.candidates);
      } else {
        dataRef.current = null;
        setOptimizedData(null);
        setTrips([]);
      }
    } catch (error) {
      if (__DEV__) {
        console.error('[usePhotoTrips] Failed to load from cache:', error);
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [homeCountry]);

  // Initial load
  useEffect(() => {
    isMountedRef.current = true;
    loadFromCache();

    return () => {
      isMountedRef.current = false;
      // Clear Maps to free memory
      if (dataRef.current) {
        dataRef.current.photoLookup.clear();
        dataRef.current.clusterLookup.clear();
        dataRef.current.clusterDisplays.clear();
        dataRef.current = null;
      }
    };
  }, [loadFromCache]);

  // Group trips by country (memoized)
  const tripsByCountry = useMemo(() => groupByCountry(trips), [trips]);

  // Filter trips by search query
  const filteredTrips = useMemo(() => {
    if (!searchQuery.trim()) return trips;

    const query = searchQuery.toLowerCase().trim();
    return trips.filter((trip) => {
      const countryName = countryNameMap.get(trip.countryCode);
      return countryName?.includes(query) ?? false;
    });
  }, [trips, searchQuery, countryNameMap]);

  // Filtered trips grouped by country
  const filteredTripsByCountry = useMemo(() => groupByCountry(filteredTrips), [filteredTrips]);

  // Filtered trips grouped by year
  const filteredTripsByYear = useMemo(() => groupByYear(filteredTrips), [filteredTrips]);

  // Years sorted in descending order (most recent first)
  const sortedYears = useMemo(
    () => Array.from(filteredTripsByYear.keys()).sort((a, b) => b - a),
    [filteredTripsByYear]
  );

  // Preview URIs for callout (from first 3 trips)
  const previewUris = useMemo(() => {
    const uris: string[] = [];
    for (const trip of trips.slice(0, 3)) {
      if (trip.previewUris.length > 0 && uris.length < 3) {
        uris.push(trip.previewUris[0]);
      }
    }
    return uris;
  }, [trips]);

  // Refresh: reload from cache (incremental scan happens via background sync)
  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await loadFromCache();
    } finally {
      if (isMountedRef.current) {
        setIsRefreshing(false);
      }
    }
  }, [loadFromCache]);

  return {
    trips,
    tripsByCountry,
    totalPhotoCount,
    isLoading,
    isRefreshing,
    lastImportTime,
    hasInitialImport: lastImportTime !== null,
    refresh,
    searchQuery,
    setSearchQuery,
    filteredTrips,
    filteredTripsByCountry,
    filteredTripsByYear,
    sortedYears,
    previewUris,
    optimizedData,
  };
}
