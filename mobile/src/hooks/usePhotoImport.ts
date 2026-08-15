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
 * Size of the FIRST batch (U5/R24).
 *
 * Time-to-first-suggestion is gated by one batch's on-device preparation plus
 * one batch's round trip, and at the full CHUNK_SIZE that sum lands right on the
 * target. Dispatching a smaller opening batch cuts both halves: two clusters is
 * two vision preparations instead of five, and the backend still resolves them
 * in a single concurrency round. One would be marginally faster still, but it
 * pays a whole extra request's overhead per cluster and leaves most of the
 * backend's per-request concurrency idle, so the ramp starts at two and every
 * subsequent batch runs at full CHUNK_SIZE.
 */
export const FIRST_CHUNK_SIZE = 2;

/**
 * Split clusters into dispatch batches: a small first batch, then full-size
 * ones (U5/R24). Exported so tests derive batch boundaries from the real plan
 * instead of hardcoding them.
 */
export function planSuggestionBatches<T>(items: T[]): T[][] {
  if (items.length === 0) return [];

  const batches: T[][] = [];
  let index = 0;
  // Only ramp when there is something left over — otherwise a 2-cluster import
  // would be split into two requests for no gain.
  if (items.length > FIRST_CHUNK_SIZE) {
    batches.push(items.slice(0, FIRST_CHUNK_SIZE));
    index = FIRST_CHUNK_SIZE;
  }
  for (; index < items.length; index += CHUNK_SIZE) {
    batches.push(items.slice(index, index + CHUNK_SIZE));
  }
  return batches;
}

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

/** One cluster payload as sent to `/photos/suggest-places`. */
export type PlaceSuggestionCluster = PlaceSuggestionRequest['clusters'][number];

/**
 * Input to the chunked mutation.
 *
 * `clusters` is the canonical dispatch order. When `prepareBatch` is supplied
 * the entries may be SKELETONS — everything except the expensive
 * `vision_images_base64` — and the heavy encoding is attached per batch right
 * before that batch is dispatched (U5/R5). Without it, `clusters` must already
 * be complete payloads and is sent as-is.
 */
export interface ChunkedPlaceSuggestionRequest extends PlaceSuggestionRequest {
  prepareBatch?: (batch: PlaceSuggestionCluster[]) => Promise<PlaceSuggestionCluster[]>;
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
    mutationFn: async (
      data: ChunkedPlaceSuggestionRequest
    ): Promise<ChunkedPlaceSuggestionResult> => {
      const clusters = data.clusters;
      const totalClusters = clusters.length;
      const chunks = planSuggestionBatches(clusters);
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

      // ── Pipelined preparation (U5/R5) ────────────────────────────────
      // Preparation runs ONE batch ahead of dispatch: batch N's request is in
      // flight while batch N+1 is being encoded, instead of every batch being
      // prepared before the first request goes out. The preparations are
      // CHAINED rather than started in parallel, so the number of concurrent
      // on-device preparation workers is unchanged — Expo's async function
      // queue is serial at the native layer, so extra workers buy no
      // parallelism and only deepen a queue shared with other modules (KTD10).
      let prepareTail: Promise<unknown> = Promise.resolve();
      const startPreparing = (
        batch: PlaceSuggestionCluster[]
      ): Promise<PlaceSuggestionCluster[]> => {
        const prepare = data.prepareBatch;
        if (!prepare) return Promise.resolve(batch);
        const run = prepareTail.then(
          () => prepare(batch),
          () => prepare(batch)
        );
        prepareTail = run.then(
          () => undefined,
          () => undefined
        );
        // A preparation failure must never reject the pipeline: the batch still
        // dispatches, just without its vision images.
        return run.catch((error) => {
          if (__DEV__) {
            console.warn('[PhotoImport] Batch preparation failed, dispatching without it', error);
          }
          return batch;
        });
      };

      let pendingPayload: Promise<PlaceSuggestionCluster[]> | null =
        chunks.length > 0 ? startPreparing(chunks[0]) : null;

      for (let i = 0; i < chunks.length; i++) {
        // Check for abort between chunks
        if (abortRef.current) {
          break;
        }

        const chunk = chunks[i];
        const clustersProcessed = chunks.slice(0, i).reduce((sum, c) => sum + c.length, 0);

        // Kick off the NEXT batch's preparation before waiting on this one's
        // payload, so it overlaps this batch's round trip. Exactly one batch is
        // prepared ahead, so at most the in-flight batch and its successor hold
        // encoded payloads.
        const payloadPromise = pendingPayload;
        pendingPayload = i + 1 < chunks.length ? startPreparing(chunks[i + 1]) : null;

        setProgress({
          clustersTotal: totalClusters,
          clustersCompleted: clustersProcessed,
          percentage: Math.round((clustersProcessed / totalClusters) * 100),
          failedChunks: failedChunkCount,
          failedClusters: failedClusterCount,
        });

        // Wait only for THIS batch's payload. `startPreparing` never rejects,
        // so a preparation failure degrades to a vision-less dispatch rather
        // than failing the batch.
        let payload: PlaceSuggestionCluster[] | null = payloadPromise
          ? await payloadPromise
          : chunk;

        const chunkStartTime = Date.now();
        try {
          const request = api.post(
            '/photos/suggest-places',
            { clusters: payload },
            { timeout: SUGGEST_PLACES_TIMEOUT_MS }
          );
          // The base64 vision images are by far the largest allocation in this
          // loop. Drop our reference the moment the request is issued so an
          // already-dispatched batch is not pinned for the whole round trip or
          // across the batches that follow it.
          payload = null;
          const response = await request;
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
