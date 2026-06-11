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

function setup(clusters: LocationCluster[]) {
  const lookup = new Map<string, LocationCluster>();
  for (const c of clusters) lookup.set(c.id, c);
  mockedGetFullCluster.mockImplementation((id: string) => lookup.get(id));
  const clusterLookupRef = { current: lookup } as React.RefObject<Map<string, LocationCluster>>;
  const queryClient = createTestQueryClient();
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(() => usePlaceSuggestions({ clusterLookupRef }), { wrapper });
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
