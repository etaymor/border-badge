/**
 * End-to-end keystone test for U10 retry (the client missing-cluster flow).
 *
 * Hosts the composition exactly as PhotoImportScreen does: the real
 * `usePlaceSuggestions` (which owns the `useSuggestPlacesChunked` mutation +
 * the scoped `retryFailedClusters` path) wired into the real `useClusterItems`
 * (which classifies clusters into matched / no-place-found / lookup-failed from
 * the mutation's `failedClusterIds`). `usePhotoImportWorkflow` does NOT compose
 * `useClusterItems`, so the render path the keystone must exercise only flows
 * through PhotoImportScreen — this composition test reproduces that seam without
 * the heavy screen render (navigation/safe-area/many providers).
 *
 * Flow proven:
 *   chunk-2 fails -> cluster renders `lookup-failed` (NOT cached empty)
 *   -> retry succeeds with places -> cluster re-renders `matched` (now cached)
 *   AND a healthy `no-place-found` card never disappears during retry (C4 —
 *   retry never toggles the global `fetchingSuggestions` flag).
 *
 * The second describe uses the same composition for the loading-state defect
 * (R1/R2): a fetch started without the screen's flag (skipToSuggestions /
 * autoStart, i.e. opening an already-imported trip) must still report itself as
 * in progress, so clusters that are merely still on the wire are withheld rather
 * than painted as the terminal "Couldn't check this location".
 */

import { renderHook, act, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import { usePlaceSuggestions } from '../../../screens/photos/usePlaceSuggestions';
import { useClusterItems } from '../../../screens/photos/useClusterItems';
import type { ClusterDisplayItem } from '../../../screens/photos/photoImportHelpers';
import { api } from '@services/api';
// The real controller (a module-level singleton), imported from its own module
// so the blanket '@services/photoImport' mock below does not swallow it.
import { suggestionDispatch } from '@services/photoImport/suggestionDispatch';
import {
  getCachedSuggestions,
  cacheSuggestions,
  getFullCluster,
  type LocationCluster,
  type LocationClusterDisplay,
  type TripCandidateDisplay,
} from '@services/photoImport';

// ---- Mocks -----------------------------------------------------------------

jest.mock('@services/photoImport', () => ({
  getFullCluster: jest.fn(),
  getCachedSuggestions: jest.fn(),
  cacheSuggestions: jest.fn(),
  clusterLocationKey: jest.fn(
    (centroid: { latitude: number; longitude: number }) =>
      `loc:${centroid.latitude},${centroid.longitude}`
  ),
  computeTimeHint: jest.fn(() => 'attraction'),
}));

jest.mock('@services/photoImport/visionPhoto', () => ({
  getVisionImagesForCluster: jest.fn().mockResolvedValue([]),
}));

jest.mock('@services/analytics', () => ({
  Analytics: {
    photoImportSuggestionsCompleted: jest.fn(),
    photoImportApiError: jest.fn(),
  },
  calculateApiPercentiles: jest.fn(() => ({ p50: 100, p95: 200, p99: 300 })),
}));

jest.mock('@stores/subscriptionStore', () => ({
  useSubscriptionStore: jest.fn(() => jest.fn()),
  useIsPremium: jest.fn(() => true),
  useCanImportPhotos: jest.fn(() => true),
}));

// CHUNK_SIZE is 5 in usePhotoImport, so the 16-cluster fixtures below span four
// chunks. The first api.post resolves and the second rejects; the remaining
// chunks fall through to the default (unstubbed) api.post mock, which also fails
// the chunk. Every chunk fails independently of the others, so a failing chunk
// never takes a succeeding one down with it (no extra mock needed).

const mockedApi = api as jest.Mocked<typeof api>;
const mockedGetCachedSuggestions = getCachedSuggestions as jest.MockedFunction<
  typeof getCachedSuggestions
>;
const mockedCacheSuggestions = cacheSuggestions as jest.MockedFunction<typeof cacheSuggestions>;
const mockedGetFullCluster = getFullCluster as jest.MockedFunction<typeof getFullCluster>;

// ---- Builders --------------------------------------------------------------

function makeCluster(id: string, lat: number, lng: number): LocationCluster {
  return {
    id,
    geohash: 'gh',
    centroid: { latitude: lat, longitude: lng },
    photos: [
      {
        id: `photo-${id}`,
        uri: `file://${id}.jpg`,
        filename: `${id}.jpg`,
        creationTime: new Date('2024-01-01T00:00:00Z'),
        location: { latitude: lat, longitude: lng },
      },
    ],
    timeRange: { start: new Date('2024-01-01T00:00:00Z'), end: new Date('2024-01-01T01:00:00Z') },
    countryCode: 'JP',
  };
}

function toDisplay(c: LocationCluster): LocationClusterDisplay {
  return {
    id: c.id,
    geohash: c.geohash,
    centroid: c.centroid,
    photoIds: c.photos.map((p) => p.id),
    photoCount: c.photos.length,
    previewUris: c.photos.map((p) => p.uri),
    previewAssetIds: c.photos.map((p) => p.id),
    timeRange: c.timeRange,
    countryCode: c.countryCode,
  };
}

const buildCandidate = (clusterIds: string[]): TripCandidateDisplay => ({
  id: 'candidate-1',
  countryCode: 'JP',
  dateRange: { start: new Date('2024-01-01T00:00:00Z'), end: new Date('2024-01-02T00:00:00Z') },
  photoIds: [],
  photoCount: 10,
  previewUris: [],
  previewAssetIds: [],
  locationClusterIds: clusterIds,
});

const placeFor = (id: string) => ({
  place_id: `ChIJ_${id}`,
  name: `Place ${id}`,
  address: '1 St',
  location: { latitude: 35, longitude: 139 },
  category: 'place',
  distance_m: 10,
  types: ['point_of_interest'],
});

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });

/**
 * R1 contract that `usePlaceSuggestions` must satisfy: it reports that a
 * suggestion fetch is in progress for the WHOLE duration of every path that
 * starts one — the SQLite cache read and vision prep included, and its early
 * returns included — and reports settled only once every concurrent owner has
 * settled.
 *
 * The screen's own `fetchingSuggestions` state is NOT that signal: the
 * skipToSuggestions / autoStart path (opening an already-imported trip) starts a
 * fetch without ever setting it, which is the defect the two tests below pin.
 * The field is read defensively so this suite compiles before it exists — it
 * reads `false` today, which is exactly what makes those tests RED.
 */
interface SuggestionFetchReporter {
  isFetchingSuggestions: boolean;
}

const reportedFetchInProgress = (suggestions: unknown): boolean =>
  (suggestions as Partial<SuggestionFetchReporter>).isFetchingSuggestions ?? false;

/** Resolved value of the SQLite suggestion-cache read, for deferred stubbing. */
type CachedSuggestionsResult = Awaited<ReturnType<typeof getCachedSuggestions>>;

/**
 * Compose usePlaceSuggestions + useClusterItems exactly as PhotoImportScreen
 * does, plus a `fetchingSuggestions` flag the test drives (the screen's
 * useWorkflowNavigation toggles it around fetchSuggestions; retry must NOT).
 *
 * The flag handed to useClusterItems is the screen state OR'd with what the
 * suggestions hook reports (R1), because a fetch is in progress if ANY owner
 * says so — the screen only knows about the fetches it started itself.
 */
function useComposition(candidate: TripCandidateDisplay, clusters: LocationCluster[]) {
  const clusterLookupRef = React.useRef(new Map(clusters.map((c) => [c.id, c])));
  const clusterDisplays = React.useMemo(
    () => new Map(clusters.map((c) => [c.id, toDisplay(c)])),
    [clusters]
  );
  const [fetchingSuggestions, setFetchingSuggestions] = React.useState(false);

  const suggestions = usePlaceSuggestions({ clusterLookupRef });
  const reportedFetching = reportedFetchInProgress(suggestions);

  const clusterItems = useClusterItems({
    selectedCandidate: candidate,
    clusterDisplays,
    suggestionDispatch: suggestions.suggestionDispatch,
    cachedSuggestions: suggestions.cachedSuggestions,
    dismissedClusterIdsInternal: new Set(),
    fetchingSuggestions: fetchingSuggestions || reportedFetching,
    retryingClusterIds: suggestions.retryingClusterIds,
  });

  return {
    ...suggestions,
    clusterItems,
    fetchingSuggestions,
    reportedFetching,
    setFetchingSuggestions,
  };
}

/** Ids of every cluster currently rendered as the terminal lookup-failed card. */
const lookupFailedIds = (items: ClusterDisplayItem[]) =>
  items.flatMap((item) => (item.type === 'lookup-failed' ? [item.cluster.id] : []));

/** Ids of every cluster currently rendered as a NON-terminal pending row (R10). */
const pendingIds = (items: ClusterDisplayItem[]) =>
  items.flatMap((item) => (item.type === 'pending' ? [item.cluster.id] : []));

/**
 * Find the row rendered for a cluster id.
 *
 * The switch is EXHAUSTIVE on purpose. The previous inline version ended in a
 * bare `return i.cluster.id === id` fallthrough, so when the `pending` variant
 * landed it began matching pending rows with no signal that it had: an
 * assertion expecting `lookup-failed` would report `pending` from a helper that
 * looked like it only ever produced terminal states, pointing the reader at the
 * wrong part of the system. Matching pending is now explicit, and adding a
 * variant without a branch fails compile instead of silently widening the match.
 */
const rowFor = (items: ClusterDisplayItem[], id: string) =>
  items.find((item) => {
    switch (item.type) {
      case 'suggestion':
        return item.data.cluster_id === id;
      case 'merged-suggestion':
        return item.data.clusterIds.includes(id);
      case 'lookup-failed':
      case 'photos-only':
      case 'pending':
        return item.cluster.id === id;
    }
  });

beforeEach(() => {
  jest.clearAllMocks();
  // The dispatch controller is a module-level singleton (KTD21), so a test that
  // throws mid-`act` would otherwise strand an owner and report "still fetching"
  // into every later test in this file.
  suggestionDispatch.resetForTests();
  mockedGetCachedSuggestions.mockResolvedValue(new Map());
  mockedCacheSuggestions.mockResolvedValue(undefined as never);
});

describe('PhotoImportScreen retry e2e (U8 -> U9 -> U10)', () => {
  it('chunk-2 fails -> lookup-failed -> retry succeeds -> matched; no-place-found card persists (C4)', async () => {
    // Build 16 clusters so they span several chunks (CHUNK_SIZE is 5). The first
    // chunk succeeds; the later ones throw. We give one first-chunk cluster a
    // real empty response (-> no-place-found) and one first-chunk cluster a
    // match, and let `c-failed` land in a throwing chunk.
    const matched = makeCluster('c-matched', 35.01, 139.01);
    const emptyOk = makeCluster('c-empty', 35.02, 139.02);
    const fillers = Array.from({ length: 13 }, (_, i) =>
      makeCluster(`c-fill-${i}`, 35.1 + i * 0.001, 139.1 + i * 0.001)
    );
    const failed = makeCluster('c-failed', 35.5, 139.5); // chunk-2

    const answered = [matched, emptyOk, ...fillers]; // 15 clusters
    const allClusters = [...answered, failed]; // 16 -> several chunks

    const lookup = new Map(allClusters.map((c) => [c.id, c]));
    mockedGetFullCluster.mockImplementation((id: string) => lookup.get(id));

    // First api.post: matched -> place, empty -> [], fillers -> [].
    // Every later api.post: throws a non-fatal error.
    mockedApi.post
      .mockResolvedValueOnce({
        data: {
          suggestions: [
            {
              cluster_id: 'c-matched',
              photo_ids: ['photo-c-matched'],
              places: [placeFor('c-matched')],
            },
            { cluster_id: 'c-empty', photo_ids: ['photo-c-empty'], places: [] },
            ...fillers.map((f) => ({ cluster_id: f.id, photo_ids: [`photo-${f.id}`], places: [] })),
          ],
          failed_cluster_count: 0,
        },
      })
      .mockRejectedValueOnce(new Error('chunk-2 network blip'));

    const candidate = buildCandidate(allClusters.map((c) => c.id));

    const queryClient = createTestQueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useComposition(candidate, allClusters), { wrapper });

    // --- Initial fetch (chunk-1 ok, chunk-2 fails) -------------------------
    await act(async () => {
      result.current.setFetchingSuggestions(true);
      await result.current.fetchSuggestions(candidate);
      result.current.setFetchingSuggestions(false);
    });

    const byCluster = (id: string) => rowFor(result.current.clusterItems, id);

    // c-matched -> matched; c-empty -> no-place-found; c-failed -> lookup-failed.
    expect(byCluster('c-matched')?.type).toBe('suggestion');
    expect(byCluster('c-empty')?.type).toBe('photos-only');
    expect(byCluster('c-failed')?.type).toBe('lookup-failed');

    // KTD8: the failed cluster was NOT cached as empty.
    const cachedIdsAfterFetch = mockedCacheSuggestions.mock.calls.flatMap((call) =>
      call[0].map((s) => s.cluster_id)
    );
    expect(cachedIdsAfterFetch).not.toContain('c-failed');

    // --- Retry the failed cluster -----------------------------------------
    mockedCacheSuggestions.mockClear();
    // Retry response: c-failed now resolves with a place.
    mockedApi.post.mockResolvedValueOnce({
      data: {
        suggestions: [
          { cluster_id: 'c-failed', photo_ids: ['photo-c-failed'], places: [placeFor('c-failed')] },
        ],
        failed_cluster_count: 0,
      },
    });

    // C4 guard: retry must NOT toggle the global fetchingSuggestions flag.
    expect(result.current.fetchingSuggestions).toBe(false);

    await act(async () => {
      // PhotoImportScreen's handleRetryCluster: retryFailedClusters([id]).
      await result.current.retryFailedClusters(['c-failed']);
    });

    // Global flag untouched throughout retry (C4).
    expect(result.current.fetchingSuggestions).toBe(false);

    // c-failed now re-renders as matched; the healthy no-place-found card and the
    // matched card never disappeared.
    expect(byCluster('c-failed')?.type).toBe('suggestion');
    expect(byCluster('c-empty')?.type).toBe('photos-only');
    expect(byCluster('c-matched')?.type).toBe('suggestion');

    // The retried cluster is now cached (with its place); the previously-failed
    // cluster left failedClusterIds.
    const retryCachedIds = mockedCacheSuggestions.mock.calls.flatMap((call) =>
      call[0].map((s) => s.cluster_id)
    );
    expect(retryCachedIds).toContain('c-failed');
    expect(result.current.suggestionDispatch.failedClusterIds.has('c-failed')).toBe(false);
  });

  it('retry that fails AGAIN keeps the cluster lookup-failed (retry-enabled, no cap); no-place-found persists', async () => {
    const emptyOk = makeCluster('c-empty', 35.02, 139.02);
    const fillers = Array.from({ length: 14 }, (_, i) =>
      makeCluster(`c-fill-${i}`, 35.1 + i * 0.001, 139.1 + i * 0.001)
    );
    const failed = makeCluster('c-failed', 35.5, 139.5);

    const answered = [emptyOk, ...fillers]; // 15
    const allClusters = [...answered, failed]; // 16 -> several chunks (CHUNK_SIZE is 5)

    const lookup = new Map(allClusters.map((c) => [c.id, c]));
    mockedGetFullCluster.mockImplementation((id: string) => lookup.get(id));

    mockedApi.post
      .mockResolvedValueOnce({
        data: {
          suggestions: [
            { cluster_id: 'c-empty', photo_ids: ['photo-c-empty'], places: [] },
            ...fillers.map((f) => ({ cluster_id: f.id, photo_ids: [`photo-${f.id}`], places: [] })),
          ],
          failed_cluster_count: 0,
        },
      })
      .mockRejectedValueOnce(new Error('chunk-2 network blip'));

    const candidate = buildCandidate(allClusters.map((c) => c.id));

    const queryClient = createTestQueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useComposition(candidate, allClusters), { wrapper });

    await act(async () => {
      result.current.setFetchingSuggestions(true);
      await result.current.fetchSuggestions(candidate);
      result.current.setFetchingSuggestions(false);
    });

    const byCluster = (id: string) => rowFor(result.current.clusterItems, id);

    expect(byCluster('c-failed')?.type).toBe('lookup-failed');

    // First retry: fails again.
    mockedApi.post.mockRejectedValueOnce(new Error('still down'));
    await act(async () => {
      await result.current.retryFailedClusters(['c-failed']);
    });

    expect(byCluster('c-failed')?.type).toBe('lookup-failed');
    expect(byCluster('c-empty')?.type).toBe('photos-only'); // unaffected
    const failedItem = byCluster('c-failed');
    if (failedItem?.type === 'lookup-failed') {
      expect(failedItem.retryDisabled).toBe(false); // no cap, retry still enabled
    }

    // Second retry: now succeeds.
    mockedApi.post.mockResolvedValueOnce({
      data: {
        suggestions: [
          { cluster_id: 'c-failed', photo_ids: ['photo-c-failed'], places: [placeFor('c-failed')] },
        ],
        failed_cluster_count: 0,
      },
    });
    await act(async () => {
      await result.current.retryFailedClusters(['c-failed']);
    });

    expect(byCluster('c-failed')?.type).toBe('suggestion');
  });
});

describe('suggestion fetch reports in-progress for its whole duration (R1/R2)', () => {
  /**
   * Reproduces opening an already-imported trip: the skipToSuggestions /
   * autoStart path starts a fetch WITHOUT setting the screen's own
   * `fetchingSuggestions` state, so the hook's report is the only in-progress
   * signal. With no signal, useClusterItems' reconciliation branch fires on
   * clusters that are merely still on the wire and paints a wall of
   * "Couldn't check this location" — and each Retry buys the same lookup twice.
   */
  it('renders still-unanswered clusters as pending mid-dispatch, then reconciles the un-responded one to lookup-failed', async () => {
    const a = makeCluster('c-a', 35.01, 139.01);
    const b = makeCluster('c-b', 35.02, 139.02);
    const allClusters = [a, b]; // one chunk (CHUNK_SIZE is 5)

    const lookup = new Map(allClusters.map((c) => [c.id, c]));
    mockedGetFullCluster.mockImplementation((id: string) => lookup.get(id));

    // Hold the request open so the assertions run while it is genuinely in flight.
    let resolveRequest!: (value: unknown) => void;
    mockedApi.post.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRequest = resolve as (value: unknown) => void;
        })
    );

    const candidate = buildCandidate(allClusters.map((c) => c.id));
    const queryClient = createTestQueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useComposition(candidate, allClusters), { wrapper });

    // NOTE: deliberately NOT wrapped in setFetchingSuggestions(true/false) — the
    // defective path never sets it. This is the whole point of the repro.
    let fetchPromise!: Promise<unknown>;
    await act(async () => {
      fetchPromise = result.current.fetchSuggestions(candidate);
    });
    await waitFor(() => {
      expect(mockedApi.post).toHaveBeenCalledTimes(1);
    });

    // In flight and healthy: nothing has failed, so nothing may be shown failed.
    expect(lookupFailedIds(result.current.clusterItems)).toEqual([]);
    // U8/R10 — REWRITTEN TRIPWIRE. This assertion used to be
    // `expect(result.current.clusterItems).toHaveLength(0)`: an accepted but
    // unanswered cluster was WITHHELD, which is what left a hundred-location
    // import showing the ~2 rows of the live batch and blank space for the rest.
    // It is not deleted, because its real content — nothing may be painted as
    // the terminal "Couldn't check this location" while the request is genuinely
    // in flight (R2) — still holds and is asserted above. What changes is the
    // other half: every ENQUEUED, unresolved cluster is now visible as a
    // non-terminal pending row, in canonical order, including clusters queued
    // behind the live batches.
    expect(pendingIds(result.current.clusterItems)).toEqual(['c-a', 'c-b']);
    expect(result.current.reportedFetching).toBe(true);

    // Settle the dispatch: c-a is answered with a place, c-b is not answered at all.
    await act(async () => {
      resolveRequest({
        data: {
          suggestions: [{ cluster_id: 'c-a', photo_ids: ['photo-c-a'], places: [placeFor('c-a')] }],
          failed_cluster_count: 0,
        },
      });
      await fetchPromise;
    });

    const byCluster = (id: string) => rowFor(result.current.clusterItems, id);

    // The reconciliation role of the flag STAYS (KTD3): once dispatch settles, an
    // unresolved and unclaimed cluster IS lookup-failed, with retry enabled.
    expect(result.current.reportedFetching).toBe(false);
    expect(byCluster('c-a')?.type).toBe('suggestion');
    const unresponded = byCluster('c-b');
    expect(unresponded?.type).toBe('lookup-failed');
    if (unresponded?.type === 'lookup-failed') {
      expect(unresponded.retryDisabled).toBe(false);
    }
  });

  /**
   * The in-progress report must cover the pre-dispatch window too (the SQLite
   * cache read + vision prep). The mutation's own `isPending` is false there, so
   * a signal derived from the mutation alone would leave this hole open — and
   * that window is exactly where a large import spends its first seconds.
   */
  it('withholds clusters during the pre-dispatch cache read, before any request is on the wire', async () => {
    const a = makeCluster('c-a', 35.01, 139.01);
    const b = makeCluster('c-b', 35.02, 139.02);
    const allClusters = [a, b];

    const lookup = new Map(allClusters.map((c) => [c.id, c]));
    mockedGetFullCluster.mockImplementation((id: string) => lookup.get(id));

    // Hold the cache read open — the fetch is started but nothing is dispatched.
    let resolveCacheRead!: (value: CachedSuggestionsResult) => void;
    mockedGetCachedSuggestions.mockReturnValueOnce(
      new Promise<CachedSuggestionsResult>((resolve) => {
        resolveCacheRead = resolve;
      })
    );

    mockedApi.post.mockResolvedValueOnce({
      data: {
        suggestions: [
          { cluster_id: 'c-a', photo_ids: ['photo-c-a'], places: [placeFor('c-a')] },
          { cluster_id: 'c-b', photo_ids: ['photo-c-b'], places: [placeFor('c-b')] },
        ],
        failed_cluster_count: 0,
      },
    });

    const candidate = buildCandidate(allClusters.map((c) => c.id));
    const queryClient = createTestQueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useComposition(candidate, allClusters), { wrapper });

    let fetchPromise!: Promise<unknown>;
    await act(async () => {
      fetchPromise = result.current.fetchSuggestions(candidate);
    });
    await waitFor(() => {
      expect(mockedGetCachedSuggestions).toHaveBeenCalledTimes(1);
    });

    // Pre-dispatch window: the controller has not started dispatching, so it
    // cannot be the source of the in-progress signal.
    expect(mockedApi.post).not.toHaveBeenCalled();
    expect(result.current.suggestionDispatch.isDispatching).toBe(false);
    expect(lookupFailedIds(result.current.clusterItems)).toEqual([]);
    expect(result.current.reportedFetching).toBe(true);

    await act(async () => {
      resolveCacheRead(new Map());
      await fetchPromise;
    });

    const byCluster = (id: string) => rowFor(result.current.clusterItems, id);

    expect(result.current.reportedFetching).toBe(false);
    expect(byCluster('c-a')?.type).toBe('suggestion');
    expect(byCluster('c-b')?.type).toBe('suggestion');
  });

  /**
   * R10, against the REAL controller. Dispatch puts one batch on the wire at a
   * time (FIRST_CHUNK_SIZE 2, then CHUNK_SIZE 5), so `inFlightClusterIds` holds
   * two of these eight clusters. Sourcing pending rows from the in-flight set
   * would show two rows and six blanks — the reported defect, at 100 clusters
   * roughly 15 rows and 85 blanks. Pending comes from the ENQUEUED set, which
   * accepts every cluster up front.
   */
  it('renders every enqueued cluster as pending, including batches not yet dispatched', async () => {
    const allClusters = Array.from({ length: 8 }, (_, i) =>
      makeCluster(`c-${i}`, 35 + i * 0.01, 139 + i * 0.01)
    );
    const lookup = new Map(allClusters.map((c) => [c.id, c]));
    mockedGetFullCluster.mockImplementation((id: string) => lookup.get(id));

    // Hold the FIRST batch open so nothing has resolved when we assert.
    let resolveFirst!: (value: unknown) => void;
    mockedApi.post.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve as (value: unknown) => void;
        })
    );

    const candidate = buildCandidate(allClusters.map((c) => c.id));
    const queryClient = createTestQueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useComposition(candidate, allClusters), { wrapper });

    let fetchPromise!: Promise<unknown>;
    await act(async () => {
      fetchPromise = result.current.fetchSuggestions(candidate);
    });
    await waitFor(() => {
      expect(mockedApi.post).toHaveBeenCalledTimes(1);
    });

    // Only the opening batch is on the wire...
    expect(result.current.suggestionDispatch.inFlightClusterIds.size).toBeLessThan(
      allClusters.length
    );
    // ...but EVERY cluster is a visible pending row, in canonical order.
    expect(pendingIds(result.current.clusterItems)).toEqual(allClusters.map((c) => c.id));

    // Drain so the controller does not stay parked into the next test.
    await act(async () => {
      resolveFirst({ data: { suggestions: [], failed_cluster_count: 0 } });
      await fetchPromise;
    });
  });

  /**
   * R11 + R9: a row resolving mid-dispatch swaps its card IN PLACE, keeps its
   * neighbours' positions, and becomes actionable (a `suggestion` row carries
   * the confirm/edit affordances) while the rest are still pending.
   */
  it('resolves a pending row in place without reordering, while others stay pending', async () => {
    const allClusters = Array.from({ length: 6 }, (_, i) =>
      makeCluster(`c-${i}`, 35 + i * 0.01, 139 + i * 0.01)
    );
    const lookup = new Map(allClusters.map((c) => [c.id, c]));
    mockedGetFullCluster.mockImplementation((id: string) => lookup.get(id));

    // First batch (c-0, c-1) answers: c-1 with a place, c-0 with an empty list.
    // The second batch is held open, so c-2..c-5 stay pending.
    let resolveSecond!: (value: unknown) => void;
    mockedApi.post
      .mockResolvedValueOnce({
        data: {
          suggestions: [
            { cluster_id: 'c-0', photo_ids: ['photo-c-0'], places: [] },
            { cluster_id: 'c-1', photo_ids: ['photo-c-1'], places: [placeFor('c-1')] },
          ],
          failed_cluster_count: 0,
        },
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecond = resolve as (value: unknown) => void;
          })
      );

    const candidate = buildCandidate(allClusters.map((c) => c.id));
    const queryClient = createTestQueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useComposition(candidate, allClusters), { wrapper });

    let fetchPromise!: Promise<unknown>;
    await act(async () => {
      fetchPromise = result.current.fetchSuggestions(candidate);
    });
    await waitFor(() => {
      expect(mockedApi.post).toHaveBeenCalledTimes(2);
    });

    const rows = result.current.clusterItems;
    // Order is unchanged and no row was removed.
    expect(rows).toHaveLength(6);
    expect(rows.map((row) => allClusters.find((c) => rowFor(rows, c.id) === row)?.id)).toEqual(
      allClusters.map((c) => c.id)
    );
    // c-0 answered empty -> terminal no-place-found; c-1 answered with a place ->
    // matched and actionable; the undispatched rest are still pending.
    expect(rowFor(rows, 'c-0')?.type).toBe('photos-only');
    expect(rowFor(rows, 'c-1')?.type).toBe('suggestion');
    expect(pendingIds(rows)).toEqual(['c-2', 'c-3', 'c-4', 'c-5']);

    await act(async () => {
      resolveSecond({ data: { suggestions: [], failed_cluster_count: 0 } });
      await fetchPromise;
    });
  });
});

describe('overlapping dispatch owners never fake a settled fetch (KTD13)', () => {
  /**
   * Two owners overlap: the main dispatch (fetchSuggestions) and a manual split
   * (fetchForClusters). With a plain boolean the FIRST one to finish flips the
   * flag false, which fires useClusterItems' reconciliation sweep against the
   * other owner's still-in-flight clusters and paints them "Couldn't check this
   * location". Settled must mean ALL owners settled.
   */
  it('the first owner to finish does not fire the reconciliation sweep; both settling does', async () => {
    const a = makeCluster('c-a', 35.01, 139.01);
    const b = makeCluster('c-b', 35.02, 139.02);
    const split = makeCluster('c-split', 35.03, 139.03);
    const allClusters = [a, b, split];

    const lookup = new Map(allClusters.map((c) => [c.id, c]));
    mockedGetFullCluster.mockImplementation((id: string) => lookup.get(id));

    // Route by payload rather than call order: the two owners race through their
    // pre-dispatch work, so which request hits the wire first is not fixed.
    let resolveMain!: (value: unknown) => void;
    mockedApi.post.mockImplementation((_url: string, body: unknown) => {
      const ids = (body as { clusters: { id: string }[] }).clusters.map((c) => c.id);
      if (ids.includes('c-split')) {
        return Promise.resolve({
          data: {
            suggestions: [
              {
                cluster_id: 'c-split',
                photo_ids: ['photo-c-split'],
                places: [placeFor('c-split')],
              },
            ],
            failed_cluster_count: 0,
          },
        });
      }
      return new Promise((resolve) => {
        resolveMain = resolve as (value: unknown) => void;
      });
    });

    // The candidate only holds c-a and c-b; the split cluster renders elsewhere.
    const candidate = buildCandidate([a.id, b.id]);
    const queryClient = createTestQueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useComposition(candidate, allClusters), { wrapper });

    let mainPromise!: Promise<unknown>;
    let splitPromise!: Promise<unknown>;
    await act(async () => {
      mainPromise = result.current.fetchSuggestions(candidate);
      splitPromise = result.current.fetchForClusters([split]);
    });

    // The split owner settles first; the main dispatch is still on the wire.
    await act(async () => {
      await splitPromise;
    });

    expect(result.current.reportedFetching).toBe(true);
    expect(lookupFailedIds(result.current.clusterItems)).toEqual([]);

    // Now the main dispatch settles, answering c-a only. NOW the sweep fires.
    await act(async () => {
      resolveMain({
        data: {
          suggestions: [{ cluster_id: 'c-a', photo_ids: ['photo-c-a'], places: [placeFor('c-a')] }],
          failed_cluster_count: 0,
        },
      });
      await mainPromise;
    });

    expect(result.current.reportedFetching).toBe(false);
    expect(lookupFailedIds(result.current.clusterItems)).toEqual(['c-b']);
  });
});
