import { useInfiniteQuery } from '@tanstack/react-query';

import { api } from '@services/api';

// Feed item interface
export interface FeedItem {
  id: string;
  user_id: string;
  username: string;
  avatar_url: string | null;
  activity_type: 'trip_created' | 'country_visited' | 'entry_added';
  trip_id: string | null;
  trip_name: string | null;
  country_id: string | null;
  country_name: string | null;
  country_code: string | null;
  entry_id: string | null;
  entry_type: string | null;
  media_count: number;
  created_at: string;
}

// Paginated feed response
export interface PaginatedFeed {
  items: FeedItem[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

const FEED_KEY = ['feed'];

// Get activity feed with infinite scroll
export function useFeed(limit = 20) {
  return useInfiniteQuery({
    queryKey: FEED_KEY,
    queryFn: async ({ pageParam = 0 }): Promise<PaginatedFeed> => {
      const response = await api.get('/feed', {
        params: { limit, offset: pageParam },
      });
      return response.data;
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      if (lastPage.has_more) {
        return lastPage.offset + lastPage.items.length;
      }
      return undefined;
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}
