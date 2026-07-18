import { renderHook, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import {
  useSuggestPlaces,
  useSuggestPlacesChunked,
  CHUNK_SIZE,
  SUGGEST_PLACES_TIMEOUT_MS,
} from '../../hooks/usePhotoImport';
import { api } from '../../services/api';
import { AxiosError } from 'axios';

// Mock the API module
jest.mock('../../services/api', () => ({
  api: {
    post: jest.fn(),
  },
}));

const mockedApi = api as jest.Mocked<typeof api>;

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('usePhotoImport', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
    jest.clearAllMocks();
  });

  afterEach(async () => {
    // Cancel any pending queries and clear the cache
    queryClient.cancelQueries();
    queryClient.clear();
    // Let React Query finish any pending updates
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });

  describe('useSuggestPlaces', () => {
    it('sends place suggestion request with correct payload', async () => {
      const mockResponse = {
        data: {
          suggestions: [
            {
              cluster_id: 'cluster-1',
              photo_ids: ['photo-1', 'photo-2'],
              places: [
                {
                  place_id: 'ChIJ123',
                  name: 'Tokyo Tower',
                  address: '4-2-8 Shibakoen, Minato City, Tokyo',
                  location: { latitude: 35.6586, longitude: 139.7454 },
                  category: 'place',
                  distance_m: 50,
                  types: ['tourist_attraction'],
                },
              ],
            },
          ],
        },
      };

      mockedApi.post.mockResolvedValueOnce(mockResponse);

      const { result } = renderHook(() => useSuggestPlaces(), {
        wrapper: createWrapper(queryClient),
      });

      const requestData = {
        clusters: [
          {
            id: 'cluster-1',
            centroid: { latitude: 35.6586, longitude: 139.7454 },
            photos: [
              { asset_id: 'photo-1', latitude: 35.6586, longitude: 139.7454 },
              { asset_id: 'photo-2', latitude: 35.6587, longitude: 139.7455 },
            ],
          },
        ],
      };

      await act(async () => {
        await result.current.mutateAsync(requestData);
      });

      expect(mockedApi.post).toHaveBeenCalledWith(
        '/photos/suggest-places',
        requestData,
        expect.objectContaining({ timeout: SUGGEST_PLACES_TIMEOUT_MS })
      );
    });

    it('returns place suggestions on success', async () => {
      const mockSuggestions = [
        {
          cluster_id: 'cluster-1',
          photo_ids: ['photo-1'],
          places: [
            {
              place_id: 'ChIJ123',
              name: 'Senso-ji Temple',
              address: '2-3-1 Asakusa, Taito City, Tokyo',
              location: { latitude: 35.7148, longitude: 139.7967 },
              category: 'place',
              distance_m: 25,
              types: ['tourist_attraction', 'place_of_worship'],
            },
          ],
        },
      ];

      mockedApi.post.mockResolvedValueOnce({ data: { suggestions: mockSuggestions } });

      const { result } = renderHook(() => useSuggestPlaces(), {
        wrapper: createWrapper(queryClient),
      });

      let response;
      await act(async () => {
        response = await result.current.mutateAsync({
          clusters: [
            {
              id: 'cluster-1',
              centroid: { latitude: 35.7148, longitude: 139.7967 },
              photos: [{ asset_id: 'photo-1', latitude: 35.7148, longitude: 139.7967 }],
            },
          ],
        });
      });

      expect(response).toEqual({ suggestions: mockSuggestions });
    });

    it('handles API errors', async () => {
      const error = new Error('Rate limit exceeded');
      mockedApi.post.mockRejectedValueOnce(error);

      const { result } = renderHook(() => useSuggestPlaces(), {
        wrapper: createWrapper(queryClient),
      });

      let caughtError: Error | null = null;
      await act(async () => {
        try {
          await result.current.mutateAsync({
            clusters: [
              {
                id: 'cluster-1',
                centroid: { latitude: 35.6762, longitude: 139.6503 },
                photos: [{ asset_id: 'photo-1', latitude: 35.6762, longitude: 139.6503 }],
              },
            ],
          });
        } catch (e) {
          caughtError = e as Error;
        }
      });

      expect(caughtError).not.toBeNull();
      expect(caughtError!.message).toBe('Rate limit exceeded');
    });
  });

  describe('useSuggestPlacesChunked - failedClusterIds (KTD6/KTD8/KTD10)', () => {
    // Chunk boundaries are derived from the real CHUNK_SIZE rather than hardcoded,
    // so tuning it (as the timeout fix did) can't silently invalidate these tests.
    const buildClusters = (count: number) =>
      Array.from({ length: count }, (_, i) => ({
        id: `cluster-${i}`,
        centroid: { latitude: 35 + i * 0.001, longitude: 139 + i * 0.001 },
        photos: [{ asset_id: `photo-${i}`, latitude: 35, longitude: 139 }],
      }));

    /** Cluster ids belonging to the nth (0-indexed) chunk. */
    const chunkIds = (clusters: { id: string }[], n: number) =>
      clusters.slice(n * CHUNK_SIZE, (n + 1) * CHUNK_SIZE).map((c) => c.id);

    const suggestionsFor = (ids: string[]) =>
      ids.map((id) => ({ cluster_id: id, photo_ids: [`photo-${id}`], places: [] }));

    const makeAxiosError = (status: number, headers: Record<string, string> = {}) => {
      const err = new AxiosError('request failed');
      // @ts-expect-error - minimal AxiosError response shape for the test
      err.response = { status, headers };
      return err;
    };

    // The backend sends Retry-After ONLY on a genuine quota 503; a config/network
    // 503 carries no header and must stay retryable. Mirror that here.
    const makeQuotaError = () => makeAxiosError(503, { 'retry-after': '3600' });

    it('records exactly chunk-2 cluster IDs in failedClusterIds when chunk-2 throws (non-fatal)', async () => {
      const clusters = buildClusters(CHUNK_SIZE * 2); // exactly two chunks
      const chunk1Ids = chunkIds(clusters, 0);
      const chunk2Ids = chunkIds(clusters, 1);

      mockedApi.post
        .mockResolvedValueOnce({
          data: { suggestions: suggestionsFor(chunk1Ids), failed_cluster_count: 0 },
        })
        // chunk-2 throws a non-fatal (generic) error
        .mockRejectedValueOnce(new Error('network blip'));

      const { result } = renderHook(() => useSuggestPlacesChunked(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.mutateAsync({ clusters });
      });

      const failed = result.current.failedClusterIds;
      expect(failed).toBeInstanceOf(Map);
      expect([...failed.keys()].sort()).toEqual([...chunk2Ids].sort());
      // chunk-1 ids must NOT be marked failed
      for (const id of chunk1Ids) {
        expect(failed.has(id)).toBe(false);
      }
      // non-fatal failures are retry-enabled
      for (const id of chunk2Ids) {
        expect(failed.get(id)).toEqual({ retryDisabled: false });
      }
    });

    it('records remaining clusters with retryDisabled=true when a chunk throws 503 (quota)', async () => {
      const clusters = buildClusters(CHUNK_SIZE * 2);
      const chunk1Ids = chunkIds(clusters, 0);
      const chunk2Ids = chunkIds(clusters, 1);

      mockedApi.post
        .mockResolvedValueOnce({
          data: { suggestions: suggestionsFor(chunk1Ids), failed_cluster_count: 0 },
        })
        .mockRejectedValueOnce(makeQuotaError());

      const { result } = renderHook(() => useSuggestPlacesChunked(), {
        wrapper: createWrapper(queryClient),
      });

      let caught: Error | null = null;
      await act(async () => {
        try {
          await result.current.mutateAsync({ clusters });
        } catch (e) {
          caught = e as Error;
        }
      });

      // Fatal error still surfaces...
      expect(caught).not.toBeNull();
      expect(caught!.name).toBe('QuotaExhaustedError');
      // ...but the un-responded clusters are NOT silently dropped.
      const failed = result.current.failedClusterIds;
      expect([...failed.keys()].sort()).toEqual([...chunk2Ids].sort());
      for (const id of chunk2Ids) {
        expect(failed.get(id)).toEqual({ retryDisabled: true });
      }
    });

    it('records remaining clusters with retryDisabled=true when a chunk throws 429 (rate limit)', async () => {
      const clusters = buildClusters(CHUNK_SIZE * 2);
      const chunk1Ids = chunkIds(clusters, 0);
      const chunk2Ids = chunkIds(clusters, 1);

      mockedApi.post
        .mockResolvedValueOnce({
          data: { suggestions: suggestionsFor(chunk1Ids), failed_cluster_count: 0 },
        })
        .mockRejectedValueOnce(makeAxiosError(429, { 'retry-after': '30' }));

      const { result } = renderHook(() => useSuggestPlacesChunked(), {
        wrapper: createWrapper(queryClient),
      });

      let caught: Error | null = null;
      await act(async () => {
        try {
          await result.current.mutateAsync({ clusters });
        } catch (e) {
          caught = e as Error;
        }
      });

      expect(caught).not.toBeNull();
      expect(caught!.name).toBe('RateLimitError');
      const failed = result.current.failedClusterIds;
      expect([...failed.keys()].sort()).toEqual([...chunk2Ids].sort());
      for (const id of chunk2Ids) {
        expect(failed.get(id)).toEqual({ retryDisabled: true });
      }
    });

    it('records ALL remaining clusters (current + later chunks) on a fatal error in an early chunk', async () => {
      const clusters = buildClusters(CHUNK_SIZE * 3); // exactly three chunks
      const chunk2Ids = chunkIds(clusters, 1);
      const chunk3Ids = chunkIds(clusters, 2);

      mockedApi.post
        .mockResolvedValueOnce({
          data: {
            suggestions: suggestionsFor(chunkIds(clusters, 0)),
            failed_cluster_count: 0,
          },
        })
        // chunk-2 throws fatal — chunk-3 never runs
        .mockRejectedValueOnce(makeQuotaError());

      const { result } = renderHook(() => useSuggestPlacesChunked(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        try {
          await result.current.mutateAsync({ clusters });
        } catch {
          // expected
        }
      });

      const failed = result.current.failedClusterIds;
      const expected = [...chunk2Ids, ...chunk3Ids].sort();
      expect([...failed.keys()].sort()).toEqual(expected);
    });

    it('leaves failedClusterIds empty when all chunks succeed', async () => {
      const clusters = buildClusters(CHUNK_SIZE * 2);
      mockedApi.post
        .mockResolvedValueOnce({
          data: {
            suggestions: suggestionsFor(chunkIds(clusters, 0)),
            failed_cluster_count: 0,
          },
        })
        .mockResolvedValueOnce({
          data: {
            suggestions: suggestionsFor(chunkIds(clusters, 1)),
            failed_cluster_count: 0,
          },
        });

      const { result } = renderHook(() => useSuggestPlacesChunked(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.mutateAsync({ clusters });
      });

      expect(result.current.failedClusterIds.size).toBe(0);
    });

    it('clears failedClusterIds on reset', async () => {
      const clusters = buildClusters(CHUNK_SIZE * 2);
      mockedApi.post
        .mockResolvedValueOnce({
          data: {
            suggestions: suggestionsFor(chunkIds(clusters, 0)),
            failed_cluster_count: 0,
          },
        })
        .mockRejectedValueOnce(new Error('network blip'));

      const { result } = renderHook(() => useSuggestPlacesChunked(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.mutateAsync({ clusters });
      });
      expect(result.current.failedClusterIds.size).toBeGreaterThan(0);

      act(() => {
        result.current.reset();
      });
      expect(result.current.failedClusterIds.size).toBe(0);
    });

    it('keeps a 503 WITHOUT Retry-After retryable instead of reporting quota exhausted', async () => {
      // The backend returns 503 for a misconfigured service and for an unreachable
      // upstream, neither of which is a quota problem. Treating every 503 as fatal
      // showed "Daily limit reached" and hid the Retry button, so a transient
      // outage looked permanent. Only the quota 503 carries Retry-After.
      const clusters = buildClusters(CHUNK_SIZE * 2);
      const chunk1Ids = chunkIds(clusters, 0);
      const chunk2Ids = chunkIds(clusters, 1);

      mockedApi.post
        .mockResolvedValueOnce({
          data: { suggestions: suggestionsFor(chunk1Ids), failed_cluster_count: 0 },
        })
        .mockRejectedValueOnce(makeAxiosError(503)); // no Retry-After

      const { result } = renderHook(() => useSuggestPlacesChunked(), {
        wrapper: createWrapper(queryClient),
      });

      let caught: Error | null = null;
      await act(async () => {
        try {
          await result.current.mutateAsync({ clusters });
        } catch (e) {
          caught = e as Error;
        }
      });

      // Non-fatal: the loop keeps going and the mutation resolves.
      expect(caught).toBeNull();
      const failed = result.current.failedClusterIds;
      expect([...failed.keys()].sort()).toEqual([...chunk2Ids].sort());
      // ...and crucially the user can still retry them.
      for (const id of chunk2Ids) {
        expect(failed.get(id)).toEqual({ retryDisabled: false });
      }
    });
  });
});
