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
import { api } from '@services/api';
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
const lookupFailedIds = (items: ReturnType<typeof useComposition>['clusterItems']) =>
  items.flatMap((item) => (item.type === 'lookup-failed' ? [item.cluster.id] : []));

beforeEach(() => {
  jest.clearAllMocks();
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

    const byCluster = (id: string) =>
      result.current.clusterItems.find((i) => {
        if (i.type === 'suggestion') return i.data.cluster_id === id;
        if (i.type === 'merged-suggestion') return i.data.clusterIds.includes(id);
        return i.cluster.id === id;
      });

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

    const byCluster = (id: string) =>
      result.current.clusterItems.find((i) => {
        if (i.type === 'suggestion') return i.data.cluster_id === id;
        if (i.type === 'merged-suggestion') return i.data.clusterIds.includes(id);
        return i.cluster.id === id;
      });

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
  it('withholds still-pending clusters mid-dispatch, then reconciles the un-responded one to lookup-failed', async () => {
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
    expect(result.current.clusterItems).toHaveLength(0);
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

    const byCluster = (id: string) =>
      result.current.clusterItems.find((i) => {
        if (i.type === 'suggestion') return i.data.cluster_id === id;
        if (i.type === 'merged-suggestion') return i.data.clusterIds.includes(id);
        return i.cluster.id === id;
      });

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

    const byCluster = (id: string) =>
      result.current.clusterItems.find((i) => {
        if (i.type === 'suggestion') return i.data.cluster_id === id;
        if (i.type === 'merged-suggestion') return i.data.clusterIds.includes(id);
        return i.cluster.id === id;
      });

    expect(result.current.reportedFetching).toBe(false);
    expect(byCluster('c-a')?.type).toBe('suggestion');
    expect(byCluster('c-b')?.type).toBe('suggestion');
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
