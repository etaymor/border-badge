/**
 * React Query hooks for photo import place suggestions.
 */

import { useCallback, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AxiosError } from 'axios';

import { api } from '@services/api';
import type {
  PlaceSuggestionRequest,
  PlaceSuggestionResponse,
  ClusterSuggestion,
} from '@services/photoImport';

/** Progress state for chunked place suggestion requests */
export interface PlaceSuggestionProgress {
  clustersTotal: number;
  clustersCompleted: number;
  percentage: number;
  /** Number of chunks that failed (non-fatal errors) */
  failedChunks: number;
  /** Number of individual clusters that timed out or failed within successful chunks */
  failedClusters: number;
}

/**
 * Chunk size for batched place suggestion requests.
 *
 * The backend searches clusters with a bounded concurrency (5), so a chunk's wall
 * time scales with ceil(CHUNK_SIZE / 5) rounds of tiered Places lookups. At 15 a
 * slow chunk could outrun the request timeout, and because a timeout fails the
 * WHOLE chunk, one slow cluster took 14 healthy ones down with it into
 * "Couldn't check this location". Smaller chunks bound that blast radius and let
 * partial results paint sooner.
 */
export const CHUNK_SIZE = 5;

/**
 * Per-request timeout for place suggestions (ms).
 *
 * The shared api client's 30s default is tuned for ordinary CRUD. A suggestion
 * chunk fans out to vision classification plus several sequential Google Places
 * calls per cluster, so it legitimately needs longer -- and a client timeout here
 * is indistinguishable from a real failure, marking every cluster in the chunk as
 * lookup-failed. Retrying such a chunk just re-runs the same work into the same
 * wall, which is why a too-tight timeout also makes the Retry button look broken.
 */
export const SUGGEST_PLACES_TIMEOUT_MS = 90000;

/** Extended response with client-side timing data */
export interface ChunkedPlaceSuggestionResult extends PlaceSuggestionResponse {
  /** Per-chunk API response times in milliseconds (client-side only) */
  chunkResponseTimes: number[];
  /**
   * Clusters whose chunk failed (non-fatal path), mirrored onto the resolved
   * result so the caller can make a synchronous cache-write decision without
   * waiting for the `failedClusterIds` state to re-render. Empty on full success.
   */
  failedClusterIds: FailedClusterIds;
  /**
   * `Date.now()` at which the FIRST batch carrying at least one suggestion
   * resolved, or null if none did (U15). Time-to-first-suggestion is what a
   * user actually waits for; the per-chunk durations and their percentiles
   * describe batches, and on a multi-chunk import the two differ by most of the
   * request. Absolute rather than relative so the caller can measure from the
   * point IT started (cache lookup + vision prep included), not from the point
   * the mutation happened to begin.
   */
  firstSuggestionAt: number | null;
}

/** Metadata for a cluster whose place lookup failed (chunk-level failure). */
export interface FailedClusterInfo {
  /**
   * True for quota/rate-limit (503/429) failures where an immediate retry is
   * pointless — the three-state UI disables the retry affordance for these.
   */
  retryDisabled: boolean;
}

/** Map of cluster id → failure metadata for clusters whose chunk failed. */
export type FailedClusterIds = Map<string, FailedClusterInfo>;

/** Error thrown when rate limited, includes retry delay */
export class RateLimitError extends Error {
  retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super(`Rate limited. Retry after ${retryAfterSeconds} seconds.`);
    this.name = 'RateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** Error thrown when daily quota is exhausted */
export class QuotaExhaustedError extends Error {
  constructor() {
    super('Daily quota exhausted. Please try again tomorrow.');
    this.name = 'QuotaExhaustedError';
  }
}

/**
 * Hook to fetch place suggestions for photo clusters.
 *
 * Sends clusters with centroids and photos to the backend,
 * receives ranked place suggestions.
 *
 * On 429 responses, parses Retry-After header and throws RateLimitError
 * with the retry delay for UI to display.
 */
export function useSuggestPlaces() {
  return useMutation({
    mutationFn: async (data: PlaceSuggestionRequest): Promise<PlaceSuggestionResponse> => {
      try {
        const response = await api.post('/photos/suggest-places', data, {
          timeout: SUGGEST_PLACES_TIMEOUT_MS,
        });
        return response.data;
      } catch (error) {
        if (error instanceof AxiosError) {
          if (error.response?.status === 503) {
            // Daily quota exhausted
            throw new QuotaExhaustedError();
          }
          if (error.response?.status === 429) {
            // Parse Retry-After header (default to 60 seconds if not provided)
            const retryAfter = error.response.headers['retry-after'];
            const retrySeconds = retryAfter ? parseInt(retryAfter, 10) : 60;
            throw new RateLimitError(isNaN(retrySeconds) ? 60 : retrySeconds);
          }
        }
        throw error;
      }
    },
  });
}

/**
 * Split an array into chunks of specified size.
 */
function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * Hook for chunked place suggestions with progress tracking.
 *
 * Sends clusters in batches to show incremental progress and results.
 * Returns partial results as each batch completes for immediate display.
 */
export function useSuggestPlacesChunked() {
  const [progress, setProgress] = useState<PlaceSuggestionProgress | null>(null);
  const [partialResults, setPartialResults] = useState<ClusterSuggestion[]>([]);
  // Tracks which clusters belonged to a chunk that failed (KTD6). Stored in a
  // dedicated state alongside `partialResults` — NOT on `progress` and NOT on the
  // resolved result — because `onError` clears `progress` and a thrown
  // `mutateAsync` has no resolved result, either of which would wipe the failed
  // ids before the UI can read them (re-introducing the B1 drop for the fatal
  // 429/503 case). `partialResults` is the existing state not reset by `onError`,
  // so this mirrors it.
  const [failedClusterIds, setFailedClusterIds] = useState<FailedClusterIds>(() => new Map());
  const abortRef = useRef(false);

  const reset = useCallback(() => {
    setProgress(null);
    setPartialResults([]);
    setFailedClusterIds(new Map());
    abortRef.current = false;
  }, []);

  const mutation = useMutation({
    mutationFn: async (data: PlaceSuggestionRequest): Promise<ChunkedPlaceSuggestionResult> => {
      const clusters = data.clusters;
      const totalClusters = clusters.length;
      const chunks = chunkArray(clusters, CHUNK_SIZE);
      const allSuggestions: ClusterSuggestion[] = [];
      let failedChunkCount = 0;
      let failedClusterCount = 0;
      const chunkResponseTimes: number[] = [];
      // U15: stamped once, when the first batch that actually carries a
      // suggestion lands. An empty batch paints nothing, so it does not count.
      let firstSuggestionAt: number | null = null;

      // Reset state for new request
      abortRef.current = false;
      setPartialResults([]);
      setFailedClusterIds(new Map());
      // Local accumulator mirrored into state — avoids losing entries to React
      // state-batching across the chunk loop and the fatal re-throw path.
      const failedIds: FailedClusterIds = new Map();
      const recordFailedClusters = (clusterChunks: typeof clusters, retryDisabled: boolean) => {
        for (const cluster of clusterChunks) {
          failedIds.set(cluster.id, { retryDisabled });
        }
        setFailedClusterIds(new Map(failedIds));
      };
      setProgress({
        clustersTotal: totalClusters,
        clustersCompleted: 0,
        percentage: 0,
        failedChunks: 0,
        failedClusters: 0,
      });

      for (let i = 0; i < chunks.length; i++) {
        // Check for abort between chunks
        if (abortRef.current) {
          break;
        }

        const chunk = chunks[i];
        const clustersProcessed = i * CHUNK_SIZE;

        setProgress({
          clustersTotal: totalClusters,
          clustersCompleted: clustersProcessed,
          percentage: Math.round((clustersProcessed / totalClusters) * 100),
          failedChunks: failedChunkCount,
          failedClusters: failedClusterCount,
        });

        const chunkStartTime = Date.now();
        try {
          const response = await api.post(
            '/photos/suggest-places',
            { clusters: chunk },
            { timeout: SUGGEST_PLACES_TIMEOUT_MS }
          );
          const chunkDurationMs = Date.now() - chunkStartTime;
          chunkResponseTimes.push(chunkDurationMs);
          const responseData = response.data as PlaceSuggestionResponse;
          const suggestions = responseData.suggestions;
          const chunkFailedClusters = responseData.failed_cluster_count ?? 0;
          failedClusterCount += chunkFailedClusters;
          if (firstSuggestionAt === null && suggestions.length > 0) {
            firstSuggestionAt = Date.now();
          }
          if (__DEV__) {
            console.log(
              `[PhotoImport] Chunk ${i + 1}/${chunks.length}: received ${suggestions.length} suggestions in ${chunkDurationMs}ms` +
                (chunkFailedClusters > 0 ? `, ${chunkFailedClusters} clusters timed out` : ''),
              suggestions.map((s) => ({
                clusterId: s.cluster_id,
                placeCount: s.places?.length ?? 0,
                topPlace: s.places?.[0]?.name ?? 'none',
              }))
            );
          }
          allSuggestions.push(...suggestions);
          // Update partial results for immediate display
          setPartialResults([...allSuggestions]);
        } catch (error) {
          const chunkDurationMs = Date.now() - chunkStartTime;
          chunkResponseTimes.push(chunkDurationMs);
          // Re-throw fatal errors (quota exhausted, rate limited). Before
          // re-throwing, record every still-un-responded cluster — the current
          // chunk plus every chunk not yet processed — as lookup-failed with
          // retry DISABLED (KTD10). Without this the rejected mutation would drop
          // those clusters entirely, re-introducing B1 for exactly the quota case.
          if (error instanceof AxiosError) {
            // Only a QUOTA 503 is fatal. The backend also returns 503 for a
            // misconfigured service and for an unreachable upstream — treating
            // those as quota-exhausted told the user "Daily limit reached" and
            // HID the Retry button, making a transient outage look permanent and
            // unrecoverable. Quota is the only 503 that carries Retry-After, so
            // use that to tell them apart; the rest fall through to the
            // retryable path below.
            if (error.response?.status === 503 && error.response.headers['retry-after']) {
              recordFailedClusters(chunks.slice(i).flat(), true);
              throw new QuotaExhaustedError();
            }
            if (error.response?.status === 429) {
              recordFailedClusters(chunks.slice(i).flat(), true);
              const retryAfter = error.response.headers['retry-after'];
              const retrySeconds = retryAfter ? parseInt(retryAfter, 10) : 60;
              throw new RateLimitError(isNaN(retrySeconds) ? 60 : retrySeconds);
            }
          }
          // Track non-fatal errors and continue with remaining chunks. Record
          // this chunk's clusters as lookup-failed with retry ENABLED so the
          // three-state model can surface + retry them (KTD6) instead of
          // silently rendering them as photos-only "No place found" (B1).
          recordFailedClusters(chunk, false);
          failedChunkCount++;
          if (__DEV__) {
            console.warn(`[PhotoImport] Chunk ${i + 1} failed, continuing...`, error);
          }
        }
      }

      // Mark complete with final failure count (skip if aborted)
      if (!abortRef.current) {
        setProgress({
          clustersTotal: totalClusters,
          clustersCompleted: totalClusters,
          percentage: 100,
          failedChunks: failedChunkCount,
          failedClusters: failedClusterCount,
        });
      }

      return {
        suggestions: allSuggestions,
        failed_cluster_count: failedClusterCount,
        chunkResponseTimes,
        failedClusterIds: new Map(failedIds),
        firstSuggestionAt,
      };
    },
    onError: () => {
      // Reset progress on error
      setProgress(null);
    },
  });

  // Wrap reset to also abort in-flight requests
  const fullReset = useCallback(() => {
    abortRef.current = true;
    mutation.reset();
    reset();
  }, [mutation, reset]);

  // Remove specific cluster ids from `failedClusterIds` (U10). Used by the retry
  // path when a previously-failed cluster now resolves (matched / no-place-found)
  // so `useClusterItems` reclassifies it out of `lookup-failed`. Only the passed
  // ids are touched — every other cluster's failure state is preserved.
  const clearFailedClusterIds = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    setFailedClusterIds((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const id of ids) {
        if (next.delete(id)) changed = true;
      }
      return changed ? next : prev;
    });
  }, []);

  // Add (or re-add) cluster ids to `failedClusterIds` (U10). Used by the retry
  // path when a retried cluster fails AGAIN — it must stay/return to
  // `lookup-failed` (retry still allowed; no cap). Additive: leaves other
  // clusters' failure state untouched.
  const addFailedClusterIds = useCallback((entries: { id: string; retryDisabled: boolean }[]) => {
    if (entries.length === 0) return;
    setFailedClusterIds((prev) => {
      const next = new Map(prev);
      for (const { id, retryDisabled } of entries) {
        next.set(id, { retryDisabled });
      }
      return next;
    });
  }, []);

  return {
    ...mutation,
    progress,
    partialResults,
    /**
     * Clusters whose chunk failed (KTD6). Drives the client three-state model so
     * a transient lookup-failure is distinguishable from a genuine no-place-found.
     * Each entry carries `retryDisabled` (true for 429/503 quota/rate-limit).
     */
    failedClusterIds,
    /** Remove resolved cluster ids from `failedClusterIds` (U10 retry success). */
    clearFailedClusterIds,
    /** Re-add cluster ids to `failedClusterIds` (U10 retry re-failure). */
    addFailedClusterIds,
    reset: fullReset,
  };
}
