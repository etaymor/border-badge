/**
 * usePlaceSuggestions - Hook for fetching place suggestions from the API.
 *
 * Handles chunked API calls, persistent SQLite caching, and error handling.
 * Checks SQLite cache before API calls to minimize Google Places API costs.
 *
 * Premium gating: Free users get 1 photo trip import. The usage is counted
 * when successfully fetching suggestions that require API calls.
 */

import { useCallback, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { AxiosError } from 'axios';

import {
  useSuggestPlacesChunked,
  RateLimitError,
  QuotaExhaustedError,
} from '@hooks/usePhotoImport';
import { api } from '@services/api';
import {
  getFullCluster,
  getCachedSuggestions,
  cacheSuggestions,
  clusterLocationKey,
  type TripCandidateDisplay,
  type LocationCluster,
  type ClusterSuggestion,
  type PlaceSuggestion,
  type PlaceSuggestionResponse,
} from '@services/photoImport';
import { getVisionImagesForCluster } from '@services/photoImport/visionPhoto';
import { Analytics, calculateApiPercentiles } from '@services/analytics';
import { useSubscriptionStore, useIsPremium, useCanImportPhotos } from '@stores/subscriptionStore';
import { mapClusterToApiPayload } from './photoImportUtils';

const VISION_PREP_CONCURRENCY = 3;

/** Validate that a cached entry has the shape of a PlaceSuggestion. */
function isPlaceSuggestion(item: unknown): item is PlaceSuggestion {
  if (typeof item !== 'object' || item === null) return false;
  const obj = item as Record<string, unknown>;
  return typeof obj.place_id === 'string' && typeof obj.name === 'string';
}

async function prepareVisionImagesBounded(
  clusters: LocationCluster[],
  maxConcurrency: number = VISION_PREP_CONCURRENCY
): Promise<string[][]> {
  if (clusters.length === 0) return [];

  const results: string[][] = Array.from({ length: clusters.length }, () => []);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const index = nextIndex++;
      if (index >= clusters.length) break;
      results[index] = await getVisionImagesForCluster(clusters[index]);
    }
  }

  const workerCount = Math.min(Math.max(1, maxConcurrency), clusters.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return results;
}

export interface UsePlaceSuggestionsOptions {
  clusterLookupRef: React.RefObject<Map<string, LocationCluster>>;
  /** Ref tracking current candidate ID to detect stale responses during rapid switching */
  currentCandidateIdRef?: React.RefObject<string | null>;
}

export function usePlaceSuggestions({
  clusterLookupRef,
  currentCandidateIdRef,
}: UsePlaceSuggestionsOptions) {
  const suggestPlacesMutation = useSuggestPlacesChunked();

  // Premium subscription state
  const isPremium = useIsPremium();
  const canImportPhotos = useCanImportPhotos();
  const incrementPhotoImportUsage = useSubscriptionStore((s) => s.incrementPhotoImportUsage);

  // Track if we've already counted usage for this session
  // (to prevent double-counting if user switches between candidates)
  const hasCountedUsageRef = useRef(false);

  // Session cache for fetched candidates - prevents re-running cache logic within same session
  const fetchedCandidatesRef = useRef<Set<string>>(new Set());

  // Cached suggestions loaded from SQLite - merged with API results in the UI
  const [cachedSuggestions, setCachedSuggestions] = useState<ClusterSuggestion[]>([]);

  /**
   * Fetch place suggestions for a candidate.
   * Checks SQLite cache first, only fetching uncached clusters from API.
   *
   * When currentCandidateIdRef is provided, this function checks for stale
   * responses caused by rapid candidate switching. If the candidate ID changes
   * during an async operation, results are discarded to prevent race conditions.
   *
   * Returns undefined on success, or { gatedByPremium: true } if user hit premium limit.
   */
  const fetchSuggestions = useCallback(
    async (candidate: TripCandidateDisplay): Promise<{ gatedByPremium: true } | undefined> => {
      // Capture the candidate ID at the start to detect stale responses
      const requestCandidateId = candidate.id;

      // Helper to check if this request is still valid (user hasn't switched candidates)
      const isStaleRequest = () => {
        if (!currentCandidateIdRef) return false;
        return currentCandidateIdRef.current !== requestCandidateId;
      };

      // Skip if we've already processed this candidate in this session
      if (fetchedCandidatesRef.current.has(candidate.id)) {
        if (__DEV__) {
          console.log('[PhotoImport] Skipping fetch - already processed:', candidate.id);
        }
        return undefined;
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
        return undefined;
      }

      // Check SQLite cache for existing suggestions. Pass the location key so a
      // re-segmented/split cluster reuses a prior result for the same physical
      // spot (via the location_key fallback) instead of re-buying it.
      const cachedSuggestionsMap = await getCachedSuggestions(
        allClusters.map((c) => ({ id: c.id, locationKey: clusterLocationKey(c.centroid) }))
      );

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
          const validPlaces = cached.filter(isPlaceSuggestion);
          cachedResults.push({
            cluster_id: cluster.id,
            photo_ids: cluster.photos.map((p) => p.id),
            places: validPlaces,
          });
        }
      }

      // Check for stale request before applying cached results
      if (isStaleRequest()) {
        if (__DEV__) {
          console.log('[PhotoImport] Discarding stale cached results for:', requestCandidateId);
        }
        return undefined;
      }

      // Store cached results for the UI to merge with API results
      setCachedSuggestions(cachedResults);

      // Calculate cache metrics
      const cachedClusterCount = cachedClusterIds.size;
      const uncachedClusterCount = uncachedClusters.length;
      const totalClusterCount = allClusters.length;
      const cacheHitRate =
        totalClusterCount > 0 ? Math.round((cachedClusterCount / totalClusterCount) * 100) : 0;

      // Check premium gating before continuing (even for cache-only results)
      // Free users get 1 photo trip import; gate any additional imports regardless of cache hit
      if (!isPremium && !canImportPhotos) {
        // User has exhausted their free photo trip import
        // Return the cached results only - they need to upgrade for API calls
        if (__DEV__) {
          console.log('[PhotoImport] Premium gate: User has used free photo trip import');
        }
        // Mark candidate as processed to prevent re-fetching
        fetchedCandidatesRef.current.add(candidate.id);
        // Return special marker that caller can check to show paywall
        return { gatedByPremium: true };
      }

      // If all clusters are cached, we're done - no API call needed
      if (uncachedClusters.length === 0) {
        if (__DEV__) {
          console.log('[PhotoImport] All clusters cached - no API call needed');
        }
        // Reset mutation state and mark as fetched (only if still current)
        if (!isStaleRequest()) {
          suggestPlacesMutation.reset();
          fetchedCandidatesRef.current.add(candidate.id);

          // Track analytics for cache hits (100% cache hit rate, no API times)
          Analytics.photoImportSuggestionsCompleted({
            suggestionCount: cachedResults.length,
            failedChunks: 0,
            cachedClusters: cachedClusterCount,
            uncachedClusters: 0,
            cacheHitRate: 100,
          });
        }
        return undefined;
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
        // Prepare vision images with bounded concurrency to reduce memory pressure.
        const visionImages = await prepareVisionImagesBounded(uncachedClusters);

        const result = await suggestPlacesMutation.mutateAsync({
          clusters: uncachedClusters.map((c, i) => mapClusterToApiPayload(c, visionImages[i])),
        });

        if (__DEV__) {
          console.log('[PhotoImport] API result:', {
            suggestionCount: result.suggestions.length,
            suggestionClusterIds: result.suggestions.map((s) => s.cluster_id),
          });
        }

        // Cache the fresh API results to SQLite
        // Only cache clusters that have a corresponding suggestion in the response.
        // When failed_cluster_count > 0, missing clusters failed transiently —
        // caching [] for them would prevent re-querying on the next attempt.
        const respondedClusterIds = new Set(result.suggestions.map((s) => s.cluster_id));
        const suggestionsToCache = uncachedClusters
          .filter(
            (cluster) => respondedClusterIds.has(cluster.id) || result.failed_cluster_count === 0
          )
          .map((cluster) => {
            const suggestion = result.suggestions.find((s) => s.cluster_id === cluster.id);
            return {
              cluster_id: cluster.id,
              location_key: clusterLocationKey(cluster.centroid),
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

        // Check for stale request before applying API results
        if (isStaleRequest()) {
          if (__DEV__) {
            console.log('[PhotoImport] Discarding stale API results for:', requestCandidateId);
          }
          // Note: We still cached the results above, which is fine - they'll be used
          // if the user switches back to this candidate
          return undefined;
        }

        // Mark candidate as processed
        fetchedCandidatesRef.current.add(candidate.id);

        // Count usage for free users (only count once per session, not per candidate switch)
        if (!isPremium && !hasCountedUsageRef.current) {
          incrementPhotoImportUsage();
          hasCountedUsageRef.current = true;
          if (__DEV__) {
            console.log('[PhotoImport] Incremented photo import usage for free user');
          }
        }

        // Track analytics with cache metrics and API timing
        const failedChunks = suggestPlacesMutation.progress?.failedChunks ?? 0;
        const apiTimes = result.chunkResponseTimes ?? [];
        const percentiles = apiTimes.length > 0 ? calculateApiPercentiles(apiTimes) : null;

        Analytics.photoImportSuggestionsCompleted({
          suggestionCount: result.suggestions.length + cachedResults.length,
          failedChunks,
          cachedClusters: cachedClusterCount,
          uncachedClusters: uncachedClusterCount,
          cacheHitRate,
          apiP50Ms: percentiles?.p50,
          apiP95Ms: percentiles?.p95,
          apiP99Ms: percentiles?.p99,
          totalApiDurationMs: apiTimes.reduce((sum, t) => sum + t, 0),
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

      return undefined;
    },
    [
      suggestPlacesMutation,
      clusterLookupRef,
      isPremium,
      canImportPhotos,
      incrementPhotoImportUsage,
      currentCandidateIdRef,
    ]
  );

  /**
   * Fetch place suggestions for specific clusters (e.g., after manual split).
   * Bypasses candidate-level caching since these are new synthetic clusters.
   *
   * Uses a direct API call instead of the shared mutation to avoid replacing
   * existing suggestion data for other clusters.
   */
  const fetchForClusters = useCallback(async (clusters: LocationCluster[]) => {
    if (clusters.length === 0) return;

    try {
      const visionImages = await prepareVisionImagesBounded(clusters);
      const response = await api.post('/photos/suggest-places', {
        clusters: clusters.map((c, i) => mapClusterToApiPayload(c, visionImages[i])),
      });
      const result = response.data as PlaceSuggestionResponse;

      // Cache results to SQLite — skip clusters missing due to transient failures
      const respondedIds = new Set(result.suggestions.map((s) => s.cluster_id));
      const toCache = clusters
        .filter((cluster) => respondedIds.has(cluster.id) || result.failed_cluster_count === 0)
        .map((cluster) => {
          const suggestion = result.suggestions.find((s) => s.cluster_id === cluster.id);
          return {
            cluster_id: cluster.id,
            location_key: clusterLocationKey(cluster.centroid),
            places: suggestion?.places ?? [],
          };
        });
      await cacheSuggestions(toCache);

      // Add to in-memory cached suggestions for immediate display
      const newSuggestions: ClusterSuggestion[] = result.suggestions.map((s) => ({
        cluster_id: s.cluster_id,
        photo_ids: s.photo_ids,
        places: s.places,
      }));
      setCachedSuggestions((prev) => [...prev, ...newSuggestions]);
    } catch (error) {
      if (__DEV__) console.error('[PhotoImport] fetchForClusters error:', error);

      if (error instanceof AxiosError && error.response?.status === 503) {
        Alert.alert(
          'Service Temporarily Unavailable',
          'The place suggestion service has reached its daily limit. Please try again tomorrow.'
        );
      } else if (error instanceof AxiosError && error.response?.status === 429) {
        const retryAfter = error.response.headers['retry-after'];
        const retrySeconds = retryAfter ? parseInt(retryAfter, 10) : 60;
        Alert.alert(
          'Too Many Requests',
          `Please wait ${isNaN(retrySeconds) ? 60 : retrySeconds} seconds before trying again.`
        );
      } else {
        Alert.alert(
          'Failed to Get Suggestions',
          'Unable to find place suggestions for the split clusters. You can add entries manually.'
        );
      }
    }
  }, []);

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
    fetchForClusters,
    clearFetchedCache,
    fetchedCandidatesRef,
    // Premium gating state
    isPremium,
    canImportPhotos,
  };
}
