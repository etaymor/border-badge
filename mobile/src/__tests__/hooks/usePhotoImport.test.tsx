import { renderHook, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import { useSuggestPlaces } from '../../hooks/usePhotoImport';
import { api } from '../../services/api';

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

      expect(mockedApi.post).toHaveBeenCalledWith('/photos/suggest-places', requestData);
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
});
