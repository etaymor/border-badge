/**
 * usePlaceSuggestions - Hook for fetching place suggestions from the API.
 *
 * Handles chunked API calls, caching, and error handling.
 */

import { useCallback, useRef } from 'react';
import { Alert } from 'react-native';

import {
  useSuggestPlacesChunked,
  RateLimitError,
  QuotaExhaustedError,
} from '@hooks/usePhotoImport';
import {
  getFullCluster,
  type TripCandidateDisplay,
  type LocationCluster,
} from '@services/photoImport';
import { Analytics } from '@services/analytics';
import { truncateCoordinate } from './photoImportUtils';

export interface UsePlaceSuggestionsOptions {
  clusterLookupRef: React.RefObject<Map<string, LocationCluster>>;
}

export function usePlaceSuggestions({ clusterLookupRef }: UsePlaceSuggestionsOptions) {
  const suggestPlacesMutation = useSuggestPlacesChunked();

  // Cache for fetched suggestions by candidate ID - prevents redundant API calls
  const fetchedCandidatesRef = useRef<Set<string>>(new Set());

  /**
   * Fetch place suggestions for a candidate.
   * Caches results to prevent redundant API calls when switching trips.
   */
  const fetchSuggestions = useCallback(
    async (candidate: TripCandidateDisplay) => {
      // Skip if we've already fetched suggestions for this candidate
      if (fetchedCandidatesRef.current.has(candidate.id)) {
        if (__DEV__) {
          console.log('[PhotoImport] Skipping fetch - already have suggestions for:', candidate.id);
        }
        return;
      }

      // Use ref to get current value - avoids stale closure issues
      const currentClusterLookup = clusterLookupRef.current;

      if (__DEV__) {
        console.log('[PhotoImport] fetchSuggestions called:', {
          candidateId: candidate.id,
          candidateClusterIds: candidate.locationClusterIds,
          clusterLookupRefSize: currentClusterLookup.size,
          clusterLookupRefKeys: Array.from(currentClusterLookup.keys()).slice(0, 5),
        });
      }

      const clustersForApi = candidate.locationClusterIds
        .map((id) => getFullCluster(id, currentClusterLookup))
        .filter((c): c is LocationCluster => c !== undefined);

      if (__DEV__) {
        console.log('[PhotoImport] Sending clusters to API:', {
          candidateId: candidate.id,
          clusterIds: clustersForApi.map((c) => c.id),
          clusterCount: clustersForApi.length,
        });
        for (const c of clustersForApi) {
          console.log(
            `[PhotoImport]   Cluster ${c.id}: centroid=(${c.centroid.latitude.toFixed(5)}, ${c.centroid.longitude.toFixed(5)}), photos=${c.photos.length}`
          );
        }
      }

      try {
        const result = await suggestPlacesMutation.mutateAsync({
          clusters: clustersForApi.map((c) => ({
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

        // Mark candidate as fetched so we don't re-fetch on trip changes
        fetchedCandidatesRef.current.add(candidate.id);

        // Track completion with failure count from progress
        const failedChunks = suggestPlacesMutation.progress?.failedChunks ?? 0;
        Analytics.photoImportSuggestionsCompleted({
          suggestionCount: result.suggestions.length,
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
   * Clear the fetched candidates cache.
   * Called when navigating away or on unmount.
   */
  const clearFetchedCache = useCallback(() => {
    fetchedCandidatesRef.current.clear();
  }, []);

  return {
    suggestPlacesMutation,
    fetchSuggestions,
    clearFetchedCache,
    fetchedCandidatesRef,
  };
}
