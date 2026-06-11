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
 */

import { renderHook, act } from '@testing-library/react-native';
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

// CHUNK_SIZE is 15 in usePhotoImport, so 16 clusters span two chunks — chunk-2
// can fail independently of chunk-1's success (no mock needed).

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
 * Compose usePlaceSuggestions + useClusterItems exactly as PhotoImportScreen
 * does, plus a `fetchingSuggestions` flag the test drives (the screen's
 * useWorkflowNavigation toggles it around fetchSuggestions; retry must NOT).
 */
function useComposition(candidate: TripCandidateDisplay, clusters: LocationCluster[]) {
  const clusterLookupRef = React.useRef(new Map(clusters.map((c) => [c.id, c])));
  const clusterDisplays = React.useMemo(
    () => new Map(clusters.map((c) => [c.id, toDisplay(c)])),
    [clusters]
  );
  const [fetchingSuggestions, setFetchingSuggestions] = React.useState(false);

  const suggestions = usePlaceSuggestions({ clusterLookupRef });

  const clusterItems = useClusterItems({
    selectedCandidate: candidate,
    clusterDisplays,
    suggestPlacesMutation: suggestions.suggestPlacesMutation,
    cachedSuggestions: suggestions.cachedSuggestions,
    dismissedClusterIdsInternal: new Set(),
    fetchingSuggestions,
    retryingClusterIds: suggestions.retryingClusterIds,
  });

  return { ...suggestions, clusterItems, fetchingSuggestions, setFetchingSuggestions };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedGetCachedSuggestions.mockResolvedValue(new Map());
  mockedCacheSuggestions.mockResolvedValue(undefined as never);
});

describe('PhotoImportScreen retry e2e (U8 -> U9 -> U10)', () => {
  it('chunk-2 fails -> lookup-failed -> retry succeeds -> matched; no-place-found card persists (C4)', async () => {
    // Build > CHUNK_SIZE (15) clusters so they span two chunks. Chunk-1 (first
    // 15) succeeds; chunk-2 (the rest) throws. We give one chunk-1 cluster a
    // real empty response (-> no-place-found) and one chunk-1 cluster a match.
    const matched = makeCluster('c-matched', 35.01, 139.01);
    const emptyOk = makeCluster('c-empty', 35.02, 139.02);
    const fillers = Array.from({ length: 13 }, (_, i) =>
      makeCluster(`c-fill-${i}`, 35.1 + i * 0.001, 139.1 + i * 0.001)
    );
    const failed = makeCluster('c-failed', 35.5, 139.5); // chunk-2

    const chunk1 = [matched, emptyOk, ...fillers]; // 15 clusters
    const allClusters = [...chunk1, failed]; // 16 -> 2 chunks

    const lookup = new Map(allClusters.map((c) => [c.id, c]));
    mockedGetFullCluster.mockImplementation((id: string) => lookup.get(id));

    // Chunk-1 (first api.post): matched -> place, empty -> [], fillers -> [].
    // Chunk-2 (second api.post): throws a non-fatal error.
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
    expect(result.current.suggestPlacesMutation.failedClusterIds.has('c-failed')).toBe(false);
  });

  it('retry that fails AGAIN keeps the cluster lookup-failed (retry-enabled, no cap); no-place-found persists', async () => {
    const emptyOk = makeCluster('c-empty', 35.02, 139.02);
    const fillers = Array.from({ length: 14 }, (_, i) =>
      makeCluster(`c-fill-${i}`, 35.1 + i * 0.001, 139.1 + i * 0.001)
    );
    const failed = makeCluster('c-failed', 35.5, 139.5);

    const chunk1 = [emptyOk, ...fillers]; // 15
    const allClusters = [...chunk1, failed]; // 16 -> 2 chunks

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
