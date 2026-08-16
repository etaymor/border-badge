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
import {
  CHUNK_SIZE,
  FIRST_CHUNK_SIZE,
  planSuggestionBatches,
  suggestionDispatch,
} from '@hooks/usePhotoImport';
import { getVisionImagesForCluster } from '@services/photoImport/visionPhoto';
import { useIsPremium, useCanImportPhotos, useSubscriptionStore } from '@stores/subscriptionStore';
import { api } from '@services/api';
import { Analytics } from '@services/analytics';
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
  currentCandidateIdRef?: React.RefObject<string | null>,
  selectedTripId: string | null = null
) {
  const lookup = new Map<string, LocationCluster>();
  for (const c of clusters) lookup.set(c.id, c);
  mockedGetFullCluster.mockImplementation((id: string) => lookup.get(id));
  const clusterLookupRef = { current: lookup } as React.RefObject<Map<string, LocationCluster>>;
  const queryClient = createTestQueryClient();
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(
    () => usePlaceSuggestions({ clusterLookupRef, currentCandidateIdRef, selectedTripId }),
    {
      wrapper,
    }
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  // The dispatch controller is a module-level singleton (KTD21): without this a
  // test that leaves an owner or a failure map behind cascades into the next.
  suggestionDispatch.resetForTests();
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
    expect(result.current.suggestionDispatch.failedClusterIds.get('quota-1')?.retryDisabled).toBe(
      true
    );

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
    expect(result.current.suggestionDispatch.failedClusterIds.has('stale-1')).toBe(false);
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

// ---- U15 instrumentation ---------------------------------------------------

describe('usePlaceSuggestions - timing instrumentation (U15)', () => {
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

  const lastCompletedProps = () =>
    (Analytics.photoImportSuggestionsCompleted as jest.Mock).mock.calls.at(-1)?.[0];

  it('records time to first suggestion when the FIRST batch resolves, not at the end', async () => {
    // CHUNK_SIZE is 5, so 6 clusters span two chunks. Chunk 1 resolves at once;
    // chunk 2 is held for ~120ms, so a time-to-first-suggestion measured at the
    // end of the whole request would be indistinguishable from wall clock.
    const clusters = Array.from({ length: 6 }, (_, i) => makeCluster(`t-${i}`, 35 + i, 139));

    mockedApi.post
      .mockResolvedValueOnce({
        data: {
          suggestions: clusters.slice(0, 5).map((c) => ({
            cluster_id: c.id,
            photo_ids: [`photo-${c.id}`],
            places: [placeFor(c.id)],
          })),
          failed_cluster_count: 0,
        },
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve({
                  data: {
                    suggestions: [
                      { cluster_id: 't-5', photo_ids: ['photo-t-5'], places: [placeFor('t-5')] },
                    ],
                    failed_cluster_count: 0,
                  },
                }),
              120
            )
          )
      );

    const { result } = setup(clusters);

    await act(async () => {
      await result.current.fetchSuggestions(
        buildCandidate(
          clusters.map((c) => c.id),
          'cand-timing'
        )
      );
    });

    const props = lastCompletedProps();
    expect(typeof props.timeToFirstSuggestionMs).toBe('number');
    expect(typeof props.wallClockMs).toBe('number');
    expect(props.timeToFirstSuggestionMs).toBeGreaterThanOrEqual(0);
    // First batch landed well before the request finished.
    expect(props.wallClockMs - props.timeToFirstSuggestionMs).toBeGreaterThanOrEqual(60);
    expect(props.wallClockMs).toBeGreaterThanOrEqual(props.timeToFirstSuggestionMs);
  });

  it('keeps the existing per-batch duration and percentile fields computing as before', async () => {
    const clusters = [makeCluster('p-1', 35.1, 139.1)];

    mockedApi.post.mockResolvedValueOnce({
      data: {
        suggestions: [{ cluster_id: 'p-1', photo_ids: ['photo-p-1'], places: [placeFor('p-1')] }],
        failed_cluster_count: 0,
      },
    });

    const { result } = setup(clusters);

    await act(async () => {
      await result.current.fetchSuggestions(buildCandidate(['p-1'], 'cand-pct'));
    });

    const props = lastCompletedProps();
    // Still sourced from calculateApiPercentiles (mocked to 100/200/300).
    expect(props.apiP50Ms).toBe(100);
    expect(props.apiP95Ms).toBe(200);
    expect(props.apiP99Ms).toBe(300);
    expect(typeof props.totalApiDurationMs).toBe('number');
    expect(props.suggestionCount).toBe(1);
    expect(props.cachedClusters).toBe(0);
    expect(props.uncachedClusters).toBe(1);
    expect(props.cacheHitRate).toBe(0);
  });

  it('records timings on the all-cached path too, with no identifiers in the event (R27)', async () => {
    const clusters = [makeCluster('c-1', 35.1, 139.1)];
    mockedGetCachedSuggestions.mockResolvedValue(new Map([['c-1', [placeFor('c-1')]]]));

    const { result } = setup(clusters);

    await act(async () => {
      await result.current.fetchSuggestions(buildCandidate(['c-1'], 'cand-cached'));
    });

    const props = lastCompletedProps();
    expect(typeof props.timeToFirstSuggestionMs).toBe('number');
    expect(typeof props.wallClockMs).toBe('number');
    expect(props.cacheHitRate).toBe(100);

    // R27: the event carries per-batch aggregates only.
    const serialized = JSON.stringify(props);
    for (const forbidden of ['c-1', 'ChIJ_', '35.1', '139.1']) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});

// ---- Dispatch owner accounting (U2 / R1 / KTD13) ---------------------------

describe('usePlaceSuggestions dispatch owner accounting (R1/KTD13)', () => {
  const buildCandidate = (clusterIds: string[], id = 'cand-owner') => ({
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

  // `jest.clearAllMocks()` clears usage data but keeps a `mockReturnValue`, so
  // the premium-gate test below would leak a gated user into its neighbours.
  afterEach(() => {
    (useIsPremium as jest.MockedFunction<typeof useIsPremium>).mockReturnValue(true);
    (useCanImportPhotos as jest.MockedFunction<typeof useCanImportPhotos>).mockReturnValue(true);
  });

  it('settles after the already-processed early return', async () => {
    const c1 = makeCluster('own-1', 35.1, 139.1);
    mockedGetCachedSuggestions.mockResolvedValue(new Map([['own-1', [placeFor('own-1')]]]));

    const { result } = setup([c1]);
    const candidate = buildCandidate(['own-1']);

    await act(async () => {
      await result.current.fetchSuggestions(candidate);
    });
    expect(result.current.isFetchingSuggestions).toBe(false);

    // Second call short-circuits on `fetchedCandidatesRef` before any await.
    await act(async () => {
      await result.current.fetchSuggestions(candidate);
    });
    expect(result.current.isFetchingSuggestions).toBe(false);
  });

  it('settles after the no-clusters early return', async () => {
    // getFullCluster resolves nothing for this candidate's ids.
    mockedGetFullCluster.mockImplementation(() => undefined);
    const { result } = setup([]);

    await act(async () => {
      await result.current.fetchSuggestions(buildCandidate(['missing-1']));
    });

    expect(mockedApi.post).not.toHaveBeenCalled();
    expect(result.current.isFetchingSuggestions).toBe(false);
  });

  it('settles after the gatedByPremium early return', async () => {
    (useIsPremium as jest.MockedFunction<typeof useIsPremium>).mockReturnValue(false);
    (useCanImportPhotos as jest.MockedFunction<typeof useCanImportPhotos>).mockReturnValue(false);

    const c1 = makeCluster('gated-1', 35.1, 139.1);
    const { result } = setup([c1]);

    let outcome: { gatedByPremium: true } | undefined;
    await act(async () => {
      outcome = await result.current.fetchSuggestions(buildCandidate(['gated-1']));
    });

    expect(outcome).toEqual({ gatedByPremium: true });
    expect(result.current.isFetchingSuggestions).toBe(false);
  });

  it('settles after the all-cached early return', async () => {
    const c1 = makeCluster('cached-only', 35.1, 139.1);
    mockedGetCachedSuggestions.mockResolvedValue(
      new Map([['cached-only', [placeFor('cached-only')]]])
    );

    const { result } = setup([c1]);

    await act(async () => {
      await result.current.fetchSuggestions(buildCandidate(['cached-only']));
    });

    expect(mockedApi.post).not.toHaveBeenCalled();
    expect(result.current.isFetchingSuggestions).toBe(false);
  });

  it('settles after a fetch that THROWS out of fetchSuggestions', async () => {
    // The SQLite cache read sits outside the hook's internal try/catch, so a
    // rejection there propagates out of fetchSuggestions. The owner must still
    // be released — a stranded owner would withhold terminal rows forever.
    const c1 = makeCluster('throw-1', 35.1, 139.1);
    mockedGetCachedSuggestions.mockRejectedValueOnce(new Error('sqlite exploded'));

    const { result } = setup([c1]);

    await act(async () => {
      await expect(result.current.fetchSuggestions(buildCandidate(['throw-1']))).rejects.toThrow(
        'sqlite exploded'
      );
    });

    expect(result.current.isFetchingSuggestions).toBe(false);
  });

  it('stays in progress until BOTH overlapping owners settle (KTD13)', async () => {
    const a = makeCluster('overlap-a', 35.1, 139.1);
    const b = makeCluster('overlap-b', 35.2, 139.2);

    let resolveFirst!: (value: unknown) => void;
    let resolveSecond!: (value: unknown) => void;
    mockedApi.post
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve as (value: unknown) => void;
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecond = resolve as (value: unknown) => void;
          })
      );

    const { result } = setup([a, b]);

    let firstDone!: Promise<unknown>;
    let secondDone!: Promise<unknown>;
    await act(async () => {
      firstDone = result.current.fetchForClusters([a]);
      secondDone = result.current.fetchForClusters([b]);
    });

    expect(result.current.isFetchingSuggestions).toBe(true);

    // First owner settles — the second is still on the wire, so "settled" must
    // NOT be reported (a plain boolean would flip false here).
    await act(async () => {
      resolveFirst({
        data: {
          suggestions: [
            { cluster_id: 'overlap-a', photo_ids: ['photo-overlap-a'], places: [placeFor('a')] },
          ],
          failed_cluster_count: 0,
        },
      });
      await firstDone;
    });
    expect(result.current.isFetchingSuggestions).toBe(true);

    await act(async () => {
      resolveSecond({
        data: {
          suggestions: [
            { cluster_id: 'overlap-b', photo_ids: ['photo-overlap-b'], places: [placeFor('b')] },
          ],
          failed_cluster_count: 0,
        },
      });
      await secondDone;
    });
    expect(result.current.isFetchingSuggestions).toBe(false);
  });

  it('does NOT append a split result into the candidate the user switched to', async () => {
    const split = makeCluster('split-stale', 35.1, 139.1);

    let resolveApi!: (value: unknown) => void;
    mockedApi.post.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveApi = resolve as (value: unknown) => void;
        })
    );

    const ref = { current: 'cand-A' } as React.RefObject<string | null>;
    const { result } = setup([split], ref);

    let splitDone!: Promise<unknown>;
    await act(async () => {
      splitDone = result.current.fetchForClusters([split]);
    });

    // User switches candidates while the split lookup is in flight.
    ref.current = 'cand-B';

    await act(async () => {
      resolveApi({
        data: {
          suggestions: [
            {
              cluster_id: 'split-stale',
              photo_ids: ['photo-split-stale'],
              places: [placeFor('split-stale')],
            },
          ],
          failed_cluster_count: 0,
        },
      });
      await splitDone;
    });

    // The SQLite write still happened (location-keyed, useful on return)...
    expect(mockedCacheSuggestions).toHaveBeenCalled();
    // ...but the old candidate's sub-cluster was NOT appended to the new one.
    expect(result.current.cachedSuggestions.map((s) => s.cluster_id)).not.toContain('split-stale');
    expect(result.current.isFetchingSuggestions).toBe(false);
  });
});

// ---- Pipelined preparation (U5 / R5, R24) ----------------------------------

describe('usePlaceSuggestions pipelined preparation (U5)', () => {
  const mockedGetVisionImages = getVisionImagesForCluster as jest.MockedFunction<
    typeof getVisionImagesForCluster
  >;

  const buildCandidate = (clusterIds: string[], id = 'cand-pipeline') => ({
    id,
    countryCode: 'JP',
    dateRange: { start: new Date(), end: new Date() },
    photoIds: [],
    photoCount: clusterIds.length,
    previewUris: [],
    previewAssetIds: [],
    locationClusterIds: clusterIds,
  });

  afterEach(() => {
    mockedGetVisionImages.mockResolvedValue([]);
  });

  it('dispatches the first batch while later batches are still being prepared', async () => {
    // Enough clusters to span two batches under the U5 ramp (2, then 5).
    const clusters = Array.from({ length: FIRST_CHUNK_SIZE + CHUNK_SIZE }, (_, i) =>
      makeCluster(`pipe-${i}`, 35 + i * 0.01, 139)
    );
    const firstBatchIds = new Set(planSuggestionBatches(clusters)[0].map((c) => c.id));

    let releaseLaterPrep!: () => void;
    const laterPrepGate = new Promise<void>((resolve) => {
      releaseLaterPrep = resolve;
    });
    let laterPrepFinished = false;
    let laterPrepStarted = false;

    mockedGetVisionImages.mockImplementation(async (cluster) => {
      if (firstBatchIds.has(cluster.id)) return ['first-batch-image'];
      laterPrepStarted = true;
      await laterPrepGate;
      laterPrepFinished = true;
      return ['later-batch-image'];
    });

    const observed: { laterPrepStarted?: boolean; laterPrepFinished?: boolean } = {};
    mockedApi.post.mockImplementation(async () => {
      if (mockedApi.post.mock.calls.length === 1) {
        observed.laterPrepStarted = laterPrepStarted;
        observed.laterPrepFinished = laterPrepFinished;
      }
      return { data: { suggestions: [], failed_cluster_count: 0 } };
    });

    const { result } = setup(clusters);

    let done!: Promise<unknown>;
    await act(async () => {
      done = result.current.fetchSuggestions(buildCandidate(clusters.map((c) => c.id)));
      // Flush up to the point where batch two's preparation is the only thing
      // outstanding.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // Batch one's request went out before batch two finished preparing...
    expect(mockedApi.post).toHaveBeenCalledTimes(1);
    expect(observed.laterPrepFinished).toBe(false);
    // ...and batch two's preparation had already begun by then.
    expect(observed.laterPrepStarted).toBe(true);
    // The owner slot stays claimed across the WHOLE pipeline, including while
    // later batches are still being prepared.
    expect(result.current.isFetchingSuggestions).toBe(true);

    await act(async () => {
      releaseLaterPrep();
      await done;
    });

    expect(mockedApi.post).toHaveBeenCalledTimes(2);
    // Only the batch about to be dispatched carries encoded images.
    const firstBody = mockedApi.post.mock.calls[0][1] as {
      clusters: { id: string; vision_images_base64?: string[] }[];
    };
    expect(firstBody.clusters.map((c) => c.id)).toEqual([...firstBatchIds]);
    expect(
      firstBody.clusters.every((c) => c.vision_images_base64?.[0] === 'first-batch-image')
    ).toBe(true);
    const secondBody = mockedApi.post.mock.calls[1][1] as {
      clusters: { id: string; vision_images_base64?: string[] }[];
    };
    expect(
      secondBody.clusters.every((c) => c.vision_images_base64?.[0] === 'later-batch-image')
    ).toBe(true);
    // Released once ALL of it settled.
    expect(result.current.isFetchingSuggestions).toBe(false);
  });

  it('a preparation failure for one cluster does not reject the pipeline', async () => {
    const clusters = Array.from({ length: FIRST_CHUNK_SIZE + 1 }, (_, i) =>
      makeCluster(`fail-${i}`, 35 + i * 0.01, 139)
    );

    mockedGetVisionImages.mockImplementation(async (cluster) => {
      if (cluster.id === 'fail-0') throw new Error('decode exploded');
      return ['ok-image'];
    });
    mockedApi.post.mockResolvedValue({ data: { suggestions: [], failed_cluster_count: 0 } });

    const { result } = setup(clusters);

    await act(async () => {
      await result.current.fetchSuggestions(buildCandidate(clusters.map((c) => c.id)));
    });

    // Both batches still dispatched; the failing cluster simply went without
    // vision images.
    expect(mockedApi.post).toHaveBeenCalledTimes(2);
    const firstBody = mockedApi.post.mock.calls[0][1] as {
      clusters: { id: string; vision_images_base64?: string[] }[];
    };
    expect(firstBody.clusters.map((c) => c.id)).toEqual(['fail-0', 'fail-1']);
    expect(firstBody.clusters[0].vision_images_base64).toBeUndefined();
    expect(firstBody.clusters[1].vision_images_base64).toEqual(['ok-image']);
    expect(result.current.isFetchingSuggestions).toBe(false);
  });
});

// ---- Callback identity across the dispatch seam (U14) -----------------------

describe('usePlaceSuggestions callback identity (U14)', () => {
  const buildCandidate = (clusterIds: string[], id = 'cand-identity') => ({
    id,
    countryCode: 'JP',
    dateRange: { start: new Date(), end: new Date() },
    photoIds: [],
    photoCount: clusterIds.length,
    previewUris: [],
    previewAssetIds: [],
    locationClusterIds: clusterIds,
  });

  it('keeps the retry callback stable across dispatch progress updates', async () => {
    // Enough clusters for several batches, so the controller publishes progress,
    // partial results, and claim-set changes mid-run. Before U14 the retry
    // callback depended on the mutation's state container and was rebuilt on
    // every one of those updates.
    const clusters = Array.from({ length: FIRST_CHUNK_SIZE + CHUNK_SIZE * 2 }, (_, i) =>
      makeCluster(`ident-${i}`, 35 + i * 0.01, 139)
    );
    mockedApi.post.mockResolvedValue({ data: { suggestions: [], failed_cluster_count: 0 } });

    const { result } = setup(clusters);
    const before = {
      retryFailedClusters: result.current.retryFailedClusters,
      fetchForClusters: result.current.fetchForClusters,
      beginFetchOwner: result.current.beginFetchOwner,
      endFetchOwner: result.current.endFetchOwner,
    };

    await act(async () => {
      await result.current.fetchSuggestions(buildCandidate(clusters.map((c) => c.id)));
    });

    // The dispatch really did publish intermediate state.
    expect(mockedApi.post).toHaveBeenCalledTimes(planSuggestionBatches(clusters).length);
    expect(result.current.retryFailedClusters).toBe(before.retryFailedClusters);
    expect(result.current.fetchForClusters).toBe(before.fetchForClusters);
    // The owner-count callbacks are controller methods, so they are stable for
    // the five call sites that take them as props.
    expect(result.current.beginFetchOwner).toBe(before.beginFetchOwner);
    expect(result.current.endFetchOwner).toBe(before.endFetchOwner);
  });
});

// ---- U6: partial resolution, the cache allow-list, and coverage --------------

describe('usePlaceSuggestions partial dispatch (U6 / KTD6, KTD14, R20)', () => {
  const buildCandidate = (clusterIds: string[], id = 'cand-partial') => ({
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

  /** Three batches under the U5 ramp: 2 / 5 / 5. */
  const THREE_BATCH_COUNT = FIRST_CHUNK_SIZE + CHUNK_SIZE * 2;
  const buildClusters = () =>
    Array.from({ length: THREE_BATCH_COUNT }, (_, i) =>
      makeCluster(`pt-${i}`, 35 + i * 0.01, 139 + i * 0.01)
    );

  const respondFor = (ids: string[]) => ({
    data: {
      suggestions: ids.map((id) => ({
        cluster_id: id,
        photo_ids: [`photo-${id}`],
        places: [placeFor(id)],
      })),
      // ZERO failures — the escape hatch this unit deletes keyed on exactly this.
      failed_cluster_count: 0,
    },
  });

  const cachedIds = () =>
    mockedCacheSuggestions.mock.calls.flatMap((call) => call[0].map((row) => row.cluster_id));

  const rateLimited = () => {
    const err = new AxiosError('rate limited');
    err.response = {
      status: 429,
      headers: { 'retry-after': '1' },
      data: {},
      statusText: '',
      config: {} as never,
    };
    return err;
  };

  it('writes NO cache row for a never-dispatched cluster, even at a zero failure count', async () => {
    const clusters = buildClusters();
    const batches = planSuggestionBatches(clusters).map((b) => b.map((c) => c.id));

    mockedApi.post
      .mockResolvedValueOnce(respondFor(batches[0]))
      .mockRejectedValueOnce(rateLimited());

    const { result } = setup(clusters);

    await act(async () => {
      await result.current.fetchSuggestions(buildCandidate(clusters.map((c) => c.id)));
    });

    // Batch 3 never went out. The old deny-list admitted it anyway — the run
    // reported failed_cluster_count 0, so "no per-cluster failures" was read as
    // "full coverage" and every unanswered cluster was written as `[]` and
    // cached for 24h, indistinguishable from a genuine no-place-found.
    for (const id of batches[2]) expect(cachedIds()).not.toContain(id);
    // The rejected batch is excluded too...
    for (const id of batches[1]) expect(cachedIds()).not.toContain(id);
    // ...while the batch that actually answered keeps its rows.
    expect(cachedIds().sort()).toEqual([...batches[0]].sort());
  });

  it('KTD14: a cluster its own batch omitted is not cached, even at a zero failure count', async () => {
    // The deleted escape hatch was `|| failed_cluster_count === 0`: a GLOBAL
    // property of the run standing in for per-cluster evidence. Here batch 1
    // answers for only one of its two clusters and reports no failures at all,
    // so the hatch would have written the omitted cluster as `[]` for 24h.
    // Every term of the allow-list is now about the cluster itself.
    const clusters = buildClusters();
    const batches = planSuggestionBatches(clusters).map((b) => b.map((c) => c.id));

    mockedApi.post
      .mockResolvedValueOnce(respondFor(batches[0].slice(0, 1)))
      .mockResolvedValueOnce(respondFor(batches[1]))
      .mockResolvedValueOnce(respondFor(batches[2]));

    const { result } = setup(clusters);

    await act(async () => {
      await result.current.fetchSuggestions(buildCandidate(clusters.map((c) => c.id)));
    });

    expect(cachedIds()).not.toContain(batches[0][1]);
    expect(cachedIds().sort()).toEqual([batches[0][0], ...batches[1], ...batches[2]].sort());
  });

  it('writes no cache row for undispatched clusters when the fetch is aborted mid-flight', async () => {
    const clusters = buildClusters();
    const batches = planSuggestionBatches(clusters).map((b) => b.map((c) => c.id));

    // Model axios: the request rejects the moment its signal aborts.
    mockedApi.post.mockImplementation(
      (_url, _body, config) =>
        new Promise((_resolve, reject) => {
          const signal = (config as { signal?: AbortSignal } | undefined)?.signal;
          signal?.addEventListener('abort', () => reject(new Error('canceled')));
        }) as never
    );

    const { result } = setup(clusters);

    let done!: Promise<unknown>;
    await act(async () => {
      done = result.current.fetchSuggestions(buildCandidate(clusters.map((c) => c.id)));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await act(async () => {
      result.current.resetSuggestionDispatch();
      await done;
    });

    // Nothing answered, so nothing may be cached — not the batch that was
    // canceled on the wire, and certainly not the two that never left.
    expect(cachedIds()).toEqual([]);
    expect(batches).toHaveLength(3);
    expect(result.current.isFetchingSuggestions).toBe(false);
  });

  it('re-fetches the uncovered clusters on a same-session re-entry, without unmounting', async () => {
    const clusters = buildClusters();
    const batches = planSuggestionBatches(clusters).map((b) => b.map((c) => c.id));
    const candidate = buildCandidate(clusters.map((c) => c.id));

    mockedApi.post
      .mockResolvedValueOnce(respondFor(batches[0]))
      .mockRejectedValueOnce(rateLimited());

    const { result } = setup(clusters);

    await act(async () => {
      await result.current.fetchSuggestions(candidate);
    });
    expect(mockedApi.post).toHaveBeenCalledTimes(2);

    // Re-entry. Batch 1's clusters come back from the SQLite cache (so they are
    // not re-bought); everything the partial stop left uncovered must go out
    // again. The candidate-fetched marker used to be set on ANY resolution,
    // which made this second call return before touching the network and left
    // those clusters unlooked-up for the rest of the session.
    mockedApi.post.mockClear();
    mockedGetCachedSuggestions.mockResolvedValue(
      new Map(batches[0].map((id) => [id, [placeFor(id)]]))
    );
    mockedApi.post.mockResolvedValue({
      data: { suggestions: [], failed_cluster_count: 0 },
    });

    await act(async () => {
      await result.current.fetchSuggestions(candidate);
    });

    expect(mockedApi.post).toHaveBeenCalled();
    const reRequested = mockedApi.post.mock.calls.flatMap((call) =>
      (call[1] as { clusters: { id: string }[] }).clusters.map((c) => c.id)
    );
    for (const id of [...batches[1], ...batches[2]]) expect(reRequested).toContain(id);
    for (const id of batches[0]) expect(reRequested).not.toContain(id);
  });

  it('short-circuits a re-entry when the first run covered every cluster', async () => {
    const clusters = buildClusters();
    const batches = planSuggestionBatches(clusters).map((b) => b.map((c) => c.id));
    const candidate = buildCandidate(
      clusters.map((c) => c.id),
      'cand-covered'
    );

    mockedApi.post
      .mockResolvedValueOnce(respondFor(batches[0]))
      // A batch that FAILED is still covered: it was attempted, and the scoped
      // retry path owns its recovery. Only a never-dispatched batch reopens the
      // candidate.
      .mockRejectedValueOnce(new Error('network blip'))
      .mockResolvedValueOnce(respondFor(batches[2]));

    const { result } = setup(clusters);

    await act(async () => {
      await result.current.fetchSuggestions(candidate);
    });
    expect(mockedApi.post).toHaveBeenCalledTimes(3);

    mockedApi.post.mockClear();
    await act(async () => {
      await result.current.fetchSuggestions(candidate);
    });

    expect(mockedApi.post).not.toHaveBeenCalled();
  });

  it('still reports the fatal error to analytics now that dispatch resolves partially', async () => {
    const clusters = buildClusters();
    const batches = planSuggestionBatches(clusters).map((b) => b.map((c) => c.id));

    mockedApi.post
      .mockResolvedValueOnce(respondFor(batches[0]))
      .mockRejectedValueOnce(rateLimited());

    const { result } = setup(clusters);

    await act(async () => {
      await result.current.fetchSuggestions(buildCandidate(clusters.map((c) => c.id)));
    });

    expect(Analytics.photoImportApiError).toHaveBeenCalledWith({ errorType: 'rate_limited' });
    // U11 note: the rate-limit scenario now emits COMPLETION as well as an
    // error, with a lower suggestion count than that population ever had.
    expect(Analytics.photoImportSuggestionsCompleted).toHaveBeenCalled();
  });
});

// ---- U6: entitlement accounting preserved across partial resolution ---------

describe('usePlaceSuggestions free-tier accounting across a partial dispatch (U6)', () => {
  // `jest.clearAllMocks()` clears usage data but KEEPS a `mockReturnValue`, so
  // these have to be put back by hand or they leak into every later test.
  afterEach(() => {
    (useIsPremium as jest.MockedFunction<typeof useIsPremium>).mockReturnValue(true);
    (useCanImportPhotos as jest.MockedFunction<typeof useCanImportPhotos>).mockReturnValue(true);
    (useSubscriptionStore as unknown as jest.Mock).mockImplementation(() => jest.fn());
  });

  it('does not spend a free user’s import through the local store any more (U10)', async () => {
    // Pre-U6 the fatal error threw past the usage increment, so a rate-limited
    // import was not charged; U6 preserved that with a `fatalError === null`
    // term. U10 REPLACED that whole block: the import is claimed on the first
    // SUCCESSFUL batch and recorded on the SERVER (see
    // photoImportEntitlement.test.tsx), because progressive results make a
    // partly-matched trip the normal case and an end-of-fetch charge would
    // leave most free imports uncounted.
    //
    // What this test still pins is that nothing charges through the LOCAL
    // store's `incrementPhotoImportUsage` — the counter that was silently
    // overwritten on every usage refetch — and that a run with no trip id
    // charges nothing at all, since without one the server has no consuming
    // trip to exempt later.
    const incrementPhotoImportUsage = jest.fn();
    (useIsPremium as jest.MockedFunction<typeof useIsPremium>).mockReturnValue(false);
    (useCanImportPhotos as jest.MockedFunction<typeof useCanImportPhotos>).mockReturnValue(true);
    (useSubscriptionStore as unknown as jest.Mock).mockReturnValue(incrementPhotoImportUsage);

    const clusters = Array.from({ length: FIRST_CHUNK_SIZE + CHUNK_SIZE }, (_, i) =>
      makeCluster(`fr-${i}`, 35 + i * 0.01, 139)
    );
    const err = new AxiosError('rate limited');
    err.response = {
      status: 429,
      headers: { 'retry-after': '1' },
      data: {},
      statusText: '',
      config: {} as never,
    };
    mockedApi.post
      .mockResolvedValueOnce({ data: { suggestions: [], failed_cluster_count: 0 } })
      .mockRejectedValueOnce(err);

    const { result } = setup(clusters);

    await act(async () => {
      await result.current.fetchSuggestions({
        id: 'cand-free',
        countryCode: 'JP',
        dateRange: { start: new Date(), end: new Date() },
        photoIds: [],
        photoCount: clusters.length,
        previewUris: [],
        previewAssetIds: [],
        locationClusterIds: clusters.map((c) => c.id),
      });
    });

    expect(incrementPhotoImportUsage).not.toHaveBeenCalled();
    expect(
      mockedApi.post.mock.calls.filter((call) => call[0] === '/subscriptions/usage/increment')
    ).toHaveLength(0);
  });
});
