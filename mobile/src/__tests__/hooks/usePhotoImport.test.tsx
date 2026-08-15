import { renderHook, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import {
  useSuggestPlaces,
  useSuggestPlacesChunked,
  CHUNK_SIZE,
  FIRST_CHUNK_SIZE,
  planSuggestionBatches,
  type PlaceSuggestionCluster,
  RateLimitError,
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

    // The backend derives Retry-After from the limiter window it configures, so
    // the header is the authoritative wait. The 60s default is only a fallback
    // for a 429 that arrives without one (e.g. from an intermediary).
    describe('429 Retry-After', () => {
      const CLUSTERS = {
        clusters: [
          {
            id: 'cluster-1',
            centroid: { latitude: 35.6762, longitude: 139.6503 },
            photos: [{ asset_id: 'photo-1', latitude: 35.6762, longitude: 139.6503 }],
          },
        ],
      };

      const rateLimit = async (headers: Record<string, string>): Promise<RateLimitError> => {
        const err = new AxiosError('too many requests');
        // @ts-expect-error - minimal AxiosError response shape for the test
        err.response = { status: 429, headers };
        mockedApi.post.mockRejectedValueOnce(err);

        const { result } = renderHook(() => useSuggestPlaces(), {
          wrapper: createWrapper(queryClient),
        });

        let caught: unknown;
        await act(async () => {
          try {
            await result.current.mutateAsync(CLUSTERS);
          } catch (e) {
            caught = e;
          }
        });
        expect(caught).toBeInstanceOf(RateLimitError);
        return caught as RateLimitError;
      };

      it('uses the header value rather than the built-in default', async () => {
        const caught = await rateLimit({ 'retry-after': '60' });

        expect(caught.retryAfterSeconds).toBe(60);
      });

      it('honors a header that differs from the default', async () => {
        const caught = await rateLimit({ 'retry-after': '3600' });

        expect(caught.retryAfterSeconds).toBe(3600);
      });

      it('falls back to 60 seconds only when the header is absent', async () => {
        const caught = await rateLimit({});

        expect(caught.retryAfterSeconds).toBe(60);
      });
    });
  });

  describe('useSuggestPlacesChunked - failedClusterIds (KTD6/KTD8/KTD10)', () => {
    // Chunk boundaries are derived from the real batch plan rather than
    // hardcoded, so tuning CHUNK_SIZE (as the timeout fix did) or the U5 first-
    // batch ramp can't silently invalidate these tests.
    const buildClusters = (count: number) =>
      Array.from({ length: count }, (_, i) => ({
        id: `cluster-${i}`,
        centroid: { latitude: 35 + i * 0.001, longitude: 139 + i * 0.001 },
        photos: [{ asset_id: `photo-${i}`, latitude: 35, longitude: 139 }],
      }));

    /** Enough clusters to produce EXACTLY `batches` dispatch batches. */
    const buildClustersForBatches = (batches: number) =>
      buildClusters(FIRST_CHUNK_SIZE + (batches - 1) * CHUNK_SIZE);

    /** Cluster ids belonging to the nth (0-indexed) dispatch batch. */
    const chunkIds = (clusters: { id: string }[], n: number) =>
      planSuggestionBatches(clusters)[n].map((c) => c.id);

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
      const clusters = buildClustersForBatches(2); // exactly two batches
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
      const clusters = buildClustersForBatches(2);
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
      const clusters = buildClustersForBatches(2);
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
      const clusters = buildClustersForBatches(3); // exactly three batches
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
      const clusters = buildClustersForBatches(2);
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
      const clusters = buildClustersForBatches(2);
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
      const clusters = buildClustersForBatches(2);
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

  // ── U5: first-batch ramp + pipelined preparation ────────────────────────
  describe('useSuggestPlacesChunked - batch ramp and pipelined preparation (U5)', () => {
    const buildClusters = (count: number) =>
      Array.from({ length: count }, (_, i) => ({
        id: `cluster-${i}`,
        centroid: { latitude: 35 + i * 0.001, longitude: 139 + i * 0.001 },
        photos: [{ asset_id: `photo-${i}`, latitude: 35, longitude: 139 }],
      }));

    const buildClustersForBatches = (batches: number) =>
      buildClusters(FIRST_CHUNK_SIZE + (batches - 1) * CHUNK_SIZE);

    function deferred<T>() {
      let resolve!: (value: T) => void;
      const promise = new Promise<T>((r) => {
        resolve = r;
      });
      return { promise, resolve };
    }

    const emptyResponse = { data: { suggestions: [], failed_cluster_count: 0 } };

    it('R24: dispatches a SMALLER first batch, then full-size batches', () => {
      const batches = planSuggestionBatches(buildClusters(FIRST_CHUNK_SIZE + CHUNK_SIZE * 2));

      expect(batches).toHaveLength(3);
      expect(batches[0]).toHaveLength(FIRST_CHUNK_SIZE);
      expect(batches[0].length).toBeLessThan(batches[1].length);
      expect(batches[1]).toHaveLength(CHUNK_SIZE);
      expect(batches[2]).toHaveLength(CHUNK_SIZE);
      // Every cluster is dispatched exactly once, in order.
      expect(batches.flat().map((c) => c.id)).toEqual(
        buildClusters(FIRST_CHUNK_SIZE + CHUNK_SIZE * 2).map((c) => c.id)
      );
    });

    it('R24: does not split an import that already fits in the first batch', () => {
      expect(planSuggestionBatches(buildClusters(FIRST_CHUNK_SIZE))).toHaveLength(1);
      expect(planSuggestionBatches([])).toEqual([]);
    });

    it('R5: issues the first request BEFORE later batches finish preparing', async () => {
      const clusters = buildClustersForBatches(2);
      const gate = deferred<void>();
      let secondPreparationDone = false;
      let preparationsStartedAtFirstPost = -1;

      const prepareBatch = jest.fn(async (batch: PlaceSuggestionCluster[]) => {
        if (prepareBatch.mock.calls.length === 2) {
          await gate.promise;
          secondPreparationDone = true;
        }
        return batch;
      });

      mockedApi.post.mockImplementation(async () => {
        if (mockedApi.post.mock.calls.length === 1) {
          preparationsStartedAtFirstPost = prepareBatch.mock.calls.length;
          // The first request is in flight while batch two is still encoding.
          expect(secondPreparationDone).toBe(false);
          gate.resolve();
        }
        return emptyResponse;
      });

      const { result } = renderHook(() => useSuggestPlacesChunked(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.mutateAsync({ clusters, prepareBatch });
      });

      // Batch two's preparation had already STARTED when batch one dispatched:
      // preparation overlaps the round trip instead of preceding every request.
      expect(preparationsStartedAtFirstPost).toBe(2);
      expect(secondPreparationDone).toBe(true);
      expect(mockedApi.post).toHaveBeenCalledTimes(2);
    });

    it('retains only in-flight payloads: prepares at most one batch ahead and keeps none after dispatch', async () => {
      const clusters = buildClustersForBatches(3);
      const preparedAtEachPost: number[] = [];

      const prepareBatch = jest.fn(async (batch: PlaceSuggestionCluster[]) =>
        batch.map((c) => ({ ...c, vision_images_base64: [`payload-${c.id}`] }))
      );

      mockedApi.post.mockImplementation(async () => {
        preparedAtEachPost.push(prepareBatch.mock.calls.length);
        return emptyResponse;
      });

      const { result } = renderHook(() => useSuggestPlacesChunked(), {
        wrapper: createWrapper(queryClient),
      });

      let resolved: unknown;
      await act(async () => {
        resolved = await result.current.mutateAsync({ clusters, prepareBatch });
      });

      expect(mockedApi.post).toHaveBeenCalledTimes(3);
      // At each dispatch at most ONE further batch has been prepared, so the
      // pipeline never runs ahead of what is in flight.
      preparedAtEachPost.forEach((preparedCount, dispatchIndex) => {
        expect(preparedCount - dispatchIndex).toBeLessThanOrEqual(2);
      });
      expect(prepareBatch).toHaveBeenCalledTimes(3);

      // Nothing the mutation exposes after the run still carries an encoded
      // payload — dispatched batches are released, not accumulated.
      expect(JSON.stringify(resolved)).not.toContain('payload-');
      expect(JSON.stringify(result.current.partialResults)).not.toContain('payload-');
      expect(JSON.stringify(result.current.progress)).not.toContain('payload-');
    });

    it('sends each batch ONLY its own prepared payload', async () => {
      const clusters = buildClustersForBatches(2);
      const prepareBatch = jest.fn(async (batch: PlaceSuggestionCluster[]) =>
        batch.map((c) => ({ ...c, vision_images_base64: [`image-${c.id}`] }))
      );
      mockedApi.post.mockResolvedValue(emptyResponse);

      const { result } = renderHook(() => useSuggestPlacesChunked(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.mutateAsync({ clusters, prepareBatch });
      });

      const batches = planSuggestionBatches(clusters);
      mockedApi.post.mock.calls.forEach((call, i) => {
        const body = call[1] as { clusters: { id: string; vision_images_base64: string[] }[] };
        expect(body.clusters.map((c) => c.id)).toEqual(batches[i].map((c) => c.id));
        expect(body.clusters.map((c) => c.vision_images_base64[0])).toEqual(
          batches[i].map((c) => `image-${c.id}`)
        );
      });
    });

    it('dispatches the batch anyway when its preparation fails', async () => {
      const clusters = buildClustersForBatches(2);
      const prepareBatch = jest.fn(async (batch: PlaceSuggestionCluster[]) => {
        if (prepareBatch.mock.calls.length === 1) {
          throw new Error('image decode failed');
        }
        return batch;
      });
      mockedApi.post.mockResolvedValue(emptyResponse);

      const { result } = renderHook(() => useSuggestPlacesChunked(), {
        wrapper: createWrapper(queryClient),
      });

      let caught: Error | null = null;
      await act(async () => {
        try {
          await result.current.mutateAsync({ clusters, prepareBatch });
        } catch (e) {
          caught = e as Error;
        }
      });

      // The pipeline does not reject, and the un-prepared batch still goes out
      // (without vision images) rather than being dropped.
      expect(caught).toBeNull();
      expect(mockedApi.post).toHaveBeenCalledTimes(2);
      const firstBody = mockedApi.post.mock.calls[0][1] as { clusters: { id: string }[] };
      expect(firstBody.clusters.map((c) => c.id)).toEqual(
        planSuggestionBatches(clusters)[0].map((c) => c.id)
      );
      expect(result.current.failedClusterIds.size).toBe(0);
    });
  });
});
