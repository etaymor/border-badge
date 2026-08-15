/**
 * suggestionDispatch - Module-level singleton that owns place-suggestion dispatch.
 *
 * ONE owner for chunking, cluster claiming, abort, progress accounting, and
 * failure attribution, shared by all three fetch paths (main dispatch, manual
 * split, scoped retry). Policy stays with the caller: SQLite cache read/write
 * discipline, entitlement, analytics, and candidate-stale guarding all live in
 * `usePlaceSuggestions`.
 *
 * WHY A SINGLETON (KTD21). Dispatch state cannot live in a hook instance: a
 * per-hook controller cannot be reached by an app-root lifecycle hook, dies on
 * navigation, and loses its claim sets — and navigating away mid-import is
 * exactly what progressive interaction encourages. This mirrors the established
 * shape of `photoScanService`: the service singleton owns the state machine and
 * React subscribes to it (`useSuggestionDispatch` in `@hooks/usePhotoImport`).
 *
 * WHY NOT A MUTATION (KTD15). This uses none of React Query's affordances — no
 * query key, no cache, no retry, no dedup — and its error handler is on the way
 * to becoming dead code once dispatch resolves partially. It was retired rather
 * than grown.
 *
 * TWO CLUSTER SETS, NOT ONE (KTD7):
 *  - `enqueuedClusterIds` — every cluster the controller has ACCEPTED, resolved
 *    or not. This is what pending rows are sourced from (R10). Sourcing them
 *    from the in-flight set instead would render only the clusters in the live
 *    batches (roughly 15 of 100) and leave the screen mostly empty.
 *  - `inFlightClusterIds` — the narrower set with a request actually
 *    outstanding. This drives retry/split claim deduplication and, with
 *    `dispatchedAndResolvedClusterIds`, the cache-write allow-list.
 *  - `dispatchedAndResolvedClusterIds` — clusters whose batch received a
 *    response. Positive evidence that a response for that cluster arrived, which
 *    is the precondition for writing a suggestion cache row (R20).
 *
 * CONCURRENCY: dispatch is strictly one batch at a time. The seam for
 * concurrent batches exists (claim / release / per-batch accounting are already
 * per batch) but is deliberately not used yet.
 */

import { AxiosError } from 'axios';

import { api } from '@services/api';

import type { ClusterSuggestion, PlaceSuggestionRequest, PlaceSuggestionResponse } from './types';

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

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

/**
 * Split clusters into dispatch batches: a small first batch, then full-size
 * ones (U5/R24). Exported so tests and the controller derive batch boundaries
 * from the real plan instead of re-deriving them from CHUNK_SIZE.
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

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

/** One cluster payload as sent to `/photos/suggest-places`. */
export type PlaceSuggestionCluster = PlaceSuggestionRequest['clusters'][number];

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
   * dispatch happened to begin.
   */
  firstSuggestionAt: number | null;
  /**
   * Clusters this run dispatched and received a response for (R20). The
   * cache-write allow-list: a cluster absent here has no positive evidence that
   * a response for it ever arrived, so a cache row must not be written for it.
   */
  dispatchedAndResolvedIds: Set<string>;
}

/**
 * Input to the chunked main dispatch.
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

/** Result of a single scoped (split / retry) batch dispatch. */
export interface SuggestionBatchOutcome {
  response: PlaceSuggestionResponse;
  /** Cluster ids the response actually carried a row for. */
  respondedIds: Set<string>;
  /** Claimed ids the response did not carry (per-cluster timeout). */
  unresolvedIds: string[];
}

/**
 * The snapshot React subscribes to. Replaced (never mutated) on every change so
 * `useSyncExternalStore` can compare by identity.
 */
export interface SuggestionDispatchState {
  /** True while at least one chunked main dispatch is running. */
  isDispatching: boolean;
  progress: PlaceSuggestionProgress | null;
  /** Suggestions published batch-by-batch, for immediate display. */
  partialResults: ClusterSuggestion[];
  /** Result of the last successfully completed main dispatch. */
  data: ChunkedPlaceSuggestionResult | null;
  /**
   * Clusters whose lookup failed (KTD6). Drives the client three-state model so
   * a transient lookup-failure is distinguishable from a genuine no-place-found.
   * Each entry carries `retryDisabled` (true for 429/503 quota/rate-limit).
   */
  failedClusterIds: FailedClusterIds;
  /** KTD7: every accepted cluster, resolved or not. Source of pending rows (R10). */
  enqueuedClusterIds: ReadonlySet<string>;
  /** KTD7: clusters with a request outstanding. Drives claim deduplication. */
  inFlightClusterIds: ReadonlySet<string>;
  /** KTD7/R20: clusters whose batch received a response. Cache-write allow-list. */
  dispatchedAndResolvedClusterIds: ReadonlySet<string>;
  /** Number of unsettled dispatch owners (R1/KTD13). */
  ownerCount: number;
}

const EMPTY_SET: ReadonlySet<string> = new Set();

const INITIAL_STATE: SuggestionDispatchState = {
  isDispatching: false,
  progress: null,
  partialResults: [],
  data: null,
  failedClusterIds: new Map(),
  enqueuedClusterIds: EMPTY_SET,
  inFlightClusterIds: EMPTY_SET,
  dispatchedAndResolvedClusterIds: EMPTY_SET,
  ownerCount: 0,
};

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

class SuggestionDispatchController {
  private state: SuggestionDispatchState = INITIAL_STATE;

  private listeners = new Set<() => void>();

  /**
   * Set once `reset()` runs, so a dispatch loop already past its abort check
   * stops before issuing the next batch. Cleared when a new dispatch starts.
   */
  private aborted = false;

  /** Number of chunked main dispatches currently running. */
  private activeDispatches = 0;

  // -- subscription --------------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getState = (): SuggestionDispatchState => this.state;

  private setState(patch: Partial<SuggestionDispatchState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  // -- dispatch owner accounting (R1 / KTD13) ------------------------------

  /**
   * Claim a dispatch owner slot. Always pair with `endOwner` in a `finally`
   * that spans the owner's whole body, including every early return and every
   * thrown path — a stranded owner permanently withholds terminal rows.
   *
   * "Settled" means ALL owners released. A parked owner (holding the SQLite
   * cache read open, waiting on vision prep, waiting on the network) still
   * counts as unsettled.
   */
  beginOwner = (): void => {
    this.setState({ ownerCount: this.state.ownerCount + 1 });
  };

  /** Release a dispatch owner slot. Clamped so a stray release can't go negative. */
  endOwner = (): void => {
    this.setState({ ownerCount: Math.max(0, this.state.ownerCount - 1) });
  };

  // -- cluster claiming (KTD7) ---------------------------------------------

  /**
   * Accept clusters for dispatch WITHOUT marking them in flight. Used by the
   * chunked main dispatch, which accepts every uncached cluster up front (so
   * each is immediately a pending row, R10) but only puts one batch on the wire
   * at a time.
   */
  private enqueue(ids: string[]): void {
    if (ids.length === 0) return;
    const enqueued = new Set(this.state.enqueuedClusterIds);
    for (const id of ids) enqueued.add(id);
    this.setState({ enqueuedClusterIds: enqueued });
  }

  /**
   * Synchronously claim clusters for a scoped (split / retry) dispatch.
   *
   * Returns only the ids that were NOT already in flight. Callers MUST call
   * this before their first await so a double-tap, or a retry racing an active
   * dispatch, cannot slip two requests past the check. Release with
   * `releaseClaim` in a `finally`.
   */
  claim = (ids: string[]): string[] => {
    const claimed = ids.filter((id) => !this.state.inFlightClusterIds.has(id));
    if (claimed.length === 0) return claimed;
    const inFlight = new Set(this.state.inFlightClusterIds);
    const enqueued = new Set(this.state.enqueuedClusterIds);
    for (const id of claimed) {
      inFlight.add(id);
      enqueued.add(id);
    }
    this.setState({ inFlightClusterIds: inFlight, enqueuedClusterIds: enqueued });
    return claimed;
  };

  /** Release a scoped claim. Leaves the enqueued set untouched (KTD7). */
  releaseClaim = (ids: string[]): void => {
    if (ids.length === 0) return;
    const inFlight = new Set(this.state.inFlightClusterIds);
    let changed = false;
    for (const id of ids) {
      if (inFlight.delete(id)) changed = true;
    }
    if (changed) this.setState({ inFlightClusterIds: inFlight });
  };

  /**
   * Record positive evidence that a response covering these clusters arrived
   * (R20). Only ids in this set may be written to the suggestion cache.
   */
  private markResolved(ids: string[]): void {
    if (ids.length === 0) return;
    const resolved = new Set(this.state.dispatchedAndResolvedClusterIds);
    for (const id of ids) resolved.add(id);
    this.setState({ dispatchedAndResolvedClusterIds: resolved });
  }

  // -- failure attribution --------------------------------------------------

  /**
   * Remove cluster ids from `failedClusterIds` (retry success). Only the passed
   * ids are touched — every other cluster's failure state is preserved.
   */
  clearFailedClusterIds = (ids: string[]): void => {
    if (ids.length === 0) return;
    const next = new Map(this.state.failedClusterIds);
    let changed = false;
    for (const id of ids) {
      if (next.delete(id)) changed = true;
    }
    if (changed) this.setState({ failedClusterIds: next });
  };

  /**
   * Add (or re-add) cluster ids to `failedClusterIds`. Used when a retried
   * cluster fails AGAIN — it must stay/return to `lookup-failed` (retry still
   * allowed; no cap). Additive: other clusters' failure state is untouched.
   */
  addFailedClusterIds = (entries: { id: string; retryDisabled: boolean }[]): void => {
    if (entries.length === 0) return;
    const next = new Map(this.state.failedClusterIds);
    for (const { id, retryDisabled } of entries) {
      next.set(id, { retryDisabled });
    }
    this.setState({ failedClusterIds: next });
  };

  // -- reset ----------------------------------------------------------------

  /**
   * Abort any running dispatch and clear all dispatch state.
   *
   * The owner count is deliberately NOT cleared: owners release themselves in
   * their own `finally`, and zeroing the count here would report "settled"
   * while a parked owner is still running, firing the reconciliation sweep
   * against its clusters.
   */
  reset = (): void => {
    this.aborted = true;
    this.setState({
      isDispatching: false,
      progress: null,
      partialResults: [],
      data: null,
      failedClusterIds: new Map(),
      enqueuedClusterIds: EMPTY_SET,
      inFlightClusterIds: EMPTY_SET,
      dispatchedAndResolvedClusterIds: EMPTY_SET,
    });
  };

  /**
   * Test-only: clear everything INCLUDING the owner count and the active
   * dispatch count, so one test's leftovers cannot leak into the next through
   * the module singleton. Never call this from app code — zeroing the owner
   * count while an owner is parked reports "settled" too early.
   */
  resetForTests = (): void => {
    this.aborted = false;
    this.activeDispatches = 0;
    this.state = INITIAL_STATE;
    for (const listener of this.listeners) listener();
  };

  // -- the network primitive ------------------------------------------------

  /**
   * POST one batch. The ONLY place this module talks to the suggestions
   * endpoint, so every path shares one timeout and one error translation.
   */
  private async postBatch(payload: PlaceSuggestionCluster[]): Promise<PlaceSuggestionResponse> {
    const response = await api.post(
      '/photos/suggest-places',
      { clusters: payload },
      { timeout: SUGGEST_PLACES_TIMEOUT_MS }
    );
    return response.data as PlaceSuggestionResponse;
  }

  /**
   * Dispatch a single already-claimed batch (the manual-split and retry paths).
   *
   * Preparation is awaited inside so the claim covers it. On a response the
   * clusters are marked dispatched-and-resolved and partitioned into responded
   * vs unresolved; on a throw nothing is marked and the error propagates for
   * the caller's own policy (Alert on the split path, re-attribution on retry).
   */
  dispatchBatch = async (params: {
    clusterIds: string[];
    prepare: () => Promise<PlaceSuggestionCluster[]>;
  }): Promise<SuggestionBatchOutcome> => {
    const payload = await params.prepare();
    const response = await this.postBatch(payload);
    this.markResolved(params.clusterIds);

    const respondedIds = new Set(response.suggestions.map((s) => s.cluster_id));
    const unresolvedIds = params.clusterIds.filter((id) => !respondedIds.has(id));
    return { response, respondedIds, unresolvedIds };
  };

  // -- the chunked main dispatch -------------------------------------------

  /**
   * Chunked dispatch of a candidate's uncached clusters.
   *
   * Owns: batch planning, per-batch claiming, abort between batches, progress
   * accounting, partial-result publication, and failure attribution. Resolves
   * with the aggregate result; re-throws only the two FATAL errors (quota 503
   * with Retry-After, 429), and only after attributing every still-un-responded
   * cluster so a rejected dispatch never drops them silently.
   */
  dispatch = async (
    request: ChunkedPlaceSuggestionRequest
  ): Promise<ChunkedPlaceSuggestionResult> => {
    const clusters = request.clusters;
    const totalClusters = clusters.length;
    const chunks = planSuggestionBatches(clusters);
    const allSuggestions: ClusterSuggestion[] = [];
    const chunkResponseTimes: number[] = [];
    let failedChunkCount = 0;
    let failedClusterCount = 0;
    // U15: stamped once, when the first batch that actually carries a
    // suggestion lands. An empty batch paints nothing, so it does not count.
    let firstSuggestionAt: number | null = null;

    this.aborted = false;
    this.activeDispatches += 1;
    // Per-dispatch preparation pipeline (U5/KTD10): serialized, one batch ahead.
    const startPreparing = createBatchPreparer(request.prepareBatch);

    // Local accumulator mirrored into state — avoids losing entries to React
    // state batching across the batch loop and the fatal re-throw path.
    const failedIds: FailedClusterIds = new Map();
    const recordFailedClusters = (batch: { id: string }[], retryDisabled: boolean) => {
      for (const cluster of batch) {
        failedIds.set(cluster.id, { retryDisabled });
      }
      this.setState({ failedClusterIds: new Map(failedIds) });
    };
    // Ids this run dispatched and got a response for (R20).
    const resolvedIds = new Set<string>();

    this.setState({
      isDispatching: true,
      data: null,
      partialResults: [],
      failedClusterIds: new Map(),
      progress: {
        clustersTotal: totalClusters,
        clustersCompleted: 0,
        percentage: 0,
        failedChunks: 0,
        failedClusters: 0,
      },
    });
    // Every cluster is ACCEPTED up front, so each is a pending row from the
    // first frame — not only the ~2 in the opening batch (KTD7/R10).
    this.enqueue(clusters.map((c) => c.id));

    try {
      // ── Pipelined preparation (U5/R5) ────────────────────────────────
      // Preparation runs ONE batch ahead of dispatch: batch N's request is in
      // flight while batch N+1 is being encoded, instead of every batch being
      // prepared before the first request goes out.
      let pendingPayload: Promise<PlaceSuggestionCluster[]> | null =
        chunks.length > 0 ? startPreparing(chunks[0]) : null;

      for (let i = 0; i < chunks.length; i++) {
        if (this.aborted) break;

        const chunk = chunks[i];
        const chunkIds = chunk.map((c) => c.id);
        const clustersProcessed = chunks.slice(0, i).reduce((sum, c) => sum + c.length, 0);

        // Kick off the NEXT batch's preparation before waiting on this one's
        // payload, so it overlaps this batch's round trip. Exactly one batch is
        // prepared ahead, so at most the in-flight batch and its successor hold
        // encoded payloads.
        const payloadPromise = pendingPayload;
        pendingPayload = i + 1 < chunks.length ? startPreparing(chunks[i + 1]) : null;

        this.setState({
          progress: {
            clustersTotal: totalClusters,
            clustersCompleted: clustersProcessed,
            percentage: Math.round((clustersProcessed / totalClusters) * 100),
            failedChunks: failedChunkCount,
            failedClusters: failedClusterCount,
          },
        });

        // Wait only for THIS batch's payload. `startPreparing` never rejects,
        // so a preparation failure degrades to a vision-less dispatch rather
        // than failing the batch.
        let payload: PlaceSuggestionCluster[] | null = payloadPromise
          ? await payloadPromise
          : chunk;

        const claimedIds = this.claim(chunkIds);
        const chunkStartTime = Date.now();
        try {
          const request$ = this.postBatch(payload);
          // The base64 vision images are by far the largest allocation in this
          // loop. Drop our reference the moment the request is issued so an
          // already-dispatched batch is not pinned for the whole round trip or
          // across the batches that follow it.
          payload = null;
          const responseData = await request$;
          chunkResponseTimes.push(Date.now() - chunkStartTime);

          // Positive evidence: a response covering this batch arrived (R20).
          for (const id of chunkIds) resolvedIds.add(id);
          this.markResolved(chunkIds);

          const suggestions = responseData.suggestions;
          const chunkFailedClusters = responseData.failed_cluster_count ?? 0;
          failedClusterCount += chunkFailedClusters;
          if (firstSuggestionAt === null && suggestions.length > 0) {
            firstSuggestionAt = Date.now();
          }
          if (__DEV__) {
            console.log(
              `[PhotoImport] Chunk ${i + 1}/${chunks.length}: received ${suggestions.length} suggestions in ${Date.now() - chunkStartTime}ms` +
                (chunkFailedClusters > 0 ? `, ${chunkFailedClusters} clusters timed out` : ''),
              suggestions.map((s) => ({
                clusterId: s.cluster_id,
                placeCount: s.places?.length ?? 0,
                topPlace: s.places?.[0]?.name ?? 'none',
              }))
            );
          }
          allSuggestions.push(...suggestions);
          // Publish for immediate display.
          this.setState({ partialResults: [...allSuggestions] });
        } catch (error) {
          chunkResponseTimes.push(Date.now() - chunkStartTime);
          // Re-throw fatal errors (quota exhausted, rate limited). Before
          // re-throwing, record every still-un-responded cluster — the current
          // chunk plus every chunk not yet dispatched — as lookup-failed with
          // retry DISABLED (KTD10). Without this a rejected dispatch would drop
          // those clusters entirely.
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
          // silently rendering them as photos-only "No place found".
          recordFailedClusters(chunk, false);
          failedChunkCount++;
          if (__DEV__) {
            console.warn(`[PhotoImport] Chunk ${i + 1} failed, continuing...`, error);
          }
        } finally {
          this.releaseClaim(claimedIds);
        }
      }

      // Mark complete with final failure count (skip if aborted)
      if (!this.aborted) {
        this.setState({
          progress: {
            clustersTotal: totalClusters,
            clustersCompleted: totalClusters,
            percentage: 100,
            failedChunks: failedChunkCount,
            failedClusters: failedClusterCount,
          },
        });
      }

      const result: ChunkedPlaceSuggestionResult = {
        suggestions: allSuggestions,
        failed_cluster_count: failedClusterCount,
        chunkResponseTimes,
        failedClusterIds: new Map(failedIds),
        firstSuggestionAt,
        dispatchedAndResolvedIds: resolvedIds,
      };
      this.setState({ data: result });
      return result;
    } catch (error) {
      // Mirrors the retired mutation's `onError`: progress is cleared, while
      // `failedClusterIds` survives so the UI can still surface every dropped
      // cluster as lookup-failed.
      this.setState({ progress: null });
      throw error;
    } finally {
      this.activeDispatches = Math.max(0, this.activeDispatches - 1);
      this.setState({ isDispatching: this.activeDispatches > 0 });
    }
  };
}

/**
 * Build a per-dispatch batch preparer (U5/R5, KTD10).
 *
 * Preparations are CHAINED onto a single tail rather than started in parallel,
 * so the number of concurrent on-device preparation workers is unchanged —
 * Expo's async function queue is serial at the native layer, so extra workers
 * buy no parallelism and only deepen a queue shared with other modules.
 *
 * The returned function never rejects: a preparation failure falls back to the
 * un-prepared batch, which still dispatches (without vision images) rather than
 * being dropped. Failure attribution therefore only ever deals with network
 * errors.
 *
 * The tail is per dispatch, not per controller, so two overlapping dispatches
 * cannot serialize behind each other.
 */
function createBatchPreparer(
  prepare?: (batch: PlaceSuggestionCluster[]) => Promise<PlaceSuggestionCluster[]>
): (batch: PlaceSuggestionCluster[]) => Promise<PlaceSuggestionCluster[]> {
  let prepareTail: Promise<unknown> = Promise.resolve();

  return (batch) => {
    if (!prepare) return Promise.resolve(batch);
    const run = prepareTail.then(
      () => prepare(batch),
      () => prepare(batch)
    );
    prepareTail = run.then(
      () => undefined,
      () => undefined
    );
    return run.catch((error) => {
      if (__DEV__) {
        console.warn('[PhotoImport] Batch preparation failed, dispatching without it', error);
      }
      return batch;
    });
  };
}

/**
 * The singleton. Module-level so dispatch state survives navigation away from
 * the photo import screen and back (KTD21).
 */
export const suggestionDispatch = new SuggestionDispatchController();
