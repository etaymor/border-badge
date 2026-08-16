/**
 * usePlaceSuggestions - Hook for fetching place suggestions from the API.
 *
 * Handles chunked API calls, persistent SQLite caching, and error handling.
 * Checks SQLite cache before API calls to minimize Google Places API costs.
 *
 * Premium gating: Free users get 1 photo trip import. The usage is counted
 * when successfully fetching suggestions that require API calls.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { AxiosError } from 'axios';
import { useQueryClient } from '@tanstack/react-query';

import { useSuggestionDispatch } from '@hooks/usePhotoImport';
import {
  suggestionDispatch,
  RateLimitError,
  QuotaExhaustedError,
  PhotoImportLimitReachedError,
  MAX_PARKABLE_RETRY_AFTER_SECONDS,
  parseRetryAfterSeconds,
  readErrorCode,
  type ChunkedPlaceSuggestionResult,
  type PlaceSuggestionCluster,
} from '@services/photoImport/suggestionDispatch';
import {
  getFullCluster,
  getCachedSuggestions,
  cacheSuggestions,
  clusterLocationKey,
  type CachedPlaceSuggestion,
  type TripCandidateDisplay,
  type LocationCluster,
  type ClusterSuggestion,
  type PlaceSuggestion,
} from '@services/photoImport';
import { getVisionImagesForCluster } from '@services/photoImport/visionPhoto';
import {
  claimPhotoImportForTrip,
  ensurePhotoImportGrandfatherPass,
  hasDisclosedFreeImport,
  isPhotoImportExempt,
  markFreeImportDisclosed,
  noteServerRefusedPhotoImport,
} from '@services/photoImport/photoImportEntitlement';
import { Analytics, calculateApiPercentiles } from '@services/analytics';
import { useIsPremium, useCanImportPhotos } from '@stores/subscriptionStore';
import { logger } from '@utils/logger';
import { mapClusterToApiPayload } from './photoImportUtils';

const VISION_PREP_CONCURRENCY = 3;

/**
 * The one-time free-import confirmation (U10/KTD18).
 *
 * Counting on the first successful batch means a free user can spend their one
 * lifetime import by merely opening a trip, so the charge is named — with the
 * trip in it — before anything is dispatched, instead of being reported
 * afterwards in the past tense. Declining dispatches nothing and charges
 * nothing, and the user is asked again next time.
 */
function confirmFreeImport(tripName: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (accepted: boolean) => {
      if (settled) return;
      settled = true;
      resolve(accepted);
    };
    Alert.alert(
      'Use your free photo import?',
      `Finding places for "${tripName}" uses the one free photo import included with your account. ` +
        'You can come back to this trip and finish it later at no extra cost.',
      [
        { text: 'Not Now', style: 'cancel', onPress: () => finish(false) },
        { text: 'Continue', onPress: () => finish(true) },
      ],
      { cancelable: true, onDismiss: () => finish(false) }
    );
  });
}

/** Validate that a cached entry has the shape of a PlaceSuggestion. */
function isPlaceSuggestion(item: unknown): item is PlaceSuggestion {
  if (typeof item !== 'object' || item === null) return false;
  const obj = item as Record<string, unknown>;
  return typeof obj.place_id === 'string' && typeof obj.name === 'string';
}

/**
 * Read the SQLite suggestion cache for a set of clusters.
 *
 * The location key lets a re-segmented / split cluster reuse a prior result for
 * the same physical spot instead of re-buying it, and the raw centroid lets the
 * Tier-3 neighbor-cell fallback (B2/KTD9) pick the nearest cached entry when a
 * re-import drifts the centroid across a geohash-7 cell boundary. Both are
 * passed from every read site, so the fallbacks cannot go missing on one path.
 */
function readCachedSuggestions(
  clusters: LocationCluster[]
): Promise<Map<string, CachedPlaceSuggestion['places']>> {
  return getCachedSuggestions(
    clusters.map((cluster) => ({
      id: cluster.id,
      locationKey: clusterLocationKey(cluster.centroid),
      centroid: cluster.centroid,
    }))
  );
}

/**
 * Shape a SQLite cache hit as a `ClusterSuggestion` for the list. Places are
 * re-validated on the way out because the cache is JSON on disk: a row written
 * by an older shape must not reach the UI as a half-place.
 */
function cachedClusterSuggestion(
  cluster: LocationCluster,
  cachedPlaces: unknown[]
): ClusterSuggestion {
  return {
    cluster_id: cluster.id,
    photo_ids: cluster.photos.map((p) => p.id),
    places: cachedPlaces.filter(isPlaceSuggestion),
  };
}

/**
 * Index a response's suggestions by cluster id, FIRST occurrence winning —
 * identical to the `suggestions.find(...)` scans this replaced, without their
 * quadratic cost on a large trip.
 */
function suggestionsByClusterId(suggestions: ClusterSuggestion[]): Map<string, ClusterSuggestion> {
  const byId = new Map<string, ClusterSuggestion>();
  for (const suggestion of suggestions) {
    if (!byId.has(suggestion.cluster_id)) byId.set(suggestion.cluster_id, suggestion);
  }
  return byId;
}

/**
 * Build SQLite cache rows for `clusters`. A cluster the response carried no row
 * for caches as an empty place list, so callers MUST have excluded anything
 * without positive evidence of a response before calling this.
 */
function toCacheRows(
  clusters: LocationCluster[],
  suggestionsById: Map<string, ClusterSuggestion>
): CachedPlaceSuggestion[] {
  return clusters.map((cluster) => ({
    cluster_id: cluster.id,
    location_key: clusterLocationKey(cluster.centroid),
    places: suggestionsById.get(cluster.id)?.places ?? [],
  }));
}

/**
 * Cache rows for a chunked dispatch result — the shared ALLOW-LIST (R20/KTD14).
 *
 * Every term is positive evidence about THAT cluster, and all three are
 * required:
 *
 *  1. `dispatchedAndResolvedIds` — the controller saw a response for the batch
 *     carrying it. A cluster in a batch that threw, or in a batch a fatal stop
 *     or an abort kept off the wire entirely, is absent.
 *  2. not in `failedClusterIds` — its batch was not attributed a failure.
 *  3. the response carried a row for it specifically, so an empty `places` list
 *     means "looked, found nothing" rather than "never answered".
 *
 * The old third term had an escape hatch — `|| failed_cluster_count === 0` —
 * that admitted EVERY uncached cluster whenever the run happened to report no
 * per-cluster failures. That was a proxy for full coverage, and both
 * concurrency and partial resolution invalidate it: a run stopped by a 429 can
 * easily have a zero failure count while whole batches never went out, and
 * those clusters would have been written as `[]` and cached for 24h —
 * indistinguishable from a genuine no-place-found (KTD8).
 *
 * `failedClusterIds` is read from the RESOLVED RESULT (fresh, synchronous),
 * never from React state, which is a render behind. On a retry result it is the
 * MERGED map, which is why the caller restricts `clusters` to the set it
 * dispatched: other clusters' failures stay out of the decision.
 */
function cacheRowsForDispatch(
  clusters: LocationCluster[],
  result: ChunkedPlaceSuggestionResult
): CachedPlaceSuggestion[] {
  const suggestionsById = suggestionsByClusterId(result.suggestions);
  const allowed = clusters.filter(
    (cluster) =>
      result.dispatchedAndResolvedIds.has(cluster.id) &&
      !result.failedClusterIds.has(cluster.id) &&
      suggestionsById.has(cluster.id)
  );
  return toCacheRows(allowed, suggestionsById);
}

/**
 * Report the rejection that STOPPED a chunked dispatch (KTD6).
 *
 * The fatal rejection is carried on the RESULT rather than thrown, so the
 * per-error-type analytics branch lives outside the `catch`. The 402
 * entitlement stop gets its OWN type rather than sharing `unknown` with genuine
 * faults (U11): it is a product outcome with a paywall follow-up, so burying it
 * in the bug bucket both inflates the error rate and hides the funnel step.
 *
 * The 402 also revokes the trip's local exemption. The R17 exemption is bounded
 * by a cluster allowance now, so a trip the client called exempt can stop being
 * so mid-import; without recording the refusal every later gate would keep
 * answering "exempt" and keep dispatching into the same rejection.
 */
function reportDispatchFatalError(fatalError: Error | null, tripId: string | null): void {
  if (fatalError === null) return;
  if (fatalError instanceof QuotaExhaustedError) {
    Analytics.photoImportApiError({ errorType: 'quota_exhausted' });
  } else if (fatalError instanceof RateLimitError) {
    Analytics.photoImportApiError({ errorType: 'rate_limited' });
  } else if (fatalError instanceof PhotoImportLimitReachedError) {
    noteServerRefusedPhotoImport(tripId);
    Analytics.photoImportApiError({ errorType: 'entitlement_exhausted' });
  } else {
    Analytics.photoImportApiError({ errorType: 'unknown' });
  }
}

/**
 * The status -> `retryDisabled` classification, in ONE place (KTD10).
 *
 * `retryDisabled` exists so the user is never handed a Retry button that can
 * only ever fail. The chunked dispatch path has always made this distinction;
 * the scoped single-batch paths used to hard-code `false`, so with Google's
 * daily quota exhausted a cluster that failed in the main dispatch was correctly
 * retry-disabled while the cluster next to it — identical failure, different
 * code path — kept an enabled Retry button and an enabled "Retry All" entry.
 * Every tap then bought a request that could not succeed.
 *
 * The four disabling cases mirror the dispatch path exactly:
 *
 *  - 503 WITH `Retry-After`: the Google daily quota. A header-less 503 is a
 *    transient backend condition (slot starvation, pool exhaustion, a failed
 *    entitlement read) and stays retryable.
 *  - 429 asking for longer than the pool will park on: the sustained limit. A
 *    short `Retry-After` is a burst throttle and is dispatchable again seconds
 *    later, so it stays retryable.
 *  - 402 `PHOTO_IMPORT_LIMIT_REACHED`: the entitlement stop.
 *  - 403 `PHOTO_IMPORT_TRIP_NOT_FOUND`: a non-premium caller naming a trip the
 *    server will not accept. Retrying re-sends the same trip id.
 *
 * The 402/403 bodies are the FastAPI envelope (`{"detail": {"code": ...}}`), so
 * the code is read through the dispatch module's own `readErrorCode`, which
 * accepts that shape and the flat one — reimplementing it is how the branch
 * became dead in production last time.
 */
function isRetryDisablingError(error: unknown): boolean {
  if (!(error instanceof AxiosError)) return false;
  const status = error.response?.status;
  if (status === 503) return Boolean(error.response?.headers['retry-after']);
  if (status === 429) {
    return (
      parseRetryAfterSeconds(error.response?.headers['retry-after']) >
      MAX_PARKABLE_RETRY_AFTER_SECONDS
    );
  }
  if (status === 402) return readErrorCode(error) === 'PHOTO_IMPORT_LIMIT_REACHED';
  if (status === 403) return readErrorCode(error) === 'PHOTO_IMPORT_TRIP_NOT_FOUND';
  return false;
}

/** True for the 402 entitlement stop specifically (the paywall follow-up). */
function isEntitlementStop(error: unknown): boolean {
  return (
    error instanceof AxiosError &&
    error.response?.status === 402 &&
    readErrorCode(error) === 'PHOTO_IMPORT_LIMIT_REACHED'
  );
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

/**
 * Build the controller's per-batch `prepareBatch` callback (U5/R5).
 *
 * Shared by the main dispatch and the U9 bulk retry so the two cannot drift:
 * both send the cheap skeleton up front and attach the expensive base64 vision
 * images to only the batch about to leave.
 *
 * `onFirstBatchPrepared` fires once, when the FIRST batch is fully encoded —
 * i.e. the moment the run stops being pure on-device work and a request can
 * actually go out. A bulk retry uses it to stop saying "Preparing", because a
 * released payload has to be rebuilt and preparation is serial at the native
 * layer, so a large retry spends real time before anything hits the network.
 */
function createVisionPrepareBatch(
  clustersById: Map<string, LocationCluster>,
  onFirstBatchPrepared?: () => void
): (batch: PlaceSuggestionCluster[]) => Promise<PlaceSuggestionCluster[]> {
  let announced = false;
  return async (batch) => {
    const batchClusters = batch
      .map((payload) => clustersById.get(payload.id))
      .filter((c): c is LocationCluster => c !== undefined);
    const visionImages = await prepareVisionImagesBounded(batchClusters);
    const imagesByClusterId = new Map(batchClusters.map((c, i) => [c.id, visionImages[i] ?? []]));
    const prepared = batch.map((payload) => {
      const images = imagesByClusterId.get(payload.id);
      return images && images.length > 0 ? { ...payload, vision_images_base64: images } : payload;
    });
    if (!announced) {
      announced = true;
      onFirstBatchPrepared?.();
    }
    return prepared;
  };
}

/**
 * Build the `prepare` callback for a SCOPED single-batch dispatch (manual split
 * and per-row retry).
 *
 * These paths hand the controller one already-claimed batch, so there is
 * nothing to pipeline: every cluster's vision images are encoded in the one
 * pass. The chunked paths use `createVisionPrepareBatch` instead, which
 * attaches images to each batch as the pool reaches it.
 */
function createVisionPrepare(clusters: LocationCluster[]): () => Promise<PlaceSuggestionCluster[]> {
  return async () => {
    const visionImages = await prepareVisionImagesBounded(clusters);
    return clusters.map((cluster, index) => mapClusterToApiPayload(cluster, visionImages[index]));
  };
}

export interface UsePlaceSuggestionsOptions {
  clusterLookupRef: React.RefObject<Map<string, LocationCluster>>;
  /** Ref tracking current candidate ID to detect stale responses during rapid switching */
  currentCandidateIdRef?: React.RefObject<string | null>;
  /**
   * The destination trip currently being matched (U10/R17).
   *
   * Two jobs: it goes into every `/photos/suggest-places` body so the server can
   * honor the R17 exemption, and it is the key the exemption itself is looked up
   * by. Supplied as a VALUE (not a ref) because the free-limit banner has to
   * re-render when the exemption resolves; the fetch paths take the trip id as
   * an argument instead, since `selectTrip` sets it in the same tick it fetches.
   */
  selectedTripId?: string | null;
  /**
   * Show the paywall (U10). Optional because this hook has no navigator of its
   * own; when it is absent the 402 is still named honestly in an Alert instead
   * of being reported as a generic failure.
   *
   * Only the SCOPED single-batch path needs it. The chunked fetch reports a gate
   * by returning `{ gatedByPremium: true }` to `useWorkflowNavigation`, which
   * owns the paywall; `fetchForClusters` is fired from a UI callback whose
   * caller discards the return value, so it needs somewhere to hand the outcome.
   */
  onPremiumGate?: (context: string) => void;
}

export function usePlaceSuggestions({
  clusterLookupRef,
  currentCandidateIdRef,
  selectedTripId = null,
  onPremiumGate,
}: UsePlaceSuggestionsOptions) {
  // Live snapshot of the dispatch controller (KTD21). The controller is a
  // module-level singleton, so this hook only READS its state — chunking,
  // claiming, abort, progress, and failure attribution are its business, while
  // cache discipline, entitlement, analytics, and candidate-stale guarding
  // stay here (KTD15).
  const dispatchState = useSuggestionDispatch();

  // Premium subscription state
  const isPremium = useIsPremium();
  const canImportPhotos = useCanImportPhotos();
  const queryClient = useQueryClient();

  // The trip every dispatch on this screen belongs to (U10/R17). Kept in a ref
  // as well as a prop because the retry and manual-split paths fire from UI
  // callbacks long after the fetch that established it, and they must send the
  // same `trip_id`. Written in an EFFECT (never during render) per the React
  // Compiler rule, and written again — explicitly — at the top of
  // `fetchSuggestions`, because `selectTrip` sets the trip and fetches in the
  // same tick, before any effect has run.
  const activeTripIdRef = useRef<string | null>(selectedTripId);
  useEffect(() => {
    if (selectedTripId) activeTripIdRef.current = selectedTripId;
  }, [selectedTripId]);

  /**
   * True when the currently selected trip is the one that already consumed this
   * user's free import (R17). Drives the free-limit banner suppression: without
   * it a returning user reads "Free Limit Reached" directly above the list they
   * are being allowed to finish.
   */
  const [isExemptTrip, setIsExemptTrip] = useState(false);
  useEffect(() => {
    if (isPremium || canImportPhotos || !selectedTripId) {
      setIsExemptTrip(false);
      return;
    }
    let cancelled = false;
    // Never rejects — it fails open internally.
    isPhotoImportExempt(selectedTripId).then((exempt) => {
      if (!cancelled) setIsExemptTrip(exempt);
    });
    return () => {
      cancelled = true;
    };
  }, [isPremium, canImportPhotos, selectedTripId]);

  /**
   * The R17-aware entitlement gate, shared by EVERY gate site (U10).
   *
   * Three upstream gates (selectTrip, switchCandidate, auto-start) return before
   * this hook's own fetch is ever reached, so an exemption implemented only in
   * the fetch would be dead code for exactly the scenario it exists to fix. They
   * all call this.
   *
   * Fails OPEN on a read error: a user who has already paid for a half-matched
   * trip must not be locked out of it by a flaky network.
   */
  const canRunImportForTrip = useCallback(
    async (tripId: string | null | undefined): Promise<boolean> => {
      if (isPremium) return true;
      if (canImportPhotos) {
        // Not gated, so no exemption is needed — but make sure the one-time
        // grandfather pass has run before the durable counter can ever gate
        // this user. Deliberately not awaited: it must not delay the phase
        // transition, and nothing here depends on its result.
        void ensurePhotoImportGrandfatherPass();
        return true;
      }
      return isPhotoImportExempt(tripId);
    },
    [isPremium, canImportPhotos]
  );

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

  // U9 bulk retry. `bulkRetryInFlightRef` is the synchronous double-tap guard
  // (set before the first await); `bulkRetryPreparingCount` is > 0 only during
  // the re-preparation window, before the first retried batch reaches the wire,
  // so the status row can name that wait instead of looking stalled.
  const bulkRetryInFlightRef = useRef(false);
  const [bulkRetryPreparingCount, setBulkRetryPreparingCount] = useState(0);

  // ==========================================================================
  // Dispatch owner count (R1 / KTD13) — owned by the controller
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
  // The counter lives on the singleton (U14/KTD21) rather than in this hook, so
  // `beginFetchOwner` / `endFetchOwner` have STABLE identity across progress
  // updates — five call sites take them as props — and so an owner claimed
  // before a navigation is still counted after it.
  //
  // The retry path (`retryFailedClusters`) deliberately does NOT take a slot: it
  // is scoped to explicit clusters and drives its own per-cluster spinner via
  // `retryingClusterIds`. Taking a global slot would re-hide every healthy
  // photos-only / no-place-found card during a retry (KTD7 / C4).
  const beginFetchOwner = suggestionDispatch.beginOwner;
  const endFetchOwner = suggestionDispatch.endOwner;

  /** True while ANY owner has an unsettled suggestion fetch (R1). */
  const isFetchingSuggestions = dispatchState.ownerCount > 0;

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
    async (
      candidate: TripCandidateDisplay,
      tripId: string | null
    ): Promise<{ gatedByPremium: true } | undefined> => {
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

      // Check SQLite cache for existing suggestions before buying anything.
      const cachedSuggestionsMap = await readCachedSuggestions(allClusters);

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
          cachedResults.push(cachedClusterSuggestion(cluster, cached));
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
      //
      // U10/R17: the gate is `canRunImportForTrip`, not the raw store read. A
      // trip that already consumed the import stays completable here, which is
      // what makes a partly-matched trip finishable after a reinstall.
      if (!(await canRunImportForTrip(tripId))) {
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
        // Reset dispatch state and mark as fetched (only if still current)
        if (!isStaleRequest()) {
          suggestionDispatch.reset();
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

      // U10/KTD18. Disclose the charge BEFORE the first dispatch, once, naming
      // the trip. Only a free user with the import still unconsumed sees it —
      // a premium user is never charged, and an exempt re-entry has already
      // been paid for. Skipped when there is no trip id, because there is then
      // nothing to name and nothing to charge (`claimPhotoImportForTrip` is a
      // no-op without one).
      if (!isPremium && canImportPhotos && tripId && !hasDisclosedFreeImport(tripId)) {
        const trip = queryClient.getQueryData<{ name?: string }>(['trips', tripId]);
        const accepted = await confirmFreeImport(trip?.name || 'this trip');
        if (!accepted) {
          if (__DEV__) {
            logger.log('[PhotoImport] Free import declined — dispatching nothing');
          }
          // Deliberately NOT marked disclosed and NOT marked fetched: the user
          // did not consent, so a later entry must ask again rather than
          // silently spending the import.
          return undefined;
        }
        markFreeImportDisclosed(tripId);
      }

      try {
        // U5/R5. Preparation is PER BATCH, not up front. The controller
        // dispatches batch one while batch two is still being encoded;
        // previously every uncached cluster was prepared before the first
        // request went out, which on a large trip is minutes of zero network.
        // `mapClusterToApiPayload` with no images builds the cheap skeleton
        // (ids, centroid, photo coordinates); `prepareBatch` attaches the
        // expensive base64 vision images to just the batch about to be
        // dispatched.
        const clustersById = new Map(uncachedClusters.map((c) => [c.id, c]));

        const result = await suggestionDispatch.dispatch({
          clusters: uncachedClusters.map((c) => mapClusterToApiPayload(c, [])),
          prepareBatch: createVisionPrepareBatch(clustersById),
          tripId,
          // U10/R16/KTD11. The free import is charged on the FIRST SUCCESSFUL
          // BATCH, not at the end of the fetch: progressive results make a
          // partial import the normal case, so end-of-fetch counting would
          // leave most free imports uncharged, while charging at dispatch would
          // charge a run that never got an answer.
          //
          // `claimPhotoImportForTrip` claims synchronously before its own first
          // await, and this callback runs with no await between the response
          // landing and the claim — so several batches resolving in the same
          // tick (which is exactly what a concurrent pool produces) cannot each
          // decide they are the first. A premium user is never charged.
          onBatchSuccess: isPremium ? undefined : () => claimPhotoImportForTrip(tripId),
        });

        if (__DEV__) {
          logger.log('[PhotoImport] API result:', {
            suggestionCount: result.suggestions.length,
            suggestionClusterIds: result.suggestions.map((s) => s.cluster_id),
          });
        }

        // Cache the fresh API results to SQLite, through the R20/KTD14
        // allow-list: only clusters this run has positive evidence of a
        // response for may be written. See `cacheRowsForDispatch`.
        const suggestionsToCache = cacheRowsForDispatch(uncachedClusters, result);

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

        // Mark candidate as processed — but ONLY when the run actually covered
        // every uncached cluster (U6/KTD6).
        //
        // This marker short-circuits `fetchSuggestions` for the rest of the
        // session. Setting it on any resolution was safe while dispatch either
        // ran the whole plan or threw; with partial resolution it is not. A run
        // stopped by a 429 leaves whole batches un-dispatched, and marking the
        // candidate fetched would make a same-session re-entry return
        // immediately, so those clusters would never be looked up at all — they
        // would sit as `lookup-failed` until the user retried each one by hand.
        // Coverage is "was it attempted", not "did it succeed": a cluster whose
        // batch failed IS covered and is recovered through the retry path,
        // whereas one that never went out is not, and re-entry re-dispatches it
        // (its successful neighbours come back from the SQLite cache, so nothing
        // is re-bought).
        const coveredEveryCluster = uncachedClusters.every((cluster) =>
          result.dispatchedClusterIds.has(cluster.id)
        );
        if (coveredEveryCluster) {
          fetchedCandidatesRef.current.add(candidate.id);
        } else if (__DEV__) {
          logger.log('[PhotoImport] Partial dispatch — candidate stays re-fetchable:', {
            candidateId: candidate.id,
            dispatched: result.dispatchedClusterIds.size,
            uncached: uncachedClusters.length,
          });
        }

        // KTD6: the fatal rejection is reported on the RESULT now rather than
        // thrown. The `catch` below still covers a genuinely thrown dispatch.
        reportDispatchFatalError(result.fatalError, tripId);

        // U10/R16 note: the free import is NOT counted here any more. It is
        // claimed on the first successful batch via `onBatchSuccess` above, so a
        // partly-matched trip — the normal case under progressive results — is
        // charged honestly and exactly once, and a run whose every batch failed
        // is not charged at all.

        // Track analytics with cache metrics and API timing. `failedChunks` is
        // read LIVE from the controller: the previous read went through the
        // mutation object captured in this closure, which predates the dispatch
        // it is describing and therefore always reported 0.
        const failedChunks = suggestionDispatch.getState().progress?.failedChunks ?? 0;
        const apiTimes = result.chunkResponseTimes ?? [];
        const percentiles = apiTimes.length > 0 ? calculateApiPercentiles(apiTimes) : null;
        // U11/R18. Concurrency's own numbers. `totalApiDurationMs` sums per-batch
        // durations, so under a pool it over-counts overlapped time and cannot
        // say whether the pool was ever full; the occupancy integral can.
        const telemetry = suggestionDispatch.getTelemetry();

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
          peakInFlightBatches: telemetry.peakInFlightBatches,
          meanInFlightBatches: telemetry.meanInFlightBatches,
          wireBusyMs: telemetry.wireBusyMs,
          wireSpanMs: telemetry.wireSpanMs,
        });
      } catch (error) {
        if (__DEV__) console.error('[PhotoImport] Suggestion error:', error);

        // M1: no Alert here. The controller records every un-responded
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
        } else if (error instanceof PhotoImportLimitReachedError || isEntitlementStop(error)) {
          // Same revocation as the carried-fatal path: the exemption is bounded
          // by a cluster allowance, so a 402 here means the trip stopped being
          // exempt and every later gate must stop saying otherwise.
          noteServerRefusedPhotoImport(tripId);
          Analytics.photoImportApiError({ errorType: 'entitlement_exhausted' });
        } else {
          Analytics.photoImportApiError({ errorType: 'unknown' });
        }
      }

      return undefined;
    },
    // The controller is a module singleton, so it is NOT a dependency: this
    // callback no longer churns on every progress update the way it did when it
    // depended on the mutation's state container.
    [
      clusterLookupRef,
      isPremium,
      canImportPhotos,
      canRunImportForTrip,
      currentCandidateIdRef,
      queryClient,
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
    async (
      candidate: TripCandidateDisplay,
      tripId?: string | null
    ): Promise<{ gatedByPremium: true } | undefined> => {
      // The caller passes the trip explicitly because `selectTrip` selects and
      // fetches in the same tick, before any effect has synced the ref. Recorded
      // here so the retry and manual-split paths, which fire much later from UI
      // callbacks, send the same `trip_id`.
      const effectiveTripId = tripId ?? activeTripIdRef.current ?? null;
      activeTripIdRef.current = effectiveTripId;
      beginFetchOwner();
      try {
        return await runFetchSuggestions(candidate, effectiveTripId);
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
   * Dispatches as a SCOPED single batch through the controller
   * (`claim` -> `dispatchBatch` -> `releaseClaim`) so it shares the claim sets,
   * the timeout, and the response partition with the other two paths — while
   * leaving the main dispatch's partial results and failure attribution alone.
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

      // Claim synchronously, before the first await, so a split cannot re-buy a
      // cluster another path already has on the wire (KTD7).
      const claimedIds = suggestionDispatch.claim(clusters.map((c) => c.id));
      if (claimedIds.length === 0) return;
      const claimed = new Set(claimedIds);
      const toDispatch = clusters.filter((c) => claimed.has(c.id));

      beginFetchOwner();
      try {
        const { response: result, respondedIds } = await suggestionDispatch.dispatchBatch({
          clusterIds: claimedIds,
          tripId: activeTripIdRef.current,
          prepare: createVisionPrepare(toDispatch),
        });

        // Cache results to SQLite — skip clusters missing due to transient failures.
        // This is a single batch, so the only lookup-failure signals are (a) a
        // thrown error for the whole call — handled by the catch below, which
        // caches nothing — and (b) failed_cluster_count for per-cluster timeouts,
        // excluded here. A transiently-failed split cluster must never be written
        // as [] (KTD8/B1/R20).
        const toCache = toCacheRows(
          toDispatch.filter(
            (cluster) => respondedIds.has(cluster.id) || result.failed_cluster_count === 0
          ),
          suggestionsByClusterId(result.suggestions)
        );
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

        const status = error instanceof AxiosError ? error.response?.status : undefined;

        if (isEntitlementStop(error)) {
          // U16/R17. The exemption is bounded by a cluster allowance, so the
          // trip this split belongs to has just stopped being exempt. Record the
          // refusal FIRST — otherwise every later gate keeps answering "exempt"
          // and keeps dispatching into the same 402 — then route to the paywall,
          // which is the actual next step, rather than the generic failure alert
          // this used to fall through to.
          noteServerRefusedPhotoImport(activeTripIdRef.current);
          if (onPremiumGate) {
            onPremiumGate('fetchForClusters-entitlement');
          } else {
            Alert.alert(
              'Free Photo Import Used',
              'Your account has used its included photo import. Upgrade to keep finding places for this trip.'
            );
          }
        } else if (status === 503 && error instanceof AxiosError) {
          // Only a QUOTA 503 carries Retry-After — the same discriminator the
          // dispatch path uses. The other three 503 sources (slot starvation,
          // pool exhaustion, a failed entitlement read) are transient, and
          // telling the user to come back tomorrow makes a momentary outage look
          // like the end of the day.
          if (error.response?.headers['retry-after']) {
            Alert.alert(
              'Daily Limit Reached',
              'The place suggestion service has reached its daily limit. Please try again tomorrow.'
            );
          } else {
            Alert.alert(
              'Service Temporarily Unavailable',
              'The place suggestion service is busy right now. Please try again in a moment.'
            );
          }
        } else if (error instanceof AxiosError && status === 429) {
          const retrySeconds = parseRetryAfterSeconds(error.response?.headers['retry-after']);
          Alert.alert(
            'Too Many Requests',
            `Please wait ${retrySeconds} seconds before trying again.`
          );
        } else {
          Alert.alert(
            'Failed to Get Suggestions',
            'Unable to find place suggestions for the split clusters. You can add entries manually.'
          );
        }
      } finally {
        suggestionDispatch.releaseClaim(claimedIds);
        endFetchOwner();
      }
    },
    [currentCandidateIdRef, beginFetchOwner, endFetchOwner, onPremiumGate]
  );

  /**
   * Retry the place lookup for an EXPLICIT list of previously-failed clusters
   * (U10 / KTD7, KTD8, KTD10, M1). Dispatches as a scoped single batch through
   * the controller, like `fetchForClusters`, and bypasses candidate-level
   * caching, but:
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
   *  - In-flight guard (KTD7): the controller's in-flight claim set prevents a
   *    double-tap from double-firing and a retry-vs-active-fetch race (I5) from
   *    double-caching. Separate from the candidate-stale guard below.
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
   *    retry again allowed — no cap) UNLESS the throw was one a retry cannot
   *    survive (quota / sustained rate limit / entitlement), which is classified
   *    by `isRetryDisablingError` exactly as the dispatch path classifies it.
   *    Other clusters' failure state is untouched.
   *  - No Alert (M1): the lookup-failed card already surfaces the failure; an
   *    Alert on top would double-surface, so the retry path shows none.
   */
  const retryFailedClusters = useCallback(
    async (clusterIds: string[]) => {
      if (clusterIds.length === 0) return;

      const currentClusterLookup = clusterLookupRef.current;
      // Read failure metadata LIVE from the controller rather than from a
      // rendered snapshot: this callback must not depend on the dispatch state
      // container, or its identity churns on every progress update.
      const failedInfo = suggestionDispatch.getState().failedClusterIds;

      // Candidate-stale guard: capture the active candidate at entry and compare
      // against the LIVE ref at each resolution point. If the user switched
      // candidates mid-retry, the new candidate's state was reset — writing the
      // old cluster's result into it would re-introduce stale failure/cache
      // entries. Reads `.current` live (not a captured value) so a switch-away-
      // then-back to the same candidate is correctly treated as NOT stale.
      const retryCandidateId = currentCandidateIdRef?.current ?? null;
      const isStaleRetry = () =>
        currentCandidateIdRef != null && currentCandidateIdRef.current !== retryCandidateId;

      // Resolve ids -> clusters, skipping: (a) retryDisabled (429/503) failures
      // (KTD10) and (b) ids that don't resolve to a known cluster. Then claim
      // through the controller, which drops anything another path already has on
      // the wire. Both steps run SYNCHRONOUSLY here (before any await) so a
      // double-tap / a retry-vs-retry race (I5) can't slip two calls past the
      // check and double-fire / double-cache.
      const candidates: LocationCluster[] = [];
      for (const id of clusterIds) {
        if (failedInfo.get(id)?.retryDisabled) continue;
        const cluster = getFullCluster(id, currentClusterLookup);
        if (cluster) candidates.push(cluster);
      }

      const claimedIds = suggestionDispatch.claim(candidates.map((c) => c.id));
      if (claimedIds.length === 0) return;
      const claimed = new Set(claimedIds);
      const toRetry = candidates.filter((c) => claimed.has(c.id));

      // Flag the claimed ids as retrying (per-cluster spinner) before any await.
      // The `finally` releases both the claim and the spinner.
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
        // chunk-1 success the caller also passed) is reused, not re-bought.
        const cachedMap = await readCachedSuggestions(toRetry);

        const cachedHits: ClusterSuggestion[] = [];
        const uncached: LocationCluster[] = [];
        for (const cluster of toRetry) {
          const cached = cachedMap.get(cluster.id);
          if (cached !== undefined) {
            cachedHits.push(cachedClusterSuggestion(cluster, cached));
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
          suggestionDispatch.clearFailedClusterIds(cachedHits.map((s) => s.cluster_id));
          for (const s of cachedHits) pendingIds.delete(s.cluster_id);
        }

        if (uncached.length === 0) return;

        const { response: result, respondedIds } = await suggestionDispatch.dispatchBatch({
          clusterIds: uncached.map((c) => c.id),
          tripId: activeTripIdRef.current,
          // U11/R18: counted against the current generation's retry tally. A
          // cache hit above is NOT an attempt — nothing went on the wire.
          isRetry: true,
          prepare: createVisionPrepare(uncached),
        });

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
          const suggestionsById = suggestionsByClusterId(result.suggestions);
          await cacheSuggestions(toCacheRows(succeeded, suggestionsById));

          if (!isStaleRetry()) {
            const newSuggestions: ClusterSuggestion[] = succeeded.map((cluster) => ({
              cluster_id: cluster.id,
              photo_ids: cluster.photos.map((p) => p.id),
              places: suggestionsById.get(cluster.id)?.places ?? [],
            }));
            setCachedSuggestions((prev) => [...prev, ...newSuggestions]);

            // Resolved -> remove from failedClusterIds so useClusterItems
            // reclassifies them as matched / no-place-found.
            suggestionDispatch.clearFailedClusterIds(succeeded.map((c) => c.id));
            for (const c of succeeded) pendingIds.delete(c.id);
          }
        }

        // Re-failed clusters stay lookup-failed (retry still enabled, no cap) —
        // but not if the candidate changed (don't pollute the new candidate).
        if (reFailed.length > 0 && !isStaleRetry()) {
          suggestionDispatch.addFailedClusterIds(
            reFailed.map((c) => ({ id: c.id, retryDisabled: false }))
          );
        }
      } catch (error) {
        // M1: no Alert here — the lookup-failed card already surfaces the
        // failure. Re-assert only the STILL-PENDING ids as lookup-failed so the
        // card stays/returns to lookup-failed. Already-resolved cache hits are
        // excluded (they left `pendingIds`), so a later api.post throw can't
        // wrongly re-fail a resolved cluster.
        //
        // KTD10: `retryDisabled` is CLASSIFIED, not hard-coded false. This
        // re-attributed every failure as retryable, so with the daily quota
        // exhausted a cluster that failed in the main dispatch was correctly
        // retry-disabled while one that had been retried once kept an enabled
        // Retry button — and an enabled "Retry All" entry — that could only ever
        // fail again. Same for the 402 entitlement stop, which additionally
        // revokes the trip's exemption so the next gate shows the paywall
        // instead of looping back into the same rejection.
        if (__DEV__) console.error('[PhotoImport] retryFailedClusters error:', error);
        if (isEntitlementStop(error)) {
          noteServerRefusedPhotoImport(activeTripIdRef.current);
        }
        if (pendingIds.size > 0 && !isStaleRetry()) {
          const retryDisabled = isRetryDisablingError(error);
          suggestionDispatch.addFailedClusterIds(
            [...pendingIds].map((id) => ({ id, retryDisabled }))
          );
        }
      } finally {
        // Release the in-flight claim + retrying state for these ids. (Always
        // release, even on a stale retry — the spinner/claim for the claimed ids
        // must clear regardless of whether the candidate changed.)
        suggestionDispatch.releaseClaim(claimedIds);
        setRetryingClusterIds((prev) => {
          const next = new Set(prev);
          for (const id of claimedIds) next.delete(id);
          return next;
        });
      }
    },
    // The controller is a module singleton and `clusterLookupRef` /
    // `currentCandidateIdRef` are refs, so this callback's identity is STABLE
    // across progress updates. It previously depended on the mutation's state
    // container and churned on every batch.
    [clusterLookupRef, currentCandidateIdRef]
  );

  /**
   * Retry EVERY retry-eligible failed cluster in one action (U9/R15).
   *
   * Concurrency multiplies the blast radius of a single backgrounding or network
   * blip (KTD12): at pool width, one interruption produces a screenful of rows
   * that would otherwise each need their own tap. This is that screenful in one
   * control.
   *
   * Differs from `retryFailedClusters` (the per-row retry) in three ways, all
   * consequences of its size:
   *
   *  - It goes through the controller's chunked `dispatch` — the BOUNDED POOL
   *    (KTD7/KTD15) — not a single `dispatchBatch`. A fifty-cluster retry as one
   *    request would time out; as ten simultaneous ones it would walk straight
   *    into the backend's burst cap and come back 429 (U7/U16).
   *  - It TAKES an owner slot. The per-row retry deliberately does not, because
   *    it must not re-hide the healthy cards around it; a bulk retry is the whole
   *    list, so the in-progress status row is the honest surface and the
   *    reconciliation sweep must not fire against clusters it is re-dispatching.
   *  - It runs as `isRetry`, so the already-matched rows and the failures it is
   *    NOT retrying (retry-disabled ones) survive the run.
   *
   * Retry-eligibility is filtered here as well as by the caller: retry-disabled
   * (429/503 quota) clusters are skipped — retrying them can only fail again —
   * and so is anything the main dispatch still has in flight.
   */
  const retryAllFailedClusters = useCallback(
    async (clusterIds: string[]) => {
      if (clusterIds.length === 0) return;
      // Claim-before-await (the same guard shape the per-cluster retry uses): a
      // double tap on a control that fans out to the whole list is exactly what
      // trips the burst cap.
      if (bulkRetryInFlightRef.current) return;

      const state = suggestionDispatch.getState();
      const currentClusterLookup = clusterLookupRef.current;
      const eligible: LocationCluster[] = [];
      for (const id of clusterIds) {
        if (state.failedClusterIds.get(id)?.retryDisabled) continue;
        if (state.inFlightClusterIds.has(id)) continue;
        const cluster = getFullCluster(id, currentClusterLookup);
        if (cluster) eligible.push(cluster);
      }
      if (eligible.length === 0) return;

      bulkRetryInFlightRef.current = true;
      // Surface the re-preparation window explicitly: the payloads were released
      // after their first dispatch and have to be rebuilt, single-threaded, so a
      // large retry is silent for a while before any request leaves.
      setBulkRetryPreparingCount(eligible.length);
      beginFetchOwner();

      const clustersById = new Map(eligible.map((c) => [c.id, c]));

      try {
        const result = await suggestionDispatch.dispatch({
          clusters: eligible.map((c) => mapClusterToApiPayload(c, [])),
          prepareBatch: createVisionPrepareBatch(clustersById, () => setBulkRetryPreparingCount(0)),
          isRetry: true,
          tripId: activeTripIdRef.current,
          // A bulk retry is a repair of a run that already claimed the import,
          // so the claim is normally a no-op here. It is still wired: if the
          // original run's charge failed and released its claim, the repair is
          // the honest place to charge it.
          onBatchSuccess: isPremium
            ? undefined
            : () => claimPhotoImportForTrip(activeTripIdRef.current),
        });

        // Same cache-write ALLOW-LIST as the main dispatch (R20/KTD14). The scan
        // is restricted to `eligible` because a retry result's
        // `failedClusterIds` is the MERGED map: other clusters' failures must
        // stay out of this decision.
        await cacheSuggestions(cacheRowsForDispatch(eligible, result));

        reportDispatchFatalError(result.fatalError, activeTripIdRef.current);
      } catch (error) {
        // M1: no Alert — the rows themselves carry the failure. A cluster the
        // run never answered is left unattributed and the consumer's
        // reconciliation sweep renders it lookup-failed with retry enabled once
        // this owner releases.
        if (__DEV__) console.error('[PhotoImport] retryAllFailedClusters error:', error);
        Analytics.photoImportApiError({ errorType: 'unknown' });
      } finally {
        setBulkRetryPreparingCount(0);
        bulkRetryInFlightRef.current = false;
        endFetchOwner();
      }
    },
    [clusterLookupRef, beginFetchOwner, endFetchOwner, isPremium]
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
    /**
     * Live snapshot of the dispatch controller (U14). The adapter surface every
     * downstream consumer reads: `isDispatching`, `partialResults`, `data`,
     * `progress`, `failedClusterIds`, and the enqueued / in-flight /
     * dispatched-and-resolved cluster sets.
     */
    suggestionDispatch: dispatchState,
    /** Abort any running dispatch and clear all dispatch state. */
    resetSuggestionDispatch: suggestionDispatch.reset,
    cachedSuggestions,
    fetchSuggestions,
    fetchForClusters,
    retryFailedClusters,
    retryAllFailedClusters,
    retryingClusterIds,
    /** > 0 only while a bulk retry is rebuilding payloads (U9). */
    bulkRetryPreparingCount,
    clearFetchedCache,
    fetchedCandidatesRef,
    // Dispatch owner state (R1/KTD13): true while ANY owner is unsettled.
    isFetchingSuggestions,
    beginFetchOwner,
    endFetchOwner,
    // Premium gating state
    isPremium,
    canImportPhotos,
    /**
     * True when the selected trip already consumed this user's free import
     * (U10/R17). Suppresses the free-limit banner: a returning user must not be
     * told "Free Limit Reached" above the very list they are finishing.
     */
    isExemptTrip,
    /**
     * The R17-aware entitlement gate. Every gate site that guards entry to
     * matching must use this rather than `!isPremium && !canImportPhotos`.
     */
    canRunImportForTrip,
  };
}
