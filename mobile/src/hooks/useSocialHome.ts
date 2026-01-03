import { useInfiniteQuery } from '@tanstack/react-query';

import type { FollowStats } from '@hooks/useFollows';
import type { FriendsRanking } from '@hooks/useFriendsRanking';
import type { FeedItem, FeedResponse } from '@hooks/useFeed';
import { api } from '@services/api';

export interface SocialHomePage {
  feed: FeedResponse;
  follow_stats: FollowStats;
  friends_ranking: FriendsRanking;
  pending_tag_count: number;
}

export const SOCIAL_HOME_QUERY_KEY = ['social-home'];
export const SOCIAL_HOME_DEFAULT_LIMIT = 20;

export async function fetchSocialHomePage(
  limit: number,
  pageParam: string | null = null
): Promise<SocialHomePage> {
  const params: Record<string, string | number> = { limit };
  if (pageParam) {
    params.before = pageParam;
  }

  const response = await api.get<SocialHomePage>('/social/home', { params });
  return response.data;
}

export function useSocialHome(options?: { limit?: number }) {
  const limit = options?.limit ?? SOCIAL_HOME_DEFAULT_LIMIT;

  return useInfiniteQuery<SocialHomePage>({
    queryKey: [...SOCIAL_HOME_QUERY_KEY, { limit }],
    queryFn: ({ pageParam }) => fetchSocialHomePage(limit, (pageParam as string | null) ?? null),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => {
      if (lastPage.feed.has_more && lastPage.feed.next_cursor) {
        return lastPage.feed.next_cursor;
      }
      return undefined;
    },
    staleTime: 1000 * 60, // 1 minute
  });
}

export function getSocialFeedItems(data: ReturnType<typeof useSocialHome>['data']): FeedItem[] {
  if (!data?.pages) {
    return [];
  }

  return data.pages.flatMap((page) => page.feed.items);
}

export function getSocialHomeStats(
  data: ReturnType<typeof useSocialHome>['data']
): FollowStats | null {
  return data?.pages?.[0]?.follow_stats ?? null;
}

export function getSocialHomeRanking(
  data: ReturnType<typeof useSocialHome>['data']
): FriendsRanking | null {
  return data?.pages?.[0]?.friends_ranking ?? null;
}

export function getSocialPendingTagCount(data: ReturnType<typeof useSocialHome>['data']): number {
  return data?.pages?.[0]?.pending_tag_count ?? 0;
}
