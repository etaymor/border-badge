/**
 * usePlaceSuggestions - Hook for fetching place suggestions from the API.
 *
 * Handles chunked API calls, persistent SQLite caching, and error handling.
 * Checks SQLite cache before API calls to minimize Google Places API costs.
 */

import { useCallback, useRef, useState } from 'react';
import { Alert } from 'react-native';

import {
  useSuggestPlacesChunked,
  RateLimitError,
  QuotaExhaustedError,
} from '@hooks/usePhotoImport';
import {
  getFullCluster,
  getCachedSuggestions,
  cacheSuggestions,
  type TripCandidateDisplay,
  type LocationCluster,
  type ClusterSuggestion,
} from '@services/photoImport';
import { Analytics } from '@services/analytics';
import { truncateCoordinate } from './photoImportUtils';

export interface UsePlaceSuggestionsOptions {
  clusterLookupRef: React.RefObject<Map<string, LocationCluster>>;
}

export function usePlaceSuggestions({ clusterLookupRef }: UsePlaceSuggestionsOptions) {
  const suggestPlacesMutation = useSuggestPlacesChunked();

  // Session cache for fetched candidates - prevents re-running cache logic within same session
  const fetchedCandidatesRef = useRef<Set<string>>(new Set());

  // Cached suggestions loaded from SQLite - merged with API results in the UI
  const [cachedSuggestions, setCachedSuggestions] = useState<ClusterSuggestion[]>([]);

  /**
   * Fetch place suggestions for a candidate.
   * Checks SQLite cache first, only fetching uncached clusters from API.
   */
  const fetchSuggestions = useCallback(
    async (candidate: TripCandidateDisplay) => {
      // Skip if we've already processed this candidate in this session
      if (fetchedCandidatesRef.current.has(candidate.id)) {
        if (__DEV__) {
          console.log('[PhotoImport] Skipping fetch - already processed:', candidate.id);
        }
        return;
      }

      const currentClusterLookup = clusterLookupRef.current;

      // Get all clusters for this candidate
      const allClusters = candidate.locationClusterIds
        .map((id) => getFullCluster(id, currentClusterLookup))
        .filter((c): c is LocationCluster => c !== undefined);

      if (allClusters.length === 0) {
        if (__DEV__) {
          console.log('[PhotoImport] No clusters found for candidate:', candidate.id);
        }
        fetchedCandidatesRef.current.add(candidate.id);
        return;
      }

      // Check SQLite cache for existing suggestions
      const cachedSuggestionsMap = await getCachedSuggestions(allClusters.map((c) => c.id));

      // Separate cached and uncached clusters
      const cachedClusterIds = new Set(cachedSuggestionsMap.keys());
      const uncachedClusters = allClusters.filter((c) => !cachedClusterIds.has(c.id));

      if (__DEV__) {
        console.log('[PhotoImport] Cache check:', {
          candidateId: candidate.id,
          totalClusters: allClusters.length,
          cachedClusters: cachedClusterIds.size,
          uncachedClusters: uncachedClusters.length,
        });
      }

      // Build cached suggestions in ClusterSuggestion format
      const cachedResults: ClusterSuggestion[] = [];
      for (const cluster of allClusters) {
        const cached = cachedSuggestionsMap.get(cluster.id);
        if (cached !== undefined) {
          cachedResults.push({
            cluster_id: cluster.id,
            photo_ids: cluster.photos.map((p) => p.id),
            places: cached as ClusterSuggestion['places'],
          });
        }
      }

      // Store cached results for the UI to merge with API results
      setCachedSuggestions(cachedResults);

      // If all clusters are cached, we're done - no API call needed
      if (uncachedClusters.length === 0) {
        if (__DEV__) {
          console.log('[PhotoImport] All clusters cached - no API call needed');
        }
        // Reset mutation state and mark as fetched
        suggestPlacesMutation.reset();
        fetchedCandidatesRef.current.add(candidate.id);

        // Track analytics for cache hits
        Analytics.photoImportSuggestionsCompleted({
          suggestionCount: cachedResults.length,
          failedChunks: 0,
        });
        return;
      }

      // Fetch uncached clusters from API
      if (__DEV__) {
        console.log('[PhotoImport] Fetching uncached clusters from API:', {
          candidateId: candidate.id,
          clusterIds: uncachedClusters.map((c) => c.id),
          clusterCount: uncachedClusters.length,
        });
      }

      try {
        const result = await suggestPlacesMutation.mutateAsync({
          clusters: uncachedClusters.map((c) => ({
            id: c.id,
            centroid: {
              latitude: truncateCoordinate(c.centroid.latitude),
              longitude: truncateCoordinate(c.centroid.longitude),
            },
            photos: c.photos.map((p) => ({
              asset_id: p.id,
              latitude: truncateCoordinate(p.location.latitude),
              longitude: truncateCoordinate(p.location.longitude),
              timestamp: p.creationTime.toISOString(),
            })),
            start_time: c.timeRange.start.toISOString(),
            end_time: c.timeRange.end.toISOString(),
          })),
        });

        if (__DEV__) {
          console.log('[PhotoImport] API result:', {
            suggestionCount: result.suggestions.length,
            suggestionClusterIds: result.suggestions.map((s) => s.cluster_id),
          });
        }

        // Cache the fresh API results to SQLite
        // Include clusters that returned no suggestions (empty array) to prevent re-querying
        const suggestionsToCache = uncachedClusters.map((cluster) => {
          const suggestion = result.suggestions.find((s) => s.cluster_id === cluster.id);
          return {
            cluster_id: cluster.id,
            places: suggestion?.places ?? [],
          };
        });

        await cacheSuggestions(suggestionsToCache);

        if (__DEV__) {
          console.log('[PhotoImport] Cached suggestions to SQLite:', {
            cachedCount: suggestionsToCache.length,
            withPlaces: suggestionsToCache.filter((s) => s.places.length > 0).length,
            empty: suggestionsToCache.filter((s) => s.places.length === 0).length,
          });
        }

        // Mark candidate as processed
        fetchedCandidatesRef.current.add(candidate.id);

        // Track analytics
        const failedChunks = suggestPlacesMutation.progress?.failedChunks ?? 0;
        Analytics.photoImportSuggestionsCompleted({
          suggestionCount: result.suggestions.length + cachedResults.length,
          failedChunks,
        });
      } catch (error) {
        if (__DEV__) console.error('[PhotoImport] Suggestion error:', error);

        if (error instanceof QuotaExhaustedError) {
          Analytics.photoImportApiError({ errorType: 'quota_exhausted' });
          Alert.alert(
            'Service Temporarily Unavailable',
            'The place suggestion service has reached its daily limit. Please try again tomorrow.'
          );
        } else if (error instanceof RateLimitError) {
          Analytics.photoImportApiError({ errorType: 'rate_limited' });
          Alert.alert(
            'Too Many Requests',
            `Please wait ${error.retryAfterSeconds} seconds before trying again.`
          );
        } else {
          Analytics.photoImportApiError({ errorType: 'unknown' });
          Alert.alert(
            'Failed to Get Suggestions',
            'Unable to find place suggestions. Please try again.'
          );
        }
      }
    },
    [suggestPlacesMutation, clusterLookupRef]
  );

  /**
   * Clear the session cache and cached suggestions.
   * Called when navigating away or on unmount.
   */
  const clearFetchedCache = useCallback(() => {
    fetchedCandidatesRef.current.clear();
    setCachedSuggestions([]);
  }, []);

  return {
    suggestPlacesMutation,
    cachedSuggestions,
    fetchSuggestions,
    clearFetchedCache,
    fetchedCandidatesRef,
  };
}
