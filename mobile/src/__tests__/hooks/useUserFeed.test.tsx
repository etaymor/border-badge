import React from 'react';
import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { useUserFeed, getUserFeedItems } from '@hooks/useUserFeed';
import type { FeedItem } from '@hooks/useSocialHome';
import { api } from '@services/api';
import { createTestQueryClient } from '../utils/testUtils';

jest.mock('@services/api', () => ({
  api: {
    get: jest.fn(),
  },
}));

function makeItem(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    activity_id: 'activity-1',
    activity_type: 'country_visited',
    created_at: '2024-01-15T10:00:00Z',
    user: { user_id: 'user-1', username: 'traveler1', avatar_url: null },
    country: { country_id: 'country-1', country_name: 'Japan', country_code: 'JP' },
    entry: null,
    ...overrides,
  };
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useUserFeed', () => {
  let queryClient: QueryClient;
  const mockedApi = api as jest.Mocked<typeof api>;

  beforeEach(() => {
    queryClient = createTestQueryClient();
    jest.clearAllMocks();
  });

  it('fetches the first page without a cursor', async () => {
    mockedApi.get.mockResolvedValue({
      data: { items: [makeItem()], next_cursor: null, has_more: false },
    });

    const { result } = renderHook(() => useUserFeed('user-1'), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // First page request carries the default limit and no `before` cursor.
    expect(mockedApi.get).toHaveBeenCalledTimes(1);
    expect(mockedApi.get).toHaveBeenCalledWith('/feed/user/user-1', {
      params: { limit: 20 },
    });
    expect(result.current.data?.pages[0].items).toHaveLength(1);
    expect(result.current.hasNextPage).toBe(false);
  });

  it('paginates with the cursor from the previous page', async () => {
    mockedApi.get
      .mockResolvedValueOnce({
        data: { items: [makeItem()], next_cursor: 'cursor-1', has_more: true },
      })
      .mockResolvedValueOnce({
        data: {
          items: [makeItem({ activity_id: 'activity-2' })],
          next_cursor: null,
          has_more: false,
        },
      });

    const { result } = renderHook(() => useUserFeed('user-1', { limit: 5 }), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(true);

    await result.current.fetchNextPage();

    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));
    expect(mockedApi.get).toHaveBeenNthCalledWith(1, '/feed/user/user-1', {
      params: { limit: 5 },
    });
    expect(mockedApi.get).toHaveBeenNthCalledWith(2, '/feed/user/user-1', {
      params: { limit: 5, before: 'cursor-1' },
    });
    expect(result.current.hasNextPage).toBe(false);
  });

  it('does not report a next page when has_more is true but next_cursor is missing', async () => {
    mockedApi.get.mockResolvedValue({
      data: { items: [makeItem()], next_cursor: null, has_more: true },
    });

    const { result } = renderHook(() => useUserFeed('user-1'), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(false);
  });

  it('is disabled when userId is empty: no request is made', async () => {
    const { result } = renderHook(() => useUserFeed(''), {
      wrapper: createWrapper(queryClient),
    });

    // The query never leaves the idle fetch state and the API is untouched.
    await waitFor(() => expect(result.current.fetchStatus).toBe('idle'));
    expect(result.current.isPending).toBe(true);
    expect(mockedApi.get).not.toHaveBeenCalled();
  });

  it('surfaces fetch errors', async () => {
    const failure = new Error('feed unavailable');
    mockedApi.get.mockRejectedValue(failure);

    const { result } = renderHook(() => useUserFeed('user-1'), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBe(failure);
    expect(result.current.data).toBeUndefined();
  });

  describe('getUserFeedItems', () => {
    it('flattens items across pages', () => {
      const data = {
        pages: [
          { items: [makeItem()], next_cursor: 'cursor-1', has_more: true },
          {
            items: [makeItem({ activity_id: 'activity-2' })],
            next_cursor: null,
            has_more: false,
          },
        ],
        pageParams: [null, 'cursor-1'],
      };

      const items = getUserFeedItems(data);
      expect(items.map((item) => item.activity_id)).toEqual(['activity-1', 'activity-2']);
    });

    it('returns an empty array for undefined data', () => {
      expect(getUserFeedItems(undefined)).toEqual([]);
    });
  });
});
