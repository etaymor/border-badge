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
 * CONCURRENCY (U6/R6): dispatch runs a BOUNDED WORKER POOL over the batch plan.
 * The pool size is `SUGGESTION_DISPATCH_CONCURRENCY`, which ships at 1 — see the
 * derivation on that constant. Everything the pool touches is per batch and
 * order-independent, and the completion counter is a running total of SETTLED
 * batches rather than a function of the loop index, so raising the constant does
 * not regress progress or misattribute failures.
 *
 * LIFECYCLE (U9/R15): `pause()` / `resume()` are the third state alongside
 * running and aborted. Pause stops NEW batches (and new preparation) while
 * leaving the wire alone, so a backgrounded import stops spending requests
 * without throwing away the ones about to land; the workers park instead of
 * exiting, which keeps the dispatch — and therefore its owner slot — unsettled
 * for as long as the app is away. `reset()` remains the destructive one: it
 * aborts.
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
 * Upper bound on the client dispatch pool, independent of what the derivation
 * below returns.
 *
 * The backend caps a burst of suggestion requests and answers an over-burst with
 * a 429 carrying a SHORT `Retry-After` (U7/U16). A client pool wider than that
 * cap converts throughput into rate-limit rejections, and under KTD6 a rejection
 * stops dispatch entirely — so an over-wide pool is strictly worse than a narrow
 * one. Three is the widest pool that stays inside the burst cap for the batch
 * sizes this module plans.
 */
export const MAX_SUGGESTION_DISPATCH_CONCURRENCY = 3;

/**
 * Derive the dispatch pool size from measured per-batch costs.
 *
 * Steady-state time per batch is
 *
 *     t(C) = max(prepareMs, networkMs / C)
 *
 * because on-device preparation is SERIAL (KTD10 — Expo's async function queue
 * is serial at the native layer, so N dispatch workers still share one preparer)
 * while the network half divides by the pool size. `t` therefore falls with C
 * only until `networkMs / C` drops to `prepareMs`; past that knee the pipeline is
 * preparation-bound and extra workers buy nothing but memory and rate-limit
 * exposure. The knee is at
 *
 *     C* = ceil(networkMs / prepareMs)
 *
 * Exported so the number can be RE-DERIVED from real measurements rather than
 * re-guessed: feed it the measured per-batch preparation and network times.
 */
export function deriveDispatchConcurrency(prepareMs: number, networkMs: number): number {
  if (!(prepareMs > 0) || !(networkMs > 0)) return 1;
  const knee = Math.ceil(networkMs / prepareMs);
  return Math.min(Math.max(1, knee), MAX_SUGGESTION_DISPATCH_CONCURRENCY);
}

/**
 * How many suggestion batches may be on the wire at once.
 *
 * SHIPPED AT 1 — sequential behavior — DELIBERATELY.
 *
 * `deriveDispatchConcurrency` above says what this SHOULD be, but it needs two
 * numbers nobody has yet: the per-batch on-device preparation time and the
 * per-batch network time, measured on a real device on a trip of roughly 100
 * uncached clusters. Until those land, concurrency's own contribution cannot be
 * separated from the preparation-pipelining and vision-batching wins that landed
 * alongside it, so the pool ships closed and the rest of U6 (abort, partial
 * resolution, the cache-write allow-list, coverage-aware re-entry) ships open.
 *
 * BEFORE RAISING THIS, measure on device, cold-cache, at roughly 100 uncached
 * clusters and again on the largest realistic trip:
 *  1. per-batch preparation ms and per-batch network ms — feed them to
 *     `deriveDispatchConcurrency` and use what it returns, capped by
 *     `MAX_SUGGESTION_DISPATCH_CONCURRENCY`;
 *  2. total wall-clock matching time against the same trip at concurrency 1 —
 *     it must be at least 30% lower, or the pool is not paying for itself;
 *  3. failed-cluster count and vision-null rate — neither may be higher than at
 *     concurrency 1;
 *  4. per-batch time — below 1.3x the concurrency-1 batch time, otherwise the
 *     backend is the bottleneck and the pool is just queueing;
 *  5. top-ranked place per cluster — identical to concurrency 1;
 *  6. peak outbound request rate — below the Google Places quota in requests per
 *     minute, and inside the backend's burst cap (see
 *     `MAX_SUGGESTION_DISPATCH_CONCURRENCY`).
 *
 * This is a plain module constant in the JS bundle on purpose: it can be raised,
 * lowered, or rolled back over the air with an EAS Update, with no native build
 * and independently of every other change in this area.
 */
export const SUGGESTION_DISPATCH_CONCURRENCY = 1;

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

/**
 * Fallback wait when a 429 carries no usable `Retry-After` (U16).
 *
 * Only ever used for a 429 from an intermediary: the backend's own limiter
 * always sends the header — 1s for the burst cap, 60s for the sustained one —
 * so a real wait is never guessed.
 */
export const DEFAULT_RETRY_AFTER_SECONDS = 60;

/**
 * Read a `Retry-After` header value as whole seconds, falling back to
 * `DEFAULT_RETRY_AFTER_SECONDS` when it is missing or unparseable.
 */
export function parseRetryAfterSeconds(value: string | undefined | null): number {
  if (!value) return DEFAULT_RETRY_AFTER_SECONDS;
  const seconds = parseInt(value, 10);
  return isNaN(seconds) ? DEFAULT_RETRY_AFTER_SECONDS : seconds;
}

/**
 * Longest `Retry-After` (in seconds) the pool will PARK on and resume from,
 * rather than treating the rejection as the end of the import (U16).
 *
 * The backend answers an over-burst from its 5/second cap with that cap's own
 * window — ONE second — and a sustained-limit or cost-budget rejection with
 * sixty. Ending the whole dispatch on the mildest possible throttle is the most
 * destructive response available: on a 100-cluster import a 429 at batch 4 left
 * ~80 clusters never dispatched and every one of them rendered lookup-failed. A
 * wait this short is worth taking; a minute-long one is not, so the sustained
 * limit (and the quota 503, and the 402 entitlement stop) stay hard stops.
 */
export const MAX_PARKABLE_RETRY_AFTER_SECONDS = 5;

/**
 * How many short rate-limit parks ONE dispatch may take before it stops.
 *
 * A server answering 429 forever must not keep the pool cycling: past this the
 * rejection is not a momentary burst, so dispatch stops exactly as it does for
 * the sustained limit.
 */
export const MAX_RATE_LIMIT_PARKS = 3;

/**
 * Slice length for a rate-limit park (ms). The wait is served in slices so an
 * abort taken DURING it is observed promptly instead of a whole window later.
 */
const RATE_LIMIT_PARK_SLICE_MS = 250;

/** Error thrown when rate limited, includes retry delay */
export class RateLimitError extends Error {
  retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super(`Rate limited. Retry after ${retryAfterSeconds} seconds.`);
    this.name = 'RateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * Read the machine-readable `code` off an error response body, accepting BOTH
 * shapes the app can see.
 *
 * FastAPI's default `HTTPException` handler serializes a dict `detail` verbatim
 * under `detail`, so the backend's `HTTPException(402, detail={"code": ...})`
 * arrives as `{"detail": {"code": ...}}` — that is the wire contract, and the
 * backend's own test asserts `response.json()["detail"]["code"]`. Reading only
 * the top level made the entitlement branch below dead code in production while
 * hand-built client fixtures kept it green. The flat shape is still accepted:
 * a custom exception handler (or a proxy) may hoist the body, and being wrong
 * here costs a paid request that can never succeed.
 */
function readErrorCode(error: AxiosError): string | undefined {
  const body = error.response?.data as
    | { code?: string; detail?: { code?: string } | string }
    | undefined;
  const detail = body?.detail;
  if (detail && typeof detail !== 'string' && typeof detail.code === 'string') return detail.code;
  return typeof body?.code === 'string' ? body.code : undefined;
}

/** Error thrown when daily quota is exhausted */
export class QuotaExhaustedError extends Error {
  constructor() {
    super('Daily quota exhausted. Please try again tomorrow.');
    this.name = 'QuotaExhaustedError';
  }
}

/**
 * The server refused the batch because the account's photo-import entitlement is
 * spent (402 `PHOTO_IMPORT_LIMIT_REACHED`, U16).
 *
 * Kept DISTINCT from the transient failures on purpose: it is not a network
 * blip, retrying it buys nothing, and classifying it as transient would hand the
 * user a Retry button that can only ever fail. U10 owns the surfacing; this
 * module only has to stop dispatching and name it honestly.
 */
export class PhotoImportLimitReachedError extends Error {
  constructor() {
    super('This account has used its included photo import.');
    this.name = 'PhotoImportLimitReachedError';
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
  /**
   * Clusters this run actually put on the wire, whether or not their batch
   * answered (U6/KTD6).
   *
   * The COVERAGE set, and distinct from `dispatchedAndResolvedIds`: a batch that
   * threw is dispatched-but-unresolved, while a batch that a fatal stop or an
   * abort prevented from ever going out is neither. The caller uses this to
   * decide whether the candidate was fully attempted — marking a candidate
   * "fetched" after a partial stop is what makes a same-session re-entry
   * short-circuit and leave the undispatched clusters unlooked-up forever.
   */
  dispatchedClusterIds: Set<string>;
  /**
   * True when dispatch stopped before every planned batch went out (KTD6):
   * a fatal rejection or an abort. `dispatchedClusterIds` says which clusters
   * that cost.
   */
  isPartial: boolean;
  /**
   * The rejection that STOPPED dispatch, or null (KTD6).
   *
   * `dispatch` no longer throws for these. The old fatal re-throw had to
   * attribute "this batch plus everything after it" using the loop index as a
   * dispatch frontier — an idea concurrency destroys — and it threw away the
   * results of batches that had already succeeded. The error is reported here
   * instead so the caller can keep its per-error-type analytics branch while the
   * successful batches still resolve, cache, and paint.
   */
  fatalError: Error | null;
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
  /**
   * Pool size override, defaulting to `SUGGESTION_DISPATCH_CONCURRENCY`.
   *
   * For tests and benchmark harnesses that need to compare concurrency levels
   * within one build. App code does NOT pass this — production concurrency is
   * the module constant, so it stays a single over-the-air lever.
   */
  concurrency?: number;
  /**
   * ADDITIVE run: this dispatch is a RETRY of clusters an earlier run left
   * unfinished (U9 bulk retry), not a fresh candidate fetch.
   *
   * A fresh run clears `partialResults`, `data` and `failedClusterIds` because
   * it owns the whole screen. A bulk retry owns only the clusters it was handed:
   * clearing would wipe every already-matched row (they live in
   * `partialResults` / `data`, not in the caller's cached-suggestion state) and
   * would drop the retry-DISABLED failures it is deliberately not retrying,
   * turning them into pending rows that never resolve. So this seeds from the
   * current state and removes only the retried clusters' failure entries.
   */
  isRetry?: boolean;
  /**
   * The trip being matched (U16/R17). Sent in every batch body so the server can
   * exempt a trip that already consumed the caller's free photo import.
   */
  tripId?: string | null;
  /**
   * Called SYNCHRONOUSLY the moment a batch comes back successfully, before any
   * further await (U10/R16).
   *
   * This is the entitlement hook: the free import is charged on the first
   * successful batch, not at the end of the fetch, because progressive results
   * make a partial import the normal case. Called for EVERY successful batch —
   * the caller owns the once-only claim, and owning it there rather than here
   * keeps it correct across the several dispatches one import can involve.
   *
   * A throwing callback is swallowed: entitlement accounting must never take a
   * batch down with it.
   */
  onBatchSuccess?: () => void;
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
 * Concurrency telemetry (U11/R18).
 *
 * Everything here is a COUNT or a DURATION. No cluster id, coordinate, geohash
 * or place id is recorded, so the whole object is safe to hand to analytics
 * verbatim (R27).
 *
 * Scope: reset by a fresh (non-retry) main dispatch, so one object describes one
 * candidate's matching run plus every retry that repairs it. Survives `reset()`
 * on purpose — the exit event reads it after the user has navigated away, and
 * `reset()` runs on exactly that path.
 */
export interface DispatchTelemetry {
  /** Most batches simultaneously on the wire. */
  peakInFlightBatches: number;
  /** Time-weighted mean batches on the wire across the dispatch span. */
  meanInFlightBatches: number;
  /** Milliseconds with at least one batch on the wire. */
  wireBusyMs: number;
  /** Milliseconds from the first batch leaving to the last one settling. */
  wireSpanMs: number;
  /** Retry batch attempts summed over every generation. */
  retryAttempts: number;
  /** Generations that issued at least one retry attempt. */
  retryGenerations: number;
  /** The largest retry-attempt count a single generation reached. */
  maxRetryAttemptsPerGeneration: number;
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
  /**
   * True while dispatch is PAUSED (U9/R15) — the app is backgrounded.
   *
   * Paused is NOT settled: the workers park instead of exiting, so the owner
   * slot stays claimed and the consumer's reconciliation sweep cannot fire
   * against clusters that were never given a chance to dispatch. It is also NOT
   * an abort: requests already on the wire keep running and their results still
   * publish and cache.
   */
  isPaused: boolean;
  /**
   * Which main dispatch the current `progress` describes (U6).
   *
   * Bumped once per `dispatch()` call. Progress is a RUNNING TOTAL of settled
   * batches within a generation, so it never decreases while that generation
   * runs; a later generation (a re-entry, or U9's bulk retry) starts its own
   * denominator instead of rewinding this one, and a straggler batch from an
   * older generation cannot write progress at all.
   */
  dispatchGeneration: number;
}

const EMPTY_SET: ReadonlySet<string> = new Set();

/**
 * Copy a cluster set with `ids` added. Always a NEW set, never a mutation: the
 * sets live in the snapshot React compares by identity, so growing one in place
 * would leave subscribers on a stale render.
 */
function setWith(base: ReadonlySet<string>, ids: Iterable<string>): Set<string> {
  const next = new Set(base);
  for (const id of ids) next.add(id);
  return next;
}

/**
 * What a scoped batch resolves to when an abort cancels it before it goes out.
 *
 * Nothing responded, so nothing may be cached — and `failed_cluster_count`
 * deliberately carries the batch size: the split path treats a ZERO count as
 * "every cluster was answered" and would otherwise write an empty cache row for
 * a batch that never left the device (R20/KTD14).
 */
function abortedBatchOutcome(clusterIds: string[]): SuggestionBatchOutcome {
  return {
    response: { suggestions: [], failed_cluster_count: clusterIds.length },
    respondedIds: new Set<string>(),
    unresolvedIds: [...clusterIds],
  };
}

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
  isPaused: false,
  dispatchGeneration: 0,
};

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

class SuggestionDispatchController {
  private state: SuggestionDispatchState = INITIAL_STATE;

  private listeners = new Set<() => void>();

  /**
   * Set once `reset()` runs, so a dispatch worker already past its abort check
   * stops before issuing the next batch. Cleared when a new dispatch starts.
   *
   * A flag alone was only ever sufficient because dispatch was sequential: it is
   * checked BETWEEN batches, so with several batches on the wire it would leave
   * every one of them running to completion after the user navigated away. The
   * `AbortController`s below are what actually cancel them (U6).
   *
   * It is also SHARED, and a new dispatch clears it — so every check pairs it
   * with the checker's own generation (`currentGeneration`). Without that, a
   * worker parked in a long preparation across a `reset()` wakes to a cleared
   * flag and resumes on behalf of a candidate the user has left.
   */
  private aborted = false;

  /**
   * The live per-batch abort controllers — the claim record for a batch on the
   * wire. `reset()` aborts every one of them, so an abort cancels in-flight
   * requests instead of waiting for them.
   */
  private activeAborts = new Set<AbortController>();

  /**
   * Set while the app is backgrounded (U9/R15). Workers PARK on it rather than
   * exiting, which is the whole difference from `aborted`: a paused dispatch is
   * still running, still holds its owner slot, and resumes exactly where it
   * stopped.
   */
  private paused = false;

  /** Resolvers for every worker currently parked on `paused`. */
  private resumeWaiters = new Set<() => void>();

  /** Number of chunked main dispatches currently running. */
  private activeDispatches = 0;

  /** Monotonic id of the newest main dispatch (see `dispatchGeneration`). */
  private currentGeneration = 0;

  // -- concurrency telemetry (U11/R18) --------------------------------------
  //
  // Occupancy is accumulated as an INTEGRAL over time rather than sampled: a
  // sampler would have to run on a timer through a screen that is deliberately
  // idle between batches, and would miss exactly the short spikes that say
  // whether the pool is being used. Every transition of the wire already passes
  // through `addActiveAbort` / `removeActiveAbort`, so integrating there is both
  // exact and free.

  /** `Date.now()` of the last occupancy transition, or 0 before the first batch. */
  private wireLastChangeAt = 0;

  /** `Date.now()` of the first batch of this measurement window leaving. */
  private wireSpanStartedAt = 0;

  /** Σ (batches on the wire × ms at that count). */
  private wireWeightedMs = 0;

  /** Σ ms with at least one batch on the wire. */
  private wireBusyMs = 0;

  /** High-water mark of `activeAborts.size`. */
  private peakInFlightBatches = 0;

  /**
   * Retry batch attempts keyed by `dispatchGeneration` (U6's note: the
   * generation is the natural key). A bulk retry bumps the generation, so its
   * attempts land on their own key; a per-row retry runs inside the generation
   * it repairs, which is what makes "retries this generation needed" readable.
   */
  private retryAttemptsByGeneration = new Map<number, number>();

  // -- subscription --------------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getState = (): SuggestionDispatchState => this.state;

  // -- concurrency telemetry (U11/R18) --------------------------------------

  /**
   * How many batches are on the wire right now.
   *
   * Deliberately exposed rather than re-derived by the caller: the abort-
   * controller set IS the record of what is outstanding, and a second counter
   * kept alongside it would be a second thing to keep correct across abort,
   * pause and partial resolution.
   */
  getInFlightBatchCount = (): number => this.activeAborts.size;

  /** Snapshot of the concurrency telemetry (U11/R18). Never carries an id. */
  getTelemetry = (): DispatchTelemetry => {
    // Fold in the time since the last transition so a snapshot taken mid-flight
    // is not systematically short by the current interval.
    const now = Date.now();
    const inFlight = this.activeAborts.size;
    const openMs = this.wireLastChangeAt > 0 ? now - this.wireLastChangeAt : 0;
    const weightedMs = this.wireWeightedMs + inFlight * openMs;
    const busyMs = this.wireBusyMs + (inFlight > 0 ? openMs : 0);
    const spanMs =
      this.wireSpanStartedAt > 0
        ? Math.max(0, (inFlight > 0 ? now : this.wireLastChangeAt) - this.wireSpanStartedAt)
        : 0;

    let retryAttempts = 0;
    let maxRetryAttemptsPerGeneration = 0;
    for (const count of this.retryAttemptsByGeneration.values()) {
      retryAttempts += count;
      if (count > maxRetryAttemptsPerGeneration) maxRetryAttemptsPerGeneration = count;
    }

    return {
      peakInFlightBatches: this.peakInFlightBatches,
      // Rounded to 2dp: this is an occupancy ratio read against a pool size of
      // 1-3, so more precision is noise.
      meanInFlightBatches: spanMs > 0 ? Math.round((weightedMs / spanMs) * 100) / 100 : 0,
      wireBusyMs: busyMs,
      wireSpanMs: spanMs,
      retryAttempts,
      retryGenerations: this.retryAttemptsByGeneration.size,
      maxRetryAttemptsPerGeneration,
    };
  };

  /**
   * Record a retry batch attempt against the CURRENT generation (U11/R18).
   *
   * Called by the retry paths rather than inferred here, because "is this batch
   * a repair?" is the caller's knowledge: the controller sees an ordinary batch
   * either way.
   */
  recordRetryAttempt = (): void => {
    const generation = this.currentGeneration;
    this.retryAttemptsByGeneration.set(
      generation,
      (this.retryAttemptsByGeneration.get(generation) ?? 0) + 1
    );
  };

  /** Start a fresh telemetry window. Called by a non-retry main dispatch. */
  private resetTelemetry(): void {
    this.wireLastChangeAt = 0;
    this.wireSpanStartedAt = 0;
    this.wireWeightedMs = 0;
    this.wireBusyMs = 0;
    this.peakInFlightBatches = 0;
    this.retryAttemptsByGeneration.clear();
  }

  /** Integrate occupancy up to now, then apply the transition. */
  private accrueOccupancy(): void {
    const now = Date.now();
    if (this.wireLastChangeAt === 0) {
      this.wireLastChangeAt = now;
      if (this.wireSpanStartedAt === 0) this.wireSpanStartedAt = now;
      return;
    }
    const elapsed = now - this.wireLastChangeAt;
    const inFlight = this.activeAborts.size;
    this.wireWeightedMs += inFlight * elapsed;
    if (inFlight > 0) this.wireBusyMs += elapsed;
    this.wireLastChangeAt = now;
  }

  /** Put a batch on the wire, keeping the occupancy integral exact. */
  private addActiveAbort(controller: AbortController): void {
    this.accrueOccupancy();
    this.activeAborts.add(controller);
    if (this.activeAborts.size > this.peakInFlightBatches) {
      this.peakInFlightBatches = this.activeAborts.size;
    }
  }

  /** Take a batch off the wire, keeping the occupancy integral exact. */
  private removeActiveAbort(controller: AbortController): void {
    this.accrueOccupancy();
    this.activeAborts.delete(controller);
  }

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

  // -- lifecycle pause / resume (U9 / R15 / KTD19) --------------------------

  /**
   * Stop handing out NEW batches without cancelling anything.
   *
   * Called when the app backgrounds. Deliberately NOT `reset()`: `reset()`
   * aborts every request on the wire and clears the candidate's state, which
   * would throw away batches that are seconds from landing and can still be
   * written to the suggestion cache. Pause is the "take nothing new" half on its
   * own — the same shape as the fatal-stop flag inside `dispatch`, promoted to
   * controller state so an app-root lifecycle hook can reach it (KTD19).
   *
   * Preparation stops too: re-encoding vision payloads for batches that cannot
   * go out burns the serial native queue and pins their memory for the whole
   * background window.
   */
  pause = (): void => {
    if (this.paused) return;
    this.paused = true;
    this.setState({ isPaused: true });
  };

  /**
   * Release every parked worker. Idempotent, so a foreground event that never
   * had a matching background (an `inactive` blip) costs nothing.
   *
   * Resume does NOT dispatch the whole remaining plan at once: the workers wake
   * back into the same bounded pool, so at most `concurrency` batches go on the
   * wire, and the rest follow as those settle.
   */
  resume = (): void => {
    if (!this.paused) return;
    this.paused = false;
    this.setState({ isPaused: false });
    this.releaseParkedWorkers();
  };

  private releaseParkedWorkers(): void {
    if (this.resumeWaiters.size === 0) return;
    const waiters = [...this.resumeWaiters];
    this.resumeWaiters.clear();
    for (const wake of waiters) wake();
  }

  /**
   * Park until `resume()` (or an abort) wakes us. Only ever awaited while
   * `paused` is true, so an ordinary dispatch pays no extra microtask per batch.
   */
  private awaitResume(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.resumeWaiters.add(resolve);
    });
  }

  // -- cluster claiming (KTD7) ---------------------------------------------

  /**
   * Accept clusters for dispatch WITHOUT marking them in flight. Used by the
   * chunked main dispatch, which accepts every uncached cluster up front (so
   * each is immediately a pending row, R10) but only puts one batch on the wire
   * at a time.
   */
  private enqueue(ids: string[]): void {
    if (ids.length === 0) return;
    this.setState({ enqueuedClusterIds: setWith(this.state.enqueuedClusterIds, ids) });
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
    // Both sets grow, and they stay SEPARATE (KTD7): in-flight drives claim
    // deduplication, enqueued drives pending rows.
    this.setState({
      inFlightClusterIds: setWith(this.state.inFlightClusterIds, claimed),
      enqueuedClusterIds: setWith(this.state.enqueuedClusterIds, claimed),
    });
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
    this.setState({
      dispatchedAndResolvedClusterIds: setWith(this.state.dispatchedAndResolvedClusterIds, ids),
    });
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
    // Cancel what is on the wire rather than letting it run to completion. With
    // a pool this matters: several requests can be outstanding, and each one
    // that lands after a reset would otherwise re-publish state for a candidate
    // the user has already left.
    for (const controller of this.activeAborts) controller.abort();
    // Close the occupancy interval BEFORE emptying the set, or the aborted
    // batches' final interval is credited at occupancy zero. The telemetry
    // window itself survives: the exit event reads it after this runs.
    this.accrueOccupancy();
    this.activeAborts.clear();
    // A parked worker (U9) would otherwise never observe the abort and its
    // dispatch promise would never settle. Waking it lets it see `aborted` and
    // return. The pause flag itself SURVIVES a reset: the app is still
    // backgrounded, so the next dispatch must not start firing either.
    this.releaseParkedWorkers();
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
    this.currentGeneration = 0;
    this.activeAborts.clear();
    this.paused = false;
    this.resetTelemetry();
    this.releaseParkedWorkers();
    this.state = INITIAL_STATE;
    for (const listener of this.listeners) listener();
  };

  // -- the network primitive ------------------------------------------------

  /**
   * POST one batch. The ONLY place this module talks to the suggestions
   * endpoint, so every path shares one timeout and one error translation.
   */
  private async postBatch(
    payload: PlaceSuggestionCluster[],
    tripId?: string | null,
    signal?: AbortSignal
  ): Promise<PlaceSuggestionResponse> {
    const response = await api.post(
      '/photos/suggest-places',
      // U16/R17: `trip_id` is what lets the server match the exemption for a
      // trip that already consumed the free import. Omitting it makes a
      // consumed free user look over-entitled and gets the batch rejected 402.
      { clusters: payload, ...(tripId ? { trip_id: tripId } : {}) },
      { timeout: SUGGEST_PLACES_TIMEOUT_MS, signal }
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
    /** The trip being matched (U16/R17). Sent so the server can honor R17. */
    tripId?: string | null;
    /**
     * This batch is a REPAIR of clusters an earlier attempt failed (U11/R18).
     * Counted against the current generation's retry tally. Purely telemetry —
     * it changes nothing about how the batch is dispatched.
     */
    isRetry?: boolean;
  }): Promise<SuggestionBatchOutcome> => {
    if (params.isRetry) this.recordRetryAttempt();
    // Which run this scoped batch belongs to. The `aborted` flag alone is not a
    // sufficient guard: a later `dispatch()` clears it, so a batch parked or
    // preparing across a `reset()` would wake to `aborted === false` and post
    // for a candidate the user has already left.
    const generation = this.currentGeneration;
    const isStopped = () => this.aborted || generation !== this.currentGeneration;

    // U9/R15: a scoped batch is a NEW request exactly like a pooled one, so it
    // must not go out while the app is backgrounded. Park rather than exit, so
    // the split/retry the user asked for still happens when they come back.
    while (this.paused && !isStopped()) {
      await this.awaitResume();
    }
    if (isStopped()) return abortedBatchOutcome(params.clusterIds);

    const payload = await params.prepare();
    // Preparation is seconds of vision encoding — long enough for a `reset()`
    // to land inside it. Nothing paid may be bought after that.
    if (isStopped()) return abortedBatchOutcome(params.clusterIds);

    // A REAL abort controller, registered like the pool's (U6): without one
    // `reset()` could not cancel a split or a per-row retry, and neither showed
    // up in the occupancy telemetry that is supposed to describe the wire.
    const abortController = new AbortController();
    this.addActiveAbort(abortController);
    try {
      const response = await this.postBatch(payload, params.tripId, abortController.signal);
      // Skip the claim-set write for a departed candidate: `reset()` cleared
      // these sets and repopulating them resurrects its rows.
      if (!isStopped()) this.markResolved(params.clusterIds);

      const respondedIds = new Set(response.suggestions.map((s) => s.cluster_id));
      const unresolvedIds = params.clusterIds.filter((id) => !respondedIds.has(id));
      return { response, respondedIds, unresolvedIds };
    } finally {
      this.removeActiveAbort(abortController);
    }
  };

  // -- the chunked main dispatch -------------------------------------------

  /**
   * Chunked dispatch of a candidate's uncached clusters, through a BOUNDED
   * WORKER POOL (U6/R6).
   *
   * Owns: batch planning, per-batch claiming, per-batch abort, progress
   * accounting, partial-result publication, and failure attribution.
   *
   * PARTIAL RESOLUTION (KTD6). A fatal rejection (quota 503 with Retry-After,
   * 429, 402 entitlement) no longer throws. It attributes ONLY the batch that
   * was rejected, stops handing out new batches, lets the batches already on the
   * wire land and keep their results, and resolves with `isPartial` and
   * `fatalError` set. The old behavior — attribute "this batch and everything
   * after it", then throw away every earlier batch's result — depended on the
   * loop index being a dispatch frontier, which a pool destroys: with three
   * workers, "later in the plan" says nothing about "not yet sent". Clusters the
   * stop prevented from ever going out are left UNATTRIBUTED on purpose; they
   * are still enqueued, so once every owner settles the consumer's
   * reconciliation sweep renders them `lookup-failed` with retry ENABLED, which
   * is the honest state for a cluster whose lookup was never attempted (R2).
   *
   * Safe only together with the cache-write allow-list (KTD14): a partial result
   * must never let a never-dispatched cluster be written as an empty cache row.
   */
  dispatch = async (
    request: ChunkedPlaceSuggestionRequest
  ): Promise<ChunkedPlaceSuggestionResult> => {
    const clusters = request.clusters;
    const totalClusters = clusters.length;
    const chunks = planSuggestionBatches(clusters);
    const concurrency = Math.max(
      1,
      Math.floor(request.concurrency ?? SUGGESTION_DISPATCH_CONCURRENCY)
    );
    // U9: a bulk retry ACCUMULATES onto the run it is repairing. Seeding from
    // the live partial results is what keeps the already-matched rows on screen
    // — and what makes the final `data` carry them too, since the list reads
    // `data.suggestions` once dispatching stops.
    const isRetry = request.isRetry === true;
    const allSuggestions: ClusterSuggestion[] = isRetry ? [...this.state.partialResults] : [];
    const chunkResponseTimes: number[] = [];
    let failedChunkCount = 0;
    let failedClusterCount = 0;
    // U15: stamped once, when the first batch that actually carries a
    // suggestion lands. An empty batch paints nothing, so it does not count.
    let firstSuggestionAt: number | null = null;
    // KTD6: the rejection that stopped dispatch, reported on the result instead
    // of thrown.
    let fatalError: Error | null = null;
    // Set alongside `fatalError`: workers finish what they hold and take nothing
    // new. Distinct from `aborted`, which cancels what is already on the wire.
    let stopDispatching = false;

    this.aborted = false;
    this.activeDispatches += 1;
    this.currentGeneration += 1;
    const generation = this.currentGeneration;
    /**
     * Has THIS run been stopped?
     *
     * `aborted` is one shared flag and `dispatch()` clears it at entry, so a
     * worker parked in a long `await entry.payload` when `reset()` fired would
     * wake AFTER a new dispatch cleared it, see `aborted === false`, and both
     * post a paid request for the departed candidate and overwrite the new
     * run's accumulators with its own. Pairing the flag with the generation is
     * what makes every check ask about this run rather than about the module.
     */
    const isStopped = () => this.aborted || generation !== this.currentGeneration;
    // U11/R18. A fresh run opens a new measurement window; a bulk retry is a
    // repair OF that window and accumulates into it, which is what makes
    // "retries this import needed" answerable at exit.
    if (!isRetry) this.resetTelemetry();
    // Per-dispatch preparation pipeline (U5/KTD10): serialized, one batch ahead.
    const startPreparing = createBatchPreparer(request.prepareBatch);

    // Local accumulator mirrored into state — avoids losing entries to React
    // state batching across concurrent batches. A bulk retry seeds it with the
    // failures it is NOT retrying (retry-disabled ones, other candidates' rows)
    // so mirroring it into state stays a merge rather than a wipe.
    const failedIds: FailedClusterIds = new Map(isRetry ? this.state.failedClusterIds : undefined);
    if (isRetry) {
      for (const cluster of clusters) failedIds.delete(cluster.id);
    }
    const recordFailedClusters = (batch: { id: string }[], retryDisabled: boolean) => {
      // An aborted run has had its failure map cleared by `reset()`; re-writing
      // it here would resurrect a departed candidate's failures. A run the
      // generation has moved past is in exactly the same position.
      if (isStopped()) return;
      for (const cluster of batch) {
        failedIds.set(cluster.id, { retryDisabled });
      }
      this.setState({ failedClusterIds: new Map(failedIds) });
    };
    // Ids this run dispatched and got a response for (R20).
    const resolvedIds = new Set<string>();
    // Ids this run put on the wire at all — the coverage set (KTD6).
    const dispatchedIds = new Set<string>();

    // MONOTONIC within this generation: a running total of the clusters in
    // SETTLED batches. The previous formula summed the sizes of the batches
    // PRECEDING the loop index, which under concurrency both double-counts and
    // regresses — batch 3 finishing before batch 2 would publish "10 of 12" and
    // then "5 of 12".
    let clustersCompleted = 0;
    const publishProgress = () => {
      // A straggler from an older dispatch must not write this one's progress.
      if (isStopped()) return;
      this.setState({
        progress: {
          clustersTotal: totalClusters,
          clustersCompleted,
          percentage: totalClusters > 0 ? Math.round((clustersCompleted / totalClusters) * 100) : 0,
          failedChunks: failedChunkCount,
          failedClusters: failedClusterCount,
        },
      });
    };

    this.setState({
      isDispatching: true,
      data: null,
      partialResults: [...allSuggestions],
      failedClusterIds: new Map(failedIds),
      dispatchGeneration: generation,
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
      // ── Pipelined preparation (U5/R5, KTD10) ──────────────────────────
      // ONE serialized preparer feeds N dispatch workers: the native async
      // queue is serial, so more preparation workers buy no parallelism.
      // Preparation runs AHEAD of dispatch by `concurrency + 1` batches, which
      // is exactly the old "one batch ahead" at the shipped concurrency of 1.
      //
      // The bound is what caps peak payload memory: a slot is held from the
      // moment preparation is STARTED until the worker that took it is finished
      // with it, so at concurrency N at most N + 1 encoded payloads exist at
      // once. Releasing the slot when `await entry.payload` resolved — before
      // the worker had claimed, built its controller and posted — under-counted
      // it by up to `concurrency`, because the worker still held the payload
      // while another worker started a replacement.
      const prefetchDepth = concurrency + 1;
      const prepared: {
        index: number;
        batch: PlaceSuggestionCluster[];
        payload: Promise<PlaceSuggestionCluster[]>;
      }[] = [];
      let nextPrepIndex = 0;
      // Prepared but not yet posted. Bounds the queue AND the payloads workers
      // are holding between taking one and issuing its request.
      let payloadsAwaitingDispatch = 0;
      const pumpPreparation = () => {
        while (
          !isStopped() &&
          !stopDispatching &&
          // U9: don't encode payloads that cannot be sent. Preparation is serial
          // at the native layer, so preparing through a background window burns
          // the shared queue and pins the encoded images until we return.
          !this.paused &&
          payloadsAwaitingDispatch < prefetchDepth &&
          nextPrepIndex < chunks.length
        ) {
          const index = nextPrepIndex++;
          payloadsAwaitingDispatch += 1;
          prepared.push({ index, batch: chunks[index], payload: startPreparing(chunks[index]) });
        }
      };
      pumpPreparation();

      /**
       * U9/R15: park (never exit) while the app is backgrounded, so the plan is
       * resumed rather than abandoned and the owner slot stays claimed —
       * "paused" must not read as "settled" to the reconciliation sweep. Only
       * awaits when actually paused, so an ordinary run is unchanged.
       */
      const parkWhilePaused = async (): Promise<void> => {
        while (this.paused && !isStopped() && !stopDispatching) {
          await this.awaitResume();
        }
      };

      // U16: a burst-cap 429 asks for a wait measured in seconds, not for the
      // import to end. `rateLimitedUntil` is the window the whole pool waits
      // out; `rateLimitParks` bounds how many times one dispatch will do it, so
      // a server answering 429 forever cannot keep the pool cycling.
      let rateLimitedUntil = 0;
      let rateLimitParks = 0;
      const awaitRateLimitWindow = async (): Promise<void> => {
        for (;;) {
          const remainingMs = rateLimitedUntil - Date.now();
          if (remainingMs <= 0 || isStopped() || stopDispatching) return;
          // Served in slices so an abort taken during the wait is seen promptly.
          await new Promise<void>((resolve) => {
            setTimeout(resolve, Math.min(remainingMs, RATE_LIMIT_PARK_SLICE_MS));
          });
        }
      };

      const runWorker = async (): Promise<void> => {
        for (;;) {
          if (isStopped() || stopDispatching) return;
          if (this.paused) {
            await parkWhilePaused();
            if (isStopped() || stopDispatching) return;
          }
          // Refill first: `payloadsAwaitingDispatch` is strictly below
          // `prefetchDepth` whenever the queue is empty, so this can never
          // starve a worker while batches remain.
          pumpPreparation();
          const entry = prepared.shift();
          if (!entry) return;

          const chunk = entry.batch;
          const chunkIds = chunk.map((c) => c.id);

          // `startPreparing` never rejects, so a preparation failure degrades to
          // a vision-less dispatch rather than failing the batch.
          let payload: PlaceSuggestionCluster[] | null = await entry.payload;
          // The prefetch slot is released in the `finally` below — this worker
          // is still HOLDING the payload until then.
          try {
            if (isStopped() || stopDispatching) return;
            // A batch that finished preparing DURING the background window is
            // still a new request: hold it until we're foreground again.
            if (this.paused) {
              await parkWhilePaused();
              if (isStopped() || stopDispatching) return;
            }
            // ...and the same for a burst-cap window another worker ran into.
            await awaitRateLimitWindow();
            if (isStopped() || stopDispatching) return;

            // Honor the CLAIM, exactly as the scoped paths do. Posting the full
            // chunk while using the claim only for `releaseClaim` meant two
            // overlapping dispatches each re-bought every cluster from Google
            // Places and from vision.
            const claimedIds = this.claim(chunkIds);
            if (claimedIds.length === 0) {
              // Every cluster here is already on the wire from another path.
              // Nothing to send, but the batch still has to SETTLE so progress
              // reaches its denominator.
              clustersCompleted += chunk.length;
              publishProgress();
              continue;
            }
            const claimed = new Set(claimedIds);
            const claimedChunk = chunk.filter((c) => claimed.has(c.id));
            payload = payload.filter((c) => claimed.has(c.id));

            // A REAL abort controller per batch (U6). The `aborted` flag alone is
            // only checked between batches, which cancels nothing that is already
            // on the wire — and with a pool that is most of the work.
            const abortController = new AbortController();
            this.addActiveAbort(abortController);
            // U11/R18: a batch dispatched by a retry run is a retry attempt.
            if (isRetry) this.recordRetryAttempt();
            const chunkStartTime = Date.now();
            try {
              for (const id of claimedIds) dispatchedIds.add(id);
              const request$ = this.postBatch(payload, request.tripId, abortController.signal);
              // The base64 vision images are by far the largest allocation here.
              // Drop our reference the moment the request is issued so an
              // already-dispatched batch is not pinned for the whole round trip.
              payload = null;
              const responseData = await request$;
              chunkResponseTimes.push(Date.now() - chunkStartTime);

              // Positive evidence: a response covering this batch arrived (R20).
              for (const id of claimedIds) resolvedIds.add(id);
              if (!isStopped()) this.markResolved(claimedIds);

              // U10/R16. Fired here — synchronously, with no await between the
              // response landing and the callback — so two batches resolving in
              // the same tick both reach the caller's claim guard before either
              // can yield, which is what makes the claim un-doubleable.
              if (request.onBatchSuccess) {
                try {
                  request.onBatchSuccess();
                } catch (callbackError) {
                  if (__DEV__) {
                    console.warn('[PhotoImport] onBatchSuccess threw', callbackError);
                  }
                }
              }

              const suggestions = responseData.suggestions;
              // U7: per-cluster slot starvation on the backend surfaces here,
              // not as a rejection — retryable, and NOT a batch failure.
              const chunkFailedClusters = responseData.failed_cluster_count ?? 0;
              failedClusterCount += chunkFailedClusters;
              if (firstSuggestionAt === null && suggestions.length > 0) {
                firstSuggestionAt = Date.now();
              }
              if (__DEV__) {
                console.log(
                  `[PhotoImport] Chunk ${entry.index + 1}/${chunks.length}: received ${suggestions.length} suggestions in ${Date.now() - chunkStartTime}ms` +
                    (chunkFailedClusters > 0 ? `, ${chunkFailedClusters} clusters timed out` : ''),
                  suggestions.map((s) => ({
                    clusterId: s.cluster_id,
                    placeCount: s.places?.length ?? 0,
                    topPlace: s.places?.[0]?.name ?? 'none',
                  }))
                );
              }
              allSuggestions.push(...suggestions);
              // Publish for immediate display — but never over a newer run's
              // results: this accumulator belongs to THIS generation.
              if (!isStopped()) this.setState({ partialResults: [...allSuggestions] });
            } catch (error) {
              chunkResponseTimes.push(Date.now() - chunkStartTime);
              // KTD6: attribute ONLY this batch, then stop handing out new ones.
              // Batches already on the wire keep running and keep their results.
              if (error instanceof AxiosError) {
                const status = error.response?.status;
                // Only a QUOTA 503 is fatal. The backend also returns 503 for a
                // misconfigured service, for an unreachable upstream, and (U7)
                // for "busy, retry shortly" when its own slots are exhausted —
                // none of which is a quota problem. Treating those as
                // quota-exhausted told the user "Daily limit reached" and HID
                // the Retry button, making a transient outage look permanent.
                // Quota is the only 503 carrying Retry-After, so use the
                // header's PRESENCE to tell them apart; the rest fall through to
                // the retryable path below.
                if (status === 503 && error.response?.headers['retry-after']) {
                  recordFailedClusters(claimedChunk, true);
                  fatalError = new QuotaExhaustedError();
                  stopDispatching = true;
                  continue;
                }
                if (status === 429) {
                  // U16: the wait is whatever the limiter says — 1s for the
                  // burst cap, 60s for the sustained one. Never assume a minute;
                  // the default is only for a 429 from an intermediary with no
                  // header.
                  const retryAfterSeconds = parseRetryAfterSeconds(
                    error.response?.headers['retry-after']
                  );
                  fatalError = new RateLimitError(retryAfterSeconds);
                  if (
                    retryAfterSeconds <= MAX_PARKABLE_RETRY_AFTER_SECONDS &&
                    rateLimitParks < MAX_RATE_LIMIT_PARKS
                  ) {
                    // A one-second throttle must not end a hundred-cluster
                    // import: park the pool for the window the limiter asked
                    // for, then carry on with the rest of the plan. Retry stays
                    // ENABLED for this batch — unlike a quota or entitlement
                    // stop, it becomes dispatchable again a second from now.
                    rateLimitParks += 1;
                    rateLimitedUntil = Math.max(
                      rateLimitedUntil,
                      Date.now() + retryAfterSeconds * 1000
                    );
                    recordFailedClusters(claimedChunk, false);
                    failedChunkCount++;
                    continue;
                  }
                  recordFailedClusters(claimedChunk, true);
                  stopDispatching = true;
                  continue;
                }
                // U16 entitlement. NOT transient: retrying cannot succeed, so
                // the batch is marked retry-disabled rather than handed a Retry
                // button that can only fail. U10 owns what the user is shown.
                if (status === 402 && readErrorCode(error) === 'PHOTO_IMPORT_LIMIT_REACHED') {
                  recordFailedClusters(claimedChunk, true);
                  fatalError = new PhotoImportLimitReachedError();
                  stopDispatching = true;
                  continue;
                }
              }
              // Non-fatal: record THIS batch's clusters as lookup-failed with
              // retry ENABLED (KTD6) instead of silently rendering them as
              // photos-only "No place found", and keep dispatching the rest.
              recordFailedClusters(claimedChunk, false);
              failedChunkCount++;
              if (__DEV__) {
                console.warn(`[PhotoImport] Chunk ${entry.index + 1} failed, continuing...`, error);
              }
            } finally {
              this.removeActiveAbort(abortController);
              this.releaseClaim(claimedIds);
              // Settled — success or failure — so the counter only ever rises.
              clustersCompleted += chunk.length;
              publishProgress();
            }
          } finally {
            // The payload is released here, not when `entry.payload` resolved:
            // until this point the worker was still holding it (U6/prefetch
            // bound above).
            payloadsAwaitingDispatch -= 1;
          }
        }
      };

      await Promise.all(
        Array.from({ length: Math.min(concurrency, Math.max(chunks.length, 1)) }, () => runWorker())
      );

      const result: ChunkedPlaceSuggestionResult = {
        suggestions: allSuggestions,
        failed_cluster_count: failedClusterCount,
        chunkResponseTimes,
        failedClusterIds: new Map(failedIds),
        firstSuggestionAt,
        dispatchedAndResolvedIds: resolvedIds,
        dispatchedClusterIds: dispatchedIds,
        isPartial: dispatchedIds.size < totalClusters,
        fatalError,
      };
      // Never over a newer run's result: a straggler from a departed candidate
      // must not become the screen's `data`.
      if (!isStopped()) this.setState({ data: result });
      return result;
    } catch (error) {
      // Only an UNEXPECTED throw reaches here now — the network failures the
      // pool understands resolve partially instead. Progress is cleared, while
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
