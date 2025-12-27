/**
 * Tests for useFeed hooks.
 *
 * Covers:
 * - useFeed: fetching activity feed with infinite scroll
 * - getFeedItems: flattening paginated feed data
 */

import React from 'react';
import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { useFeed, getFeedItems, FeedItem } from '@hooks/useFeed';
import { api } from '@services/api';
import { createTestQueryClient } from '../utils/testUtils';

// Mock API
jest.mock('@services/api', () => ({
  api: {
    get: jest.fn(),
  },
}));

// Test data
const mockFeedItem: FeedItem = {
  activity_type: 'country_visited',
  created_at: '2024-01-15T10:00:00Z',
  user: {
    user_id: 'user-1',
    username: 'traveler1',
    avatar_url: null,
  },
  country: {
    country_id: 'country-1',
    country_name: 'Japan',
    country_code: 'JP',
  },
  entry: null,
};

const mockEntryFeedItem: FeedItem = {
  activity_type: 'entry_added',
  created_at: '2024-01-15T09:00:00Z',
  user: {
    user_id: 'user-2',
    username: 'traveler2',
    avatar_url: 'https://example.com/avatar.jpg',
  },
  country: null,
  entry: {
    entry_id: 'entry-1',
    entry_name: 'Tokyo Ramen Shop',
    entry_type: 'food',
    location_name: 'Shinjuku, Tokyo',
    image_url: 'https://example.com/ramen.jpg',
  },
};

// Create wrapper for hooks
function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useFeed', () => {
  let queryClient: QueryClient;
  const mockedApi = api as jest.Mocked<typeof api>;

  beforeEach(() => {
    queryClient = createTestQueryClient();
    jest.clearAllMocks();
  });

  // ============ useFeed Tests ============

  describe('useFeed', () => {
    it('fetches feed successfully', async () => {
      mockedApi.get.mockResolvedValue({
        data: {
          items: [mockFeedItem, mockEntryFeedItem],
          next_cursor: null,
          has_more: false,
        },
      });

      const { result } = renderHook(() => useFeed(), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data?.pages[0].items).toHaveLength(2);
      expect(mockedApi.get).toHaveBeenCalledWith('/feed', {
        params: { limit: 20 },
      });
    });

    it('supports custom limit option', async () => {
      mockedApi.get.mockResolvedValue({
        data: {
          items: [],
          next_cursor: null,
          has_more: false,
        },
      });

      const { result } = renderHook(() => useFeed({ limit: 10 }), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockedApi.get).toHaveBeenCalledWith('/feed', {
        params: { limit: 10 },
      });
    });

    it('returns empty items when feed is empty', async () => {
      mockedApi.get.mockResolvedValue({
        data: {
          items: [],
          next_cursor: null,
          has_more: false,
        },
      });

      const { result } = renderHook(() => useFeed(), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data?.pages[0].items).toEqual([]);
      expect(result.current.data?.pages[0].has_more).toBe(false);
    });

    it('indicates when more pages are available', async () => {
      mockedApi.get.mockResolvedValue({
        data: {
          items: [mockFeedItem],
          next_cursor: '2024-01-14T10:00:00Z',
          has_more: true,
        },
      });

      const { result } = renderHook(() => useFeed(), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data?.pages[0].has_more).toBe(true);
      expect(result.current.data?.pages[0].next_cursor).toBe('2024-01-14T10:00:00Z');
      expect(result.current.hasNextPage).toBe(true);
    });

    it('handles error state', async () => {
      mockedApi.get.mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useFeed(), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.error).toBeDefined();
    });
  });

  // ============ getFeedItems Tests ============

  describe('getFeedItems', () => {
    it('returns empty array for undefined data', () => {
      expect(getFeedItems(undefined)).toEqual([]);
    });

    it('returns empty array for data with no pages', () => {
      expect(getFeedItems({ pages: [], pageParams: [] })).toEqual([]);
    });

    it('flattens single page of items', () => {
      const data = {
        pages: [
          {
            items: [mockFeedItem, mockEntryFeedItem],
            next_cursor: null,
            has_more: false,
          },
        ],
        pageParams: [null],
      };

      const items = getFeedItems(data);
      expect(items).toHaveLength(2);
      expect(items[0]).toEqual(mockFeedItem);
      expect(items[1]).toEqual(mockEntryFeedItem);
    });

    it('flattens multiple pages of items', () => {
      const data = {
        pages: [
          {
            items: [mockFeedItem],
            next_cursor: '2024-01-14T10:00:00Z',
            has_more: true,
          },
          {
            items: [mockEntryFeedItem],
            next_cursor: null,
            has_more: false,
          },
        ],
        pageParams: [null, '2024-01-14T10:00:00Z'],
      };

      const items = getFeedItems(data);
      expect(items).toHaveLength(2);
      expect(items[0]).toEqual(mockFeedItem);
      expect(items[1]).toEqual(mockEntryFeedItem);
    });

    it('handles pages with empty items', () => {
      const data = {
        pages: [
          { items: [mockFeedItem], next_cursor: '2024-01-14T10:00:00Z', has_more: true },
          { items: [], next_cursor: null, has_more: false },
        ],
        pageParams: [null, '2024-01-14T10:00:00Z'],
      };

      const items = getFeedItems(data);
      expect(items).toHaveLength(1);
      expect(items[0]).toEqual(mockFeedItem);
    });
  });
});
