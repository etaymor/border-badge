import { useInfiniteQuery } from '@tanstack/react-query';

import { api } from '@services/api';
import type { FeedItem } from './useFeed';

interface FeedResponse {
  items: FeedItem[];
  next_cursor: string | null;
  has_more: boolean;
}

/**
 * Hook to fetch a specific user's activity feed with infinite scroll pagination.
 *
 * @param userId The user whose activities to fetch
 * @param options Optional configuration
 */
export function useUserFeed(userId: string, options?: { limit?: number }) {
  const limit = options?.limit ?? 20;

  return useInfiniteQuery<FeedResponse>({
    queryKey: ['user-feed', userId, { limit }],
    queryFn: async ({ pageParam }) => {
      const params: Record<string, string | number> = { limit };
      if (pageParam) {
        params.before = pageParam as string;
      }
      const response = await api.get<FeedResponse>(`/feed/user/${userId}`, { params });
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
    enabled: !!userId,
  });
}

/**
 * Get all user feed items from all pages as a flat array.
 */
export function getUserFeedItems(
  data: ReturnType<typeof useUserFeed>['data']
): FeedItem[] {
  if (!data?.pages) return [];
  return data.pages.flatMap((page) => page.items);
}
