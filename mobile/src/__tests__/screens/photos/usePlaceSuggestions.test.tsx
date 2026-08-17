/**
 * Tests for usePlaceSuggestions empty-cache-poisoning guard (U8 / KTD8).
 *
 * Covers the two empty-cache write sites:
 *  - fetchSuggestions: a cluster in the chunked mutation's failedClusterIds set
 *    (chunk failure) must never be written to the SQLite cache as `[]`.
 *  - fetchForClusters: a transiently-failed split cluster must never be written
 *    to cache as `[]`.
 */

import { renderHook, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Alert } from 'react-native';
import { AxiosError } from 'axios';
import React from 'react';

import { usePlaceSuggestions } from '../../../screens/photos/usePlaceSuggestions';
import { api } from '@services/api';
import {
  getCachedSuggestions,
  cacheSuggestions,
  clusterLocationKey,
  getFullCluster,
  type LocationCluster,
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

const mockedAlert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

const mockedApi = api as jest.Mocked<typeof api>;
const mockedGetCachedSuggestions = getCachedSuggestions as jest.MockedFunction<
  typeof getCachedSuggestions
>;
const mockedCacheSuggestions = cacheSuggestions as jest.MockedFunction<typeof cacheSuggestions>;
const mockedGetFullCluster = getFullCluster as jest.MockedFunction<typeof getFullCluster>;

// ---- Helpers ---------------------------------------------------------------

function makeCluster(id: string, lat = 35, lng = 139): LocationCluster {
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

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });

function setup(
  clusters: LocationCluster[],
  currentCandidateIdRef?: React.RefObject<string | null>
) {
  const lookup = new Map<string, LocationCluster>();
  for (const c of clusters) lookup.set(c.id, c);
  mockedGetFullCluster.mockImplementation((id: string) => lookup.get(id));
  const clusterLookupRef = { current: lookup } as React.RefObject<Map<string, LocationCluster>>;
  const queryClient = createTestQueryClient();
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(() => usePlaceSuggestions({ clusterLookupRef, currentCandidateIdRef }), {
    wrapper,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedGetCachedSuggestions.mockResolvedValue(new Map());
  mockedCacheSuggestions.mockResolvedValue(undefined as never);
});

// ---- fetchForClusters (manual-split site) ----------------------------------

describe('usePlaceSuggestions.fetchForClusters - empty-cache poisoning (KTD8)', () => {
  it('does NOT cache a transiently-failed split cluster as empty (failed_cluster_count > 0)', async () => {
    const matched = makeCluster('split-1', 35.1, 139.1);
    const failedTransient = makeCluster('split-2', 35.2, 139.2);

    // Backend responded for split-1 only; split-2 timed out (failed_cluster_count = 1).
    mockedApi.post.mockResolvedValueOnce({
      data: {
        suggestions: [{ cluster_id: 'split-1', photo_ids: ['photo-split-1'], places: [] }],
        failed_cluster_count: 1,
      },
    });

    const { result } = setup([matched, failedTransient]);

    await act(async () => {
      await result.current.fetchForClusters([matched, failedTransient]);
    });

    expect(mockedCacheSuggestions).toHaveBeenCalledTimes(1);
    const cached = mockedCacheSuggestions.mock.calls[0][0];
    const cachedIds = cached.map((c) => c.cluster_id);
    // split-1 cached (responded), split-2 NOT cached (transient failure).
    expect(cachedIds).toEqual(['split-1']);
    expect(cachedIds).not.toContain('split-2');
  });

  it('does NOT cache any cluster when the whole call throws', async () => {
    const c1 = makeCluster('split-a');
    const c2 = makeCluster('split-b');
    mockedApi.post.mockRejectedValueOnce(new Error('network blip'));

    const { result } = setup([c1, c2]);

    await act(async () => {
      await result.current.fetchForClusters([c1, c2]);
    });

    expect(mockedCacheSuggestions).not.toHaveBeenCalled();
  });

  it('caches all clusters as empty when failed_cluster_count is 0 (genuine no-match)', async () => {
    const c1 = makeCluster('split-x');
    mockedApi.post.mockResolvedValueOnce({
      data: {
        suggestions: [{ cluster_id: 'split-x', photo_ids: ['photo-split-x'], places: [] }],
        failed_cluster_count: 0,
      },
    });

    const { result } = setup([c1]);

    await act(async () => {
      await result.current.fetchForClusters([c1]);
    });

    expect(mockedCacheSuggestions).toHaveBeenCalledTimes(1);
    const cached = mockedCacheSuggestions.mock.calls[0][0];
    expect(cached.map((c) => c.cluster_id)).toEqual(['split-x']);
    expect(cached[0].places).toEqual([]);
  });
});

// ---- fetchSuggestions (chunked site) ---------------------------------------

describe('usePlaceSuggestions.fetchSuggestions - chunk-failure empty-cache guard (KTD8)', () => {
  it('does NOT cache a chunk-failed cluster as empty', async () => {
    // Two clusters, both uncached. The chunked mutation will succeed for c1 and
    // fail (chunk error) for c2 — we simulate by responding for c1 only and
    // throwing for c2's chunk. CHUNK_SIZE is 15 so both fit in one chunk; to get
    // a per-chunk split we rely on the mutation's failedClusterIds. Simplest: the
    // single chunk throws a non-fatal error -> both go to failedClusterIds ->
    // neither should be cached as empty.
    const c1 = makeCluster('chunk-1', 35.1, 139.1);
    const c2 = makeCluster('chunk-2', 35.2, 139.2);

    // The whole (single) chunk throws a non-fatal error.
    mockedApi.post.mockRejectedValueOnce(new Error('network blip'));

    const candidate = {
      id: 'cand-1',
      countryCode: 'JP',
      dateRange: { start: new Date(), end: new Date() },
      photoIds: [],
      photoCount: 2,
      previewUris: [],
      previewAssetIds: [],
      locationClusterIds: ['chunk-1', 'chunk-2'],
    };

    const { result } = setup([c1, c2]);

    await act(async () => {
      await result.current.fetchSuggestions(candidate);
    });

    // No empty write for failed clusters.
    if (mockedCacheSuggestions.mock.calls.length > 0) {
      const cachedIds = mockedCacheSuggestions.mock.calls.flatMap((call) =>
        call[0].map((c) => c.cluster_id)
      );
      expect(cachedIds).not.toContain('chunk-1');
      expect(cachedIds).not.toContain('chunk-2');
    }
  });

  it('still caches per-cluster timed-out clusters correctly (failed_cluster_count path preserved)', async () => {
    const c1 = makeCluster('tc-1', 35.1, 139.1);
    const c2 = makeCluster('tc-2', 35.2, 139.2);

    // Single chunk succeeds but reports one cluster timed out (failed_cluster_count=1).
    mockedApi.post.mockResolvedValueOnce({
      data: {
        suggestions: [{ cluster_id: 'tc-1', photo_ids: ['photo-tc-1'], places: [] }],
        failed_cluster_count: 1,
      },
    });

    const candidate = {
      id: 'cand-tc',
      countryCode: 'JP',
      dateRange: { start: new Date(), end: new Date() },
      photoIds: [],
      photoCount: 2,
      previewUris: [],
      previewAssetIds: [],
      locationClusterIds: ['tc-1', 'tc-2'],
    };

    const { result } = setup([c1, c2]);

    await act(async () => {
      await result.current.fetchSuggestions(candidate);
    });

    expect(mockedCacheSuggestions).toHaveBeenCalledTimes(1);
    const cachedIds = mockedCacheSuggestions.mock.calls[0][0].map((c) => c.cluster_id);
    // tc-1 responded -> cached; tc-2 timed out -> NOT cached as empty.
    expect(cachedIds).toEqual(['tc-1']);
    expect(cachedIds).not.toContain('tc-2');
  });

  // referenced to satisfy the linter for the import used in jsdoc/typing
  void clusterLocationKey;
});

// ---- retryFailedClusters (U10) ---------------------------------------------

describe('usePlaceSuggestions.retryFailedClusters (U10)', () => {
  /** Build a backend response for an explicit set of cluster ids with places. */
  const respondWith = (entries: { id: string; places?: unknown[] }[], failedCount = 0) => ({
    data: {
      suggestions: entries.map((e) => ({
        cluster_id: e.id,
        photo_ids: [`photo-${e.id}`],
        places: e.places ?? [],
      })),
      failed_cluster_count: failedCount,
    },
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

  it('SCOPE: re-fetches ONLY the explicit failed subset — chunk-1 successes are NOT re-requested', async () => {
    // c1 = a chunk-1 success the user is NOT retrying; c2 = the failed cluster.
    // The naive-reentry bug would re-request both; the scoped path requests only c2.
    const c1 = makeCluster('ok-1', 35.1, 139.1);
    const c2 = makeCluster('failed-2', 35.2, 139.2);

    mockedApi.post.mockResolvedValueOnce(respondWith([{ id: 'failed-2', places: [] }]));

    const { result } = setup([c1, c2]);

    await act(async () => {
      await result.current.retryFailedClusters(['failed-2']);
    });

    expect(mockedApi.post).toHaveBeenCalledTimes(1);
    const payload = mockedApi.post.mock.calls[0][1] as { clusters: { id: string }[] };
    const requestedIds = payload.clusters.map((c) => c.id);
    expect(requestedIds).toEqual(['failed-2']);
    expect(requestedIds).not.toContain('ok-1');
  });

  it('PARTIAL: one cluster matches (cached + surfaced), one fails again (not cached)', async () => {
    const a = makeCluster('retry-a', 35.1, 139.1);
    const b = makeCluster('retry-b', 35.2, 139.2);

    // Backend responds for retry-a (with a place) only; retry-b timed out.
    mockedApi.post.mockResolvedValueOnce(
      respondWith([{ id: 'retry-a', places: [placeFor('retry-a')] }], 1)
    );

    const { result } = setup([a, b]);

    await act(async () => {
      await result.current.retryFailedClusters(['retry-a', 'retry-b']);
    });

    // retry-a cached (responded); retry-b NOT cached (re-failed) — KTD8.
    expect(mockedCacheSuggestions).toHaveBeenCalledTimes(1);
    const cachedIds = mockedCacheSuggestions.mock.calls[0][0].map((c) => c.cluster_id);
    expect(cachedIds).toEqual(['retry-a']);
    expect(cachedIds).not.toContain('retry-b');

    // retry-a surfaced in cachedSuggestions with its place.
    const surfaced = result.current.cachedSuggestions.find((s) => s.cluster_id === 'retry-a');
    expect(surfaced?.places).toHaveLength(1);
  });

  it('RETRY-AGAIN: a re-failed cluster can be retried once more (no cap, fresh request)', async () => {
    const c = makeCluster('retry-again', 35.1, 139.1);

    // First retry: backend throws (re-fails). Second retry: succeeds with a place.
    mockedApi.post
      .mockRejectedValueOnce(new Error('network blip'))
      .mockResolvedValueOnce(
        respondWith([{ id: 'retry-again', places: [placeFor('retry-again')] }])
      );

    const { result } = setup([c]);

    await act(async () => {
      await result.current.retryFailedClusters(['retry-again']);
    });
    // Re-failed: nothing cached on the throw.
    expect(mockedCacheSuggestions).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.retryFailedClusters(['retry-again']);
    });
    // Second attempt fired a fresh request and succeeded -> cached.
    expect(mockedApi.post).toHaveBeenCalledTimes(2);
    expect(mockedCacheSuggestions).toHaveBeenCalledTimes(1);
  });

  it('RACE (I5): a second retry for the same in-flight cluster does NOT double-fire / double-cache', async () => {
    const c = makeCluster('race-1', 35.1, 139.1);

    // Gate the API response so the second invocation overlaps the first while it
    // is in flight. The in-flight guard (claimed synchronously at entry) must
    // drop the second call so only ONE request + ONE cache write happen.
    let resolveApi: ((v: unknown) => void) | undefined;
    const apiGate = new Promise((resolve) => {
      resolveApi = resolve;
    });
    mockedApi.post.mockReturnValueOnce(apiGate as never);

    const { result } = setup([c]);

    await act(async () => {
      // First call: claims race-1 synchronously, then proceeds toward api.post.
      const p1 = result.current.retryFailedClusters(['race-1']);
      // Let p1 advance past its synchronous guard-claim + awaits up to api.post.
      await Promise.resolve();
      await Promise.resolve();
      // Second call while the first is in flight — guard must drop it (no-op).
      const p2 = result.current.retryFailedClusters(['race-1']);
      // Now release the (single) in-flight API request.
      resolveApi?.(respondWith([{ id: 'race-1', places: [placeFor('race-1')] }]));
      await Promise.all([p1, p2]);
    });

    // Only ONE API call (guard dropped the second), and one cache write.
    expect(mockedApi.post).toHaveBeenCalledTimes(1);
    expect(mockedCacheSuggestions).toHaveBeenCalledTimes(1);
  });

  it('CACHE: respects the SQLite cache — a cached cluster is reused, NOT re-bought', async () => {
    const cached = makeCluster('was-cached', 35.1, 139.1);

    mockedGetCachedSuggestions.mockResolvedValueOnce(
      new Map([['was-cached', [placeFor('was-cached')]]])
    );

    const { result } = setup([cached]);

    await act(async () => {
      await result.current.retryFailedClusters(['was-cached']);
    });

    // SQLite cache hit -> no API call, surfaced from cache.
    expect(mockedApi.post).not.toHaveBeenCalled();
    const surfaced = result.current.cachedSuggestions.find((s) => s.cluster_id === 'was-cached');
    expect(surfaced?.places).toHaveLength(1);
  });

  it('M1: no Alert is shown when the retry fails', async () => {
    const c = makeCluster('m1-fail', 35.1, 139.1);
    mockedApi.post.mockRejectedValueOnce(new Error('boom'));

    const { result } = setup([c]);

    await act(async () => {
      await result.current.retryFailedClusters(['m1-fail']);
    });

    expect(mockedAlert).not.toHaveBeenCalled();
  });

  it('KTD10: retry on a 429/503-disabled cluster does NOT fire a suggest-places API call', async () => {
    // First, make the chunked mutation record the cluster as lookup-failed with
    // retryDisabled=true by throwing a fatal 429 through fetchSuggestions.
    const quota = makeCluster('quota-1', 35.1, 139.1);
    const err = new AxiosError('rate limited');
    err.response = { status: 429, headers: {}, data: {}, statusText: '', config: {} as never };
    mockedApi.post.mockRejectedValueOnce(err);

    const candidate = {
      id: 'cand-quota',
      countryCode: 'JP',
      dateRange: { start: new Date(), end: new Date() },
      photoIds: [],
      photoCount: 1,
      previewUris: [],
      previewAssetIds: [],
      locationClusterIds: ['quota-1'],
    };

    const { result } = setup([quota]);

    await act(async () => {
      await result.current.fetchSuggestions(candidate);
    });

    // The fatal 429 recorded quota-1 with retryDisabled=true.
    expect(
      result.current.suggestPlacesMutation.failedClusterIds.get('quota-1')?.retryDisabled
    ).toBe(true);

    mockedApi.post.mockClear();

    // Retrying a retryDisabled cluster must be a no-op (no API call).
    await act(async () => {
      await result.current.retryFailedClusters(['quota-1']);
    });

    expect(mockedApi.post).not.toHaveBeenCalled();
  });

  it('CANDIDATE-STALE: a candidate switch mid-retry does NOT write the old cluster into the new candidate', async () => {
    // Reproduces the cross-guard seam (correctness/adversarial/frontend-races):
    // retryFailedClusters resolving AFTER the active candidate changed must not
    // strand the old cluster's success into the new candidate's in-memory state.
    const c = makeCluster('stale-1', 35.1, 139.1);
    const candidateRef = { current: 'cand-A' } as React.RefObject<string | null>;

    // Gate the API so we can flip the active candidate while the retry is in flight.
    let resolveApi: ((v: unknown) => void) | undefined;
    const apiGate = new Promise((resolve) => {
      resolveApi = resolve;
    });
    mockedApi.post.mockReturnValueOnce(apiGate as never);

    const { result } = setup([c], candidateRef);

    await act(async () => {
      const p = result.current.retryFailedClusters(['stale-1']);
      await Promise.resolve();
      await Promise.resolve();
      // User switches candidates while the retry is in flight.
      candidateRef.current = 'cand-B';
      resolveApi?.(respondWith([{ id: 'stale-1', places: [placeFor('stale-1')] }]));
      await p;
    });

    // SQLite cache write still happens (location-keyed, useful on return)...
    expect(mockedCacheSuggestions).toHaveBeenCalledTimes(1);
    // ...but the resolved place is NOT written into the now-active candidate's
    // in-memory state, and the cluster is not re-added to failedClusterIds.
    expect(
      result.current.cachedSuggestions.find((s) => s.cluster_id === 'stale-1')
    ).toBeUndefined();
    expect(result.current.suggestPlacesMutation.failedClusterIds.has('stale-1')).toBe(false);
  });

  it('CANDIDATE-STALE: switch-away-then-back to the SAME candidate keeps the result (live-ref check)', async () => {
    const c = makeCluster('return-1', 35.1, 139.1);
    const candidateRef = { current: 'cand-A' } as React.RefObject<string | null>;

    let resolveApi: ((v: unknown) => void) | undefined;
    const apiGate = new Promise((resolve) => {
      resolveApi = resolve;
    });
    mockedApi.post.mockReturnValueOnce(apiGate as never);

    const { result } = setup([c], candidateRef);

    await act(async () => {
      const p = result.current.retryFailedClusters(['return-1']);
      await Promise.resolve();
      await Promise.resolve();
      // Switch away and back to the same candidate before the retry resolves.
      candidateRef.current = 'cand-B';
      candidateRef.current = 'cand-A';
      resolveApi?.(respondWith([{ id: 'return-1', places: [placeFor('return-1')] }]));
      await p;
    });

    // Live-ref equals the request candidate again -> NOT stale -> result kept.
    const surfaced = result.current.cachedSuggestions.find((s) => s.cluster_id === 'return-1');
    expect(surfaced?.places).toHaveLength(1);
  });
});

// ---- B3: stale-request discard decision (pinned against the LIVE ref) -------

describe('usePlaceSuggestions.fetchSuggestions — B3 stale-request guard (live ref)', () => {
  /**
   * Build a candidate whose clusters are ALL cached, so fetchSuggestions takes
   * the cache-only path. The discard decision (isStaleRequest) gates whether the
   * cached results are applied to in-memory state — a direct, non-SQLite-masked
   * observation of the guard.
   */
  const buildCandidate = (clusterIds: string[], id = 'cand-A') => ({
    id,
    countryCode: 'JP',
    dateRange: { start: new Date(), end: new Date() },
    photoIds: [],
    photoCount: clusterIds.length,
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

  it('KEEPS the active candidate results when the live ref still equals the request id at resolution', async () => {
    const c1 = makeCluster('keep-1', 35.1, 139.1);
    // All clusters cached so we exercise the cached-results stale check.
    mockedGetCachedSuggestions.mockResolvedValue(new Map([['keep-1', [placeFor('keep-1')]]]));

    const ref = { current: 'cand-A' } as React.RefObject<string | null>;
    const { result } = setup([c1], ref);

    await act(async () => {
      // Ref stays on cand-A throughout — never switched away.
      await result.current.fetchSuggestions(buildCandidate(['keep-1'], 'cand-A'));
    });

    // Live ref === request id at resolution -> results KEPT (applied to state).
    const surfaced = result.current.cachedSuggestions.find((s) => s.cluster_id === 'keep-1');
    expect(surfaced?.places).toHaveLength(1);
  });

  it('DISCARDS results when the live ref genuinely differs at resolution (switched away)', async () => {
    const c1 = makeCluster('drop-1', 35.1, 139.1);
    const ref = { current: 'cand-A' } as React.RefObject<string | null>;

    // Flip the ref to a DIFFERENT candidate during the async cache lookup — i.e.
    // the user switched away before the cached results resolve. The stale guard
    // reads `.current` LIVE, so this must discard.
    mockedGetCachedSuggestions.mockImplementation(async () => {
      ref.current = 'cand-OTHER';
      return new Map([['drop-1', [placeFor('drop-1')]]]);
    });

    const { result } = setup([c1], ref);

    await act(async () => {
      await result.current.fetchSuggestions(buildCandidate(['drop-1'], 'cand-A'));
    });

    // Live ref !== request id -> results DISCARDED (never applied to state).
    expect(result.current.cachedSuggestions).toHaveLength(0);
  });

  it('RECOVERS when the user switches away and BACK to the same candidate before resolution', async () => {
    // This is the B3 bug the plan pins: a candidate-switch-then-re-entry must NOT
    // discard the in-flight result, because the LIVE ref equals the request id
    // again at resolution. A closure that captured the ref's VALUE (not `.current`)
    // would wrongly discard here — proving the guard reads the live ref.
    const c1 = makeCluster('back-1', 35.1, 139.1);
    const ref = { current: 'cand-A' } as React.RefObject<string | null>;

    mockedGetCachedSuggestions.mockImplementation(async () => {
      // Switch AWAY...
      ref.current = 'cand-OTHER';
      // ...then BACK to the original candidate before the result is applied.
      ref.current = 'cand-A';
      return new Map([['back-1', [placeFor('back-1')]]]);
    });

    const { result } = setup([c1], ref);

    await act(async () => {
      await result.current.fetchSuggestions(buildCandidate(['back-1'], 'cand-A'));
    });

    // Ref is back on cand-A at resolution -> results KEPT (recovered), not stuck empty.
    const surfaced = result.current.cachedSuggestions.find((s) => s.cluster_id === 'back-1');
    expect(surfaced?.places).toHaveLength(1);
  });

  it('does not discard when no currentCandidateIdRef is provided (guard inert)', async () => {
    const c1 = makeCluster('noref-1', 35.1, 139.1);
    mockedGetCachedSuggestions.mockResolvedValue(new Map([['noref-1', [placeFor('noref-1')]]]));

    // No ref passed -> isStaleRequest always false -> always kept.
    const { result } = setup([c1]);

    await act(async () => {
      await result.current.fetchSuggestions(buildCandidate(['noref-1'], 'cand-A'));
    });

    const surfaced = result.current.cachedSuggestions.find((s) => s.cluster_id === 'noref-1');
    expect(surfaced?.places).toHaveLength(1);
  });
});
