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
  SUGGEST_PLACES_TIMEOUT_MS,
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
import { logger } from '@utils/logger';
import { mapClusterToApiPayload } from './photoImportUtils';

const VISION_PREP_CONCURRENCY = 3;

/** Validate that a cached entry has the shape of a PlaceSuggestion. */
function isPlaceSuggestion(item: unknown): item is PlaceSuggestion {
  if (typeof item !== 'object' || item === null) return false;
  const obj = item as Record<string, unknown>;
  return typeof obj.place_id === 'string' && typeof obj.name === 'string';
}

/**
 * Prepare vision images for a set of clusters with bounded concurrency.
 *
 * The worker count is deliberately NOT raised (U5): Expo's async function queue
 * is serial at the native layer, so extra workers deliver no parallelism and
 * would only deepen a queue shared with other native modules (KTD10). The win
 * comes from overlapping preparation with dispatch instead.
 *
 * A cluster whose preparation throws yields an empty image list rather than
 * rejecting — one bad photo must not take its batch down with it.
 */
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
      try {
        results[index] = await getVisionImagesForCluster(clusters[index]);
      } catch (error) {
        if (__DEV__) {
          console.warn('[PhotoImport] Vision preparation failed for cluster', error);
        }
        results[index] = [];
      }
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

  // Clusters currently being retried (U10). Drives the per-cluster spinner on the
  // LookupFailedCard. Set at retry start, cleared at end (success or fail). This
  // is intentionally NOT the global `fetchingSuggestions` flag — that flag gates
  // `useClusterItems` rendering and would re-hide every healthy photos-only /
  // no-place-found card during a retry (KTD7 / C4).
  const [retryingClusterIds, setRetryingClusterIds] = useState<Set<string>>(() => new Set());

  // Own in-flight guard for the retry path (KTD7), distinct from the
  // candidate-stale guard (`currentCandidateIdRef`/`isStaleRequest`). Holds the
  // cluster ids whose retry API call is currently in flight so a double-tap
  // doesn't double-fire and a retry-vs-active-fetch race (I5) can't cause a
  // double `cacheSuggestions` write.
  const retryInFlightRef = useRef<Set<string>>(new Set());

  // ==========================================================================
  // Dispatch owner count (R1 / KTD13)
  // ==========================================================================
  // The "is a suggestion fetch in progress?" signal is a COUNT of concurrent
  // owners, not a boolean. Several independent call sites can start a fetch and
  // two of them can overlap (a manual split or an auto-start alongside the main
  // dispatch). With a plain boolean the first owner to finish flips it false,
  // which fires `useClusterItems`' reconciliation sweep against the other
  // owner's still-in-flight clusters and paints them as `lookup-failed`.
  //
  // "Settled" therefore means ALL owners settled (count back to 0). Every owner
  // MUST claim its slot synchronously before its first await and release it in a
  // `finally` that spans the whole body, including every early return and every
  // thrown path — a stranded owner would permanently withhold terminal rows.
  //
  // NOTE: paused / awaiting-something is NOT settled. An owner that is parked
  // (holding the SQLite cache read open, waiting on vision prep, or waiting on
  // the network) still holds its slot, because the bracket is around the whole
  // body rather than around the network call.
  //
  // The retry path (`retryFailedClusters`) deliberately does NOT take a slot: it
  // is scoped to explicit clusters and drives its own per-cluster spinner via
  // `retryingClusterIds`. Taking a global slot would re-hide every healthy
  // photos-only / no-place-found card during a retry (KTD7 / C4).
  const [fetchOwnerCount, setFetchOwnerCount] = useState(0);

  /** Claim a dispatch owner slot. Always pair with `endFetchOwner` in a finally. */
  const beginFetchOwner = useCallback(() => {
    setFetchOwnerCount((count) => count + 1);
  }, []);

  /** Release a dispatch owner slot. Clamped so a stray release can't go negative. */
  const endFetchOwner = useCallback(() => {
    setFetchOwnerCount((count) => Math.max(0, count - 1));
  }, []);

  /** True while ANY owner has an unsettled suggestion fetch (R1). */
  const isFetchingSuggestions = fetchOwnerCount > 0;

  /**
   * Fetch place suggestions for a candidate.
   * Checks SQLite cache first, only fetching uncached clusters from API.
   *
   * When currentCandidateIdRef is provided, this function checks for stale
   * responses caused by rapid candidate switching. If the candidate ID changes
   * during an async operation, results are discarded to prevent race conditions.
   *
   * Returns undefined on success, or { gatedByPremium: true } if user hit premium limit.
   *
   * The owner bracket lives in the `fetchSuggestions` wrapper below, so EVERY
   * early return here (already processed / no clusters / stale / gatedByPremium /
   * all cached) and every throw still reports settled exactly once.
   */
  const runFetchSuggestions = useCallback(
    async (candidate: TripCandidateDisplay): Promise<{ gatedByPremium: true } | undefined> => {
      // Capture the candidate ID at the start to detect stale responses
      const requestCandidateId = candidate.id;

      // U15/R18. Wall clock starts HERE, before the cache read and vision
      // preparation, because that dead time is exactly what U5 sets out to
      // remove — measuring from the first network call would hide the win.
      const fetchStartedAt = Date.now();

      // Helper to check if this request is still valid (user hasn't switched candidates).
      //
      // B3 (investigation): the discard decision compares the LIVE ref value
      // (`currentCandidateIdRef.current`, re-read on every call) against the
      // candidate id captured at request start (`requestCandidateId`). It does NOT
      // capture the ref's value in the closure. This is the correct behavior the
      // plan pins: if the user switches AWAY and BACK to the same candidate while
      // a fetch is in flight, the live ref equals `requestCandidateId` again at
      // resolution, so the in-flight result is KEPT (recovers) rather than
      // discarded — clusters don't end up empty until a manual re-entry. A result
      // is discarded ONLY when the active candidate genuinely differs at
      // resolution time. The retry path's race guard (`retryInFlightRef`) is
      // independent of this candidate-stale guard, so the two don't conflict (U10).
      // See usePlaceSuggestions.test.tsx "B3 stale-request guard (live ref)".
      const isStaleRequest = () => {
        if (!currentCandidateIdRef) return false;
        return currentCandidateIdRef.current !== requestCandidateId;
      };

      // Skip if we've already processed this candidate in this session
      if (fetchedCandidatesRef.current.has(candidate.id)) {
        if (__DEV__) {
          logger.log('[PhotoImport] Skipping fetch - already processed:', candidate.id);
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
          logger.log('[PhotoImport] No clusters found for candidate:', candidate.id);
        }
        fetchedCandidatesRef.current.add(candidate.id);
        return undefined;
      }

      // Check SQLite cache for existing suggestions. Pass the location key so a
      // re-segmented/split cluster reuses a prior result for the same physical
      // spot (via the location_key fallback) instead of re-buying it. Pass the
      // raw centroid too so the Tier-3 neighbor-cell fallback (B2/KTD9) can pick
      // the nearest cached entry when a re-import drifts the centroid across a
      // geohash-7 cell boundary.
      const cachedSuggestionsMap = await getCachedSuggestions(
        allClusters.map((c) => ({
          id: c.id,
          locationKey: clusterLocationKey(c.centroid),
          centroid: c.centroid,
        }))
      );

      // Separate cached and uncached clusters
      const cachedClusterIds = new Set(cachedSuggestionsMap.keys());
      const uncachedClusters = allClusters.filter((c) => !cachedClusterIds.has(c.id));

      if (__DEV__) {
        logger.log('[PhotoImport] Cache check:', {
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
          logger.log('[PhotoImport] Discarding stale cached results for:', requestCandidateId);
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
          logger.log('[PhotoImport] Premium gate: User has used free photo trip import');
        }
        // Mark candidate as processed to prevent re-fetching
        fetchedCandidatesRef.current.add(candidate.id);
        // Return special marker that caller can check to show paywall
        return { gatedByPremium: true };
      }

      // If all clusters are cached, we're done - no API call needed
      if (uncachedClusters.length === 0) {
        if (__DEV__) {
          logger.log('[PhotoImport] All clusters cached - no API call needed');
        }
        // Reset mutation state and mark as fetched (only if still current)
        if (!isStaleRequest()) {
          suggestPlacesMutation.reset();
          fetchedCandidatesRef.current.add(candidate.id);

          // Track analytics for cache hits (100% cache hit rate, no API times)
          // U15: the all-cached path still reports timings. It is the fastest
          // possible run, so it anchors the low end of the measurement range
          // and makes a latency number interpretable against its cache
          // composition (a 100% hit rate here).
          Analytics.photoImportSuggestionsCompleted({
            suggestionCount: cachedResults.length,
            failedChunks: 0,
            cachedClusters: cachedClusterCount,
            uncachedClusters: 0,
            cacheHitRate: 100,
            timeToFirstSuggestionMs: Date.now() - fetchStartedAt,
            wallClockMs: Date.now() - fetchStartedAt,
          });
        }
        return undefined;
      }

      // Fetch uncached clusters from API
      if (__DEV__) {
        logger.log('[PhotoImport] Fetching uncached clusters from API:', {
          candidateId: candidate.id,
          clusterIds: uncachedClusters.map((c) => c.id),
          clusterCount: uncachedClusters.length,
        });
      }

      try {
        // U5/R5. Preparation is PER BATCH, not up front. The mutation dispatches
        // batch one while batch two is still being encoded; previously every
        // uncached cluster was prepared before the first request went out, which
        // on a large trip is minutes of zero network. `mapClusterToApiPayload`
        // with no images builds the cheap skeleton (ids, centroid, photo
        // coordinates); `prepareBatch` attaches the expensive base64 vision
        // images to just the batch about to be dispatched.
        const clustersById = new Map(uncachedClusters.map((c) => [c.id, c]));

        const result = await suggestPlacesMutation.mutateAsync({
          clusters: uncachedClusters.map((c) => mapClusterToApiPayload(c, [])),
          prepareBatch: async (batch) => {
            const batchClusters = batch
              .map((payload) => clustersById.get(payload.id))
              .filter((c): c is LocationCluster => c !== undefined);
            const visionImages = await prepareVisionImagesBounded(batchClusters);
            const imagesByClusterId = new Map(
              batchClusters.map((c, i) => [c.id, visionImages[i] ?? []])
            );
            return batch.map((payload) => {
              const images = imagesByClusterId.get(payload.id);
              return images && images.length > 0
                ? { ...payload, vision_images_base64: images }
                : payload;
            });
          },
        });

        if (__DEV__) {
          logger.log('[PhotoImport] API result:', {
            suggestionCount: result.suggestions.length,
            suggestionClusterIds: result.suggestions.map((s) => s.cluster_id),
          });
        }

        // Cache the fresh API results to SQLite
        // Only cache clusters that have a corresponding suggestion in the response.
        // When failed_cluster_count > 0, missing clusters failed transiently —
        // caching [] for them would prevent re-querying on the next attempt.
        // Additionally exclude any cluster whose CHUNK failed (failedClusterIds):
        // the failed_cluster_count guard only covers per-cluster timeouts, so a
        // failed chunk's clusters would otherwise be cached as [] for 24h (KTD8).
        const respondedClusterIds = new Set(result.suggestions.map((s) => s.cluster_id));
        // Read the failed ids from the resolved result (fresh, synchronous) — the
        // mutation's `failedClusterIds` state is captured stale in this closure
        // because it is set during the awaited mutateAsync we just resolved.
        const failedClusterIds = result.failedClusterIds;
        const suggestionsToCache = uncachedClusters
          .filter(
            (cluster) =>
              !failedClusterIds.has(cluster.id) &&
              (respondedClusterIds.has(cluster.id) || result.failed_cluster_count === 0)
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
          logger.log('[PhotoImport] Cached suggestions to SQLite:', {
            cachedCount: suggestionsToCache.length,
            withPlaces: suggestionsToCache.filter((s) => s.places.length > 0).length,
            empty: suggestionsToCache.filter((s) => s.places.length === 0).length,
          });
        }

        // Check for stale request before applying API results
        if (isStaleRequest()) {
          if (__DEV__) {
            logger.log('[PhotoImport] Discarding stale API results for:', requestCandidateId);
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
            logger.log('[PhotoImport] Incremented photo import usage for free user');
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
          // U15/R18. `firstSuggestionAt` is stamped inside the chunked mutation
          // the instant a batch carrying a suggestion lands, so this stays
          // honest once U6 makes batches overlap. Null when no batch carried
          // one — an all-empty result has no "first suggestion" to time.
          timeToFirstSuggestionMs:
            result.firstSuggestionAt !== null ? result.firstSuggestionAt - fetchStartedAt : null,
          wallClockMs: Date.now() - fetchStartedAt,
        });
      } catch (error) {
        if (__DEV__) console.error('[PhotoImport] Suggestion error:', error);

        // M1: no Alert here. The chunked mutation records every un-responded
        // cluster into `failedClusterIds` (KTD6/KTD10) before a fatal 429/503
        // re-throws, and non-fatal chunk failures populate it too — so
        // `useClusterItems` already surfaces each failure as a `lookup-failed`
        // card (with a Retry affordance, or the time-gated message for 429/503).
        // An Alert on top would double-surface the same failure. Keep the
        // per-error-type analytics; drop the modal.
        if (error instanceof QuotaExhaustedError) {
          Analytics.photoImportApiError({ errorType: 'quota_exhausted' });
        } else if (error instanceof RateLimitError) {
          Analytics.photoImportApiError({ errorType: 'rate_limited' });
        } else {
          Analytics.photoImportApiError({ errorType: 'unknown' });
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
   * Public entry point: claims a dispatch owner slot for the WHOLE duration of
   * the fetch — synchronously, BEFORE the SQLite cache read and vision prep, not
   * when the network call starts — and releases it exactly once in `finally`.
   *
   * The mutation's own `isPending` is deliberately NOT the signal: it is false
   * across the entire pre-dispatch window (cache read + vision prep), which is
   * where a large import spends its first seconds, and false again on every
   * early return that never dispatches at all (R1).
   *
   * U5 pipelines preparation with dispatch INSIDE this bracket: the single
   * `mutateAsync` await spans every batch, so the owner slot stays claimed while
   * later batches are still being prepared and is released only once all of it
   * has settled. Interleaving preparation and dispatch must never move work
   * outside this `try`.
   */
  const fetchSuggestions = useCallback(
    async (candidate: TripCandidateDisplay): Promise<{ gatedByPremium: true } | undefined> => {
      beginFetchOwner();
      try {
        return await runFetchSuggestions(candidate);
      } finally {
        endFetchOwner();
      }
    },
    [runFetchSuggestions, beginFetchOwner, endFetchOwner]
  );

  /**
   * Fetch place suggestions for specific clusters (e.g., after manual split).
   * Bypasses candidate-level caching since these are new synthetic clusters.
   *
   * Uses a direct API call instead of the shared mutation to avoid replacing
   * existing suggestion data for other clusters.
   *
   * Owns a dispatch slot for its whole duration (R1/KTD13) so a split that
   * overlaps the main dispatch cannot make the main dispatch look settled, and
   * so its own pre-dispatch vision prep is reported as in progress.
   *
   * Candidate-stale guard: the split's sub-clusters belong to the candidate that
   * was active when the split happened. If the user switches candidates while
   * this call is in flight, appending the result would inject the OLD
   * candidate's sub-clusters into the NEW candidate's suggestions (switching
   * resets `cachedSuggestions`). The SQLite cache write still happens — it is
   * location-keyed and useful when the user returns.
   */
  const fetchForClusters = useCallback(
    async (clusters: LocationCluster[]) => {
      if (clusters.length === 0) return;

      const requestCandidateId = currentCandidateIdRef?.current ?? null;
      const isStaleRequest = () =>
        currentCandidateIdRef != null && currentCandidateIdRef.current !== requestCandidateId;

      beginFetchOwner();
      try {
        const visionImages = await prepareVisionImagesBounded(clusters);
        const response = await api.post(
          '/photos/suggest-places',
          {
            clusters: clusters.map((c, i) => mapClusterToApiPayload(c, visionImages[i])),
          },
          { timeout: SUGGEST_PLACES_TIMEOUT_MS }
        );
        const result = response.data as PlaceSuggestionResponse;

        // Cache results to SQLite — skip clusters missing due to transient failures.
        // Unlike fetchSuggestions there is no chunk concept here (a single raw
        // api.post), so the only lookup-failure signals are (a) a thrown error for
        // the whole call — handled by the catch below, which caches nothing — and
        // (b) failed_cluster_count for per-cluster timeouts, excluded here. A
        // transiently-failed split cluster must never be written as [] (KTD8/B1).
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

        // Candidate-stale guard: never append the old candidate's split
        // sub-clusters into the candidate the user switched to.
        if (isStaleRequest()) {
          if (__DEV__) {
            logger.log('[PhotoImport] Discarding stale split results for:', requestCandidateId);
          }
          return;
        }

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
      } finally {
        endFetchOwner();
      }
    },
    [currentCandidateIdRef, beginFetchOwner, endFetchOwner]
  );

  /**
   * Retry the place lookup for an EXPLICIT list of previously-failed clusters
   * (U10 / KTD7, KTD8, KTD10, M1). Modeled on `fetchForClusters` (raw api.post,
   * bypasses candidate-level caching), but:
   *
   *  - Scope: re-fetches ONLY the passed ids — chunk-1 successes are never
   *    re-requested. ids are resolved to LocationClusters via `clusterLookupRef`.
   *  - Cache discipline (KTD7): bypasses the candidate-level cache
   *    (`fetchedCandidatesRef`) so the cluster actually re-fetches, but still
   *    respects the SQLite cache via `getCachedSuggestions` (a cluster that DID
   *    get cached isn't re-bought). U8 excluded failed clusters from the SQLite
   *    cache, so they normally miss and re-fetch — which is correct.
   *  - retryDisabled no-op (KTD10): clusters whose failure is `retryDisabled`
   *    (429/503) are filtered out BEFORE fetching — no API call fires for them.
   *  - Own in-flight guard (KTD7): `retryInFlightRef` prevents a double-tap from
   *    double-firing and a retry-vs-active-fetch race (I5) from double-caching.
   *    Separate from the candidate-stale guard below.
   *  - Candidate-stale guard: if the user switches candidates while a retry is in
   *    flight, the resolved result must NOT write the old cluster's state into the
   *    new candidate (switchCandidate resets failedClusterIds/cachedSuggestions).
   *    The in-memory writes (setCachedSuggestions / clear/addFailedClusterIds) are
   *    short-circuited when the active candidate changed; the SQLite cache write
   *    still happens (it's location-keyed and useful if the user returns).
   *  - Per-cluster retrying state: `retryingClusterIds` drives the card spinner.
   *  - Partial results: of the retried set, succeeded clusters are cached +
   *    cleared from `failedClusterIds` (-> matched / no-place-found); clusters
   *    that fail again are re-added to `failedClusterIds` (-> stay lookup-failed,
   *    retry again allowed — no cap). Other clusters' failure state is untouched.
   *  - No Alert (M1): the lookup-failed card already surfaces the failure; an
   *    Alert on top would double-surface, so the retry path shows none.
   */
  const retryFailedClusters = useCallback(
    async (clusterIds: string[]) => {
      if (clusterIds.length === 0) return;

      const currentClusterLookup = clusterLookupRef.current;
      const failedInfo = suggestPlacesMutation.failedClusterIds ?? new Map();

      // Candidate-stale guard: capture the active candidate at entry and compare
      // against the LIVE ref at each resolution point. If the user switched
      // candidates mid-retry, the new candidate's state was reset — writing the
      // old cluster's result into it would re-introduce stale failure/cache
      // entries. Reads `.current` live (not a captured value) so a switch-away-
      // then-back to the same candidate is correctly treated as NOT stale.
      const retryCandidateId = currentCandidateIdRef?.current ?? null;
      const isStaleRetry = () =>
        currentCandidateIdRef != null && currentCandidateIdRef.current !== retryCandidateId;

      // Resolve ids -> clusters, skipping: (a) ids already retrying (own
      // in-flight guard, KTD7), (b) retryDisabled (429/503) failures (KTD10), and
      // (c) ids that don't resolve to a known cluster. The guard check + claim
      // happens SYNCHRONOUSLY here (before any await) so a double-tap / a
      // retry-vs-retry race (I5) can't slip two calls past the check and
      // double-fire / double-cache.
      const toRetry: LocationCluster[] = [];
      for (const id of clusterIds) {
        if (retryInFlightRef.current.has(id)) continue;
        if (failedInfo.get(id)?.retryDisabled) continue;
        const cluster = getFullCluster(id, currentClusterLookup);
        if (cluster) toRetry.push(cluster);
      }

      if (toRetry.length === 0) return;

      // Claim the ids synchronously (in-flight guard) + flag as retrying
      // (spinner) before any await. The `finally` releases them.
      const claimedIds = toRetry.map((c) => c.id);
      for (const id of claimedIds) retryInFlightRef.current.add(id);
      setRetryingClusterIds((prev) => {
        const next = new Set(prev);
        for (const id of claimedIds) next.add(id);
        return next;
      });

      // Ids not yet resolved. As clusters resolve (cache hit or API success)
      // they're removed; on a thrown error only the still-pending ids are
      // re-asserted as lookup-failed, so an already-resolved cache hit isn't
      // wrongly re-failed by a later api.post throw.
      const pendingIds = new Set(claimedIds);

      try {
        // Respect the SQLite cache — a cluster that already got cached (e.g. a
        // chunk-1 success the caller also passed) is reused, not re-bought. Pass
        // the centroid so the Tier-3 neighbor-cell fallback (B2/KTD9) can resolve
        // a boundary-drifted re-import.
        const cachedMap = await getCachedSuggestions(
          toRetry.map((c) => ({
            id: c.id,
            locationKey: clusterLocationKey(c.centroid),
            centroid: c.centroid,
          }))
        );

        const cachedHits: ClusterSuggestion[] = [];
        const uncached: LocationCluster[] = [];
        for (const cluster of toRetry) {
          const cached = cachedMap.get(cluster.id);
          if (cached !== undefined) {
            const validPlaces = cached.filter(isPlaceSuggestion);
            cachedHits.push({
              cluster_id: cluster.id,
              photo_ids: cluster.photos.map((p) => p.id),
              places: validPlaces,
            });
          } else {
            uncached.push(cluster);
          }
        }

        // A cache hit means the cluster already resolved — surface it and clear
        // it from the failed set without an API call. Skip the in-memory writes
        // if the user switched candidates (the cache hit is harmless to drop;
        // the SQLite row already exists for a later return).
        if (cachedHits.length > 0 && !isStaleRetry()) {
          setCachedSuggestions((prev) => [...prev, ...cachedHits]);
          suggestPlacesMutation.clearFailedClusterIds(cachedHits.map((s) => s.cluster_id));
          for (const s of cachedHits) pendingIds.delete(s.cluster_id);
        }

        if (uncached.length === 0) return;

        const visionImages = await prepareVisionImagesBounded(uncached);
        const response = await api.post(
          '/photos/suggest-places',
          {
            clusters: uncached.map((c, i) => mapClusterToApiPayload(c, visionImages[i])),
          },
          { timeout: SUGGEST_PLACES_TIMEOUT_MS }
        );
        const result = response.data as PlaceSuggestionResponse;

        const respondedIds = new Set(result.suggestions.map((s) => s.cluster_id));

        // Per-cluster partition: succeeded (responded) vs re-failed (no
        // response — e.g. a per-cluster timeout in failed_cluster_count).
        const succeeded: LocationCluster[] = [];
        const reFailed: LocationCluster[] = [];
        for (const cluster of uncached) {
          if (respondedIds.has(cluster.id)) {
            succeeded.push(cluster);
          } else {
            reFailed.push(cluster);
          }
        }

        // Cache + surface succeeded clusters (KTD8: only responded ones written).
        // The SQLite cache write always happens (location-keyed, useful on
        // return); the in-memory state writes are skipped when the candidate
        // changed so we never strand the old cluster's state into the new one.
        if (succeeded.length > 0) {
          const toCache = succeeded.map((cluster) => {
            const suggestion = result.suggestions.find((s) => s.cluster_id === cluster.id);
            return {
              cluster_id: cluster.id,
              location_key: clusterLocationKey(cluster.centroid),
              places: suggestion?.places ?? [],
            };
          });
          await cacheSuggestions(toCache);

          if (!isStaleRetry()) {
            const newSuggestions: ClusterSuggestion[] = succeeded.map((cluster) => {
              const suggestion = result.suggestions.find((s) => s.cluster_id === cluster.id);
              return {
                cluster_id: cluster.id,
                photo_ids: cluster.photos.map((p) => p.id),
                places: suggestion?.places ?? [],
              };
            });
            setCachedSuggestions((prev) => [...prev, ...newSuggestions]);

            // Resolved -> remove from failedClusterIds so useClusterItems
            // reclassifies them as matched / no-place-found.
            suggestPlacesMutation.clearFailedClusterIds(succeeded.map((c) => c.id));
            for (const c of succeeded) pendingIds.delete(c.id);
          }
        }

        // Re-failed clusters stay lookup-failed (retry still enabled, no cap) —
        // but not if the candidate changed (don't pollute the new candidate).
        if (reFailed.length > 0 && !isStaleRetry()) {
          suggestPlacesMutation.addFailedClusterIds(
            reFailed.map((c) => ({ id: c.id, retryDisabled: false }))
          );
        }
      } catch (error) {
        // M1: no Alert here — the lookup-failed card already surfaces the
        // failure. Re-assert only the STILL-PENDING ids as lookup-failed (retry
        // enabled, no cap) so the card stays/returns to lookup-failed. Already-
        // resolved cache hits are excluded (they left `pendingIds`), so a later
        // api.post throw can't wrongly re-fail a resolved cluster.
        if (__DEV__) console.error('[PhotoImport] retryFailedClusters error:', error);
        if (pendingIds.size > 0 && !isStaleRetry()) {
          suggestPlacesMutation.addFailedClusterIds(
            [...pendingIds].map((id) => ({ id, retryDisabled: false }))
          );
        }
      } finally {
        // Release the in-flight + retrying state for these ids. (Always release,
        // even on a stale retry — the spinner/guard for the claimed ids must
        // clear regardless of whether the candidate changed.)
        for (const id of claimedIds) retryInFlightRef.current.delete(id);
        setRetryingClusterIds((prev) => {
          const next = new Set(prev);
          for (const id of claimedIds) next.delete(id);
          return next;
        });
      }
    },
    [clusterLookupRef, suggestPlacesMutation, currentCandidateIdRef]
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
    fetchForClusters,
    retryFailedClusters,
    retryingClusterIds,
    clearFetchedCache,
    fetchedCandidatesRef,
    // Dispatch owner state (R1/KTD13): true while ANY owner is unsettled.
    isFetchingSuggestions,
    beginFetchOwner,
    endFetchOwner,
    // Premium gating state
    isPremium,
    canImportPhotos,
  };
}
