import { useInfiniteQuery } from '@tanstack/react-query';

import { api } from '@services/api';

// Types
export type ActivityType = 'country_visited' | 'entry_added';

export interface FeedItemUser {
  user_id: string;
  username: string;
  avatar_url: string | null;
}

export interface FeedItemCountry {
  country_id: string;
  country_name: string;
  country_code: string;
}

export interface FeedItemEntry {
  entry_id: string;
  entry_name: string;
  entry_type: string;
  location_name: string | null;
  image_url: string | null;
}

export interface FeedItem {
  activity_type: ActivityType;
  created_at: string;
  user: FeedItemUser;
  country: FeedItemCountry | null;
  entry: FeedItemEntry | null;
}

interface FeedResponse {
  items: FeedItem[];
  next_cursor: string | null;
  has_more: boolean;
}

// Query key
const FEED_KEY = ['feed'];

/**
 * Hook to fetch the activity feed with infinite scroll pagination.
 */
export function useFeed(options?: { limit?: number }) {
  const limit = options?.limit ?? 20;

  return useInfiniteQuery<FeedResponse>({
    queryKey: [...FEED_KEY, { limit }],
    queryFn: async ({ pageParam }) => {
      const params: Record<string, string | number> = { limit };
      if (pageParam) {
        params.before = pageParam as string;
      }
      const response = await api.get<FeedResponse>('/feed', { params });
      return response.data;
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => {
      if (lastPage.has_more && lastPage.next_cursor) {
        return lastPage.next_cursor;
      }
      return undefined;
    },
    staleTime: 1000 * 60, // 1 minute
  });
}

/**
 * Get all feed items from all pages as a flat array.
 */
export function getFeedItems(
  data: ReturnType<typeof useFeed>['data']
): FeedItem[] {
  if (!data?.pages) return [];
  return data.pages.flatMap((page) => page.items);
}
