import React from 'react';
import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import {
  useSocialHome,
  getSocialFeedItems,
  getSocialHomeStats,
  getSocialHomeRanking,
  getSocialPendingTagCount,
  type FeedItem,
  type SocialHomePage,
} from '@hooks/useSocialHome';
import { api } from '@services/api';
import { createTestQueryClient } from '../utils/testUtils';

jest.mock('@services/api', () => ({
  api: {
    get: jest.fn(),
  },
}));

const mockFeedItem: FeedItem = {
  activity_id: 'activity-1',
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

const mockFollowStats = {
  follower_count: 5,
  following_count: 3,
};

const mockRanking = {
  rank: 2,
  total_friends: 5,
  my_countries: 12,
  leader_username: 'leader',
  leader_countries: 40,
};

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useSocialHome', () => {
  let queryClient: QueryClient;
  const mockedApi = api as jest.Mocked<typeof api>;

  beforeEach(() => {
    queryClient = createTestQueryClient();
    jest.clearAllMocks();
  });

  it('fetches social home data', async () => {
    mockedApi.get.mockResolvedValue({
      data: {
        feed: {
          items: [mockFeedItem],
          next_cursor: null,
          has_more: false,
        },
        follow_stats: mockFollowStats,
        friends_ranking: mockRanking,
        pending_tag_count: 2,
      },
    });

    const { result } = renderHook(() => useSocialHome(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.pages[0].feed.items).toHaveLength(1);
    expect(result.current.data?.pages[0].follow_stats).toEqual(mockFollowStats);
    expect(mockedApi.get).toHaveBeenCalledWith('/social/home', { params: { limit: 20 } });
  });

  it('supports pagination via next cursor', async () => {
    mockedApi.get.mockResolvedValue({
      data: {
        feed: {
          items: [mockFeedItem],
          next_cursor: 'cursor-123',
          has_more: true,
        },
        follow_stats: mockFollowStats,
        friends_ranking: mockRanking,
        pending_tag_count: 1,
      },
    });

    const { result } = renderHook(() => useSocialHome({ limit: 10 }), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(true);
    expect(mockedApi.get).toHaveBeenCalledWith('/social/home', { params: { limit: 10 } });
  });

  describe('selectors', () => {
    type SocialHomeInfiniteData = {
      pages: SocialHomePage[];
      pageParams: Array<string | null>;
    };

    const baseData: SocialHomeInfiniteData = {
      pages: [
        {
          feed: {
            items: [mockFeedItem],
            next_cursor: 'cursor-1',
            has_more: true,
          },
          follow_stats: mockFollowStats,
          friends_ranking: mockRanking,
          pending_tag_count: 3,
        },
        {
          feed: {
            items: [
              {
                ...mockFeedItem,
                created_at: '2024-01-14T10:00:00Z',
              },
            ],
            next_cursor: null,
            has_more: false,
          },
          follow_stats: mockFollowStats,
          friends_ranking: mockRanking,
          pending_tag_count: 3,
        },
      ],
      pageParams: [null, 'cursor-1'],
    };

    it('flattens feed items across pages', () => {
      const items = getSocialFeedItems(baseData);
      expect(items).toHaveLength(2);
    });

    it('returns stats and ranking from first page', () => {
      expect(getSocialHomeStats(baseData)).toEqual(mockFollowStats);
      expect(getSocialHomeRanking(baseData)).toEqual(mockRanking);
    });

    it('returns pending tag count from first page', () => {
      expect(getSocialPendingTagCount(baseData)).toBe(3);
    });

    it('handles undefined data gracefully', () => {
      expect(getSocialFeedItems(undefined)).toEqual([]);
      expect(getSocialHomeStats(undefined)).toBeNull();
      expect(getSocialHomeRanking(undefined)).toBeNull();
      expect(getSocialPendingTagCount(undefined)).toBe(0);
    });
  });
});
