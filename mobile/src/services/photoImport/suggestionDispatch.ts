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
    // Cancel what is on the wire rather than letting it run to completion. With
    // a pool this matters: several requests can be outstanding, and each one
    // that lands after a reset would otherwise re-publish state for a candidate
    // the user has already left.
    for (const controller of this.activeAborts) controller.abort();
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
    signal?: AbortSignal
  ): Promise<PlaceSuggestionResponse> {
    const response = await api.post(
      '/photos/suggest-places',
      { clusters: payload },
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
      // it here would resurrect a departed candidate's failures.
      if (this.aborted) return;
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
      if (this.aborted || generation !== this.currentGeneration) return;
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
      // The bound is what caps peak payload memory, and it grows linearly with
      // the pool: at concurrency N, N+1 encoded payloads can be held at once.
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
          !this.aborted &&
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
        while (this.paused && !this.aborted && !stopDispatching) {
          await this.awaitResume();
        }
      };

      const runWorker = async (): Promise<void> => {
        for (;;) {
          if (this.aborted || stopDispatching) return;
          if (this.paused) {
            await parkWhilePaused();
            if (this.aborted || stopDispatching) return;
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
          payloadsAwaitingDispatch -= 1;
          if (this.aborted || stopDispatching) return;
          // A batch that finished preparing DURING the background window is
          // still a new request: hold it until we're foreground again.
          if (this.paused) {
            await parkWhilePaused();
            if (this.aborted || stopDispatching) return;
          }

          const claimedIds = this.claim(chunkIds);
          // A REAL abort controller per batch (U6). The `aborted` flag alone is
          // only checked between batches, which cancels nothing that is already
          // on the wire — and with a pool that is most of the work.
          const abortController = new AbortController();
          this.activeAborts.add(abortController);
          const chunkStartTime = Date.now();
          try {
            for (const id of chunkIds) dispatchedIds.add(id);
            const request$ = this.postBatch(payload, abortController.signal);
            // The base64 vision images are by far the largest allocation here.
            // Drop our reference the moment the request is issued so an
            // already-dispatched batch is not pinned for the whole round trip.
            payload = null;
            const responseData = await request$;
            chunkResponseTimes.push(Date.now() - chunkStartTime);

            // Positive evidence: a response covering this batch arrived (R20).
            for (const id of chunkIds) resolvedIds.add(id);
            this.markResolved(chunkIds);

            const suggestions = responseData.suggestions;
            // U7: per-cluster slot starvation on the backend surfaces here, not
            // as a rejection — retryable, and NOT a batch failure.
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
            // Publish for immediate display.
            if (!this.aborted) this.setState({ partialResults: [...allSuggestions] });
          } catch (error) {
            chunkResponseTimes.push(Date.now() - chunkStartTime);
            // KTD6: attribute ONLY this batch, then stop handing out new ones.
            // Batches already on the wire keep running and keep their results.
            if (error instanceof AxiosError) {
              const status = error.response?.status;
              // Only a QUOTA 503 is fatal. The backend also returns 503 for a
              // misconfigured service, for an unreachable upstream, and (U7) for
              // "busy, retry shortly" when its own slots are exhausted — none of
              // which is a quota problem. Treating those as quota-exhausted told
              // the user "Daily limit reached" and HID the Retry button, making a
              // transient outage look permanent. Quota is the only 503 carrying
              // Retry-After, so use the header's PRESENCE to tell them apart; the
              // rest fall through to the retryable path below.
              if (status === 503 && error.response?.headers['retry-after']) {
                recordFailedClusters(chunk, true);
                fatalError = new QuotaExhaustedError();
                stopDispatching = true;
                continue;
              }
              if (status === 429) {
                recordFailedClusters(chunk, true);
                // U16: the wait is whatever the limiter says — 1s for the burst
                // cap, 60s for the sustained one. Never assume a minute; the
                // default is only for a 429 from an intermediary with no header.
                const retryAfter = error.response?.headers['retry-after'];
                const retrySeconds = retryAfter ? parseInt(retryAfter, 10) : 60;
                fatalError = new RateLimitError(isNaN(retrySeconds) ? 60 : retrySeconds);
                stopDispatching = true;
                continue;
              }
              // U16 entitlement. NOT transient: retrying cannot succeed, so the
              // batch is marked retry-disabled rather than handed a Retry button
              // that can only fail. U10 owns what the user is shown.
              if (
                status === 402 &&
                (error.response?.data as { code?: string } | undefined)?.code ===
                  'PHOTO_IMPORT_LIMIT_REACHED'
              ) {
                recordFailedClusters(chunk, true);
                fatalError = new PhotoImportLimitReachedError();
                stopDispatching = true;
                continue;
              }
            }
            // Non-fatal: record THIS batch's clusters as lookup-failed with
            // retry ENABLED (KTD6) instead of silently rendering them as
            // photos-only "No place found", and keep dispatching the rest.
            recordFailedClusters(chunk, false);
            failedChunkCount++;
            if (__DEV__) {
              console.warn(`[PhotoImport] Chunk ${entry.index + 1} failed, continuing...`, error);
            }
          } finally {
            this.activeAborts.delete(abortController);
            this.releaseClaim(claimedIds);
            // Settled — success or failure — so the counter only ever rises.
            clustersCompleted += chunk.length;
            publishProgress();
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
      if (!this.aborted) this.setState({ data: result });
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
