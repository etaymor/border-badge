import { renderHook, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import {
  useSuggestPlaces,
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
});
