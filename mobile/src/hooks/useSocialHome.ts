import { useInfiniteQuery } from '@tanstack/react-query';
import type { InfiniteData, QueryClient } from '@tanstack/react-query';

import { socialKeys } from '@hooks/queryKeys';
import type { FollowStats } from '@hooks/useFollows';
import { api } from '@services/api';

// ---------------------------------------------------------------------------
// Feed types — the social-home feed is the app's one feed surface.
// ---------------------------------------------------------------------------

/** Activity types this build knows how to render. */
export type KnownActivityType = 'country_visited' | 'entry_added' | 'trip_updated';

/**
 * Wire-compat rule: the server may ship activity types this build does not
 * know about. Renderers must default-skip unknown values, so the type admits
 * arbitrary strings while keeping autocomplete for the known ones.
 */
export type ActivityType = KnownActivityType | (string & {});

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
  /** Stable server-side id for this activity; the feed list key. */
  activity_id: string;
  activity_type: ActivityType;
  created_at: string;
  user: FeedItemUser;
  country: FeedItemCountry | null;
  entry: FeedItemEntry | null;
}

export interface FeedResponse {
  items: FeedItem[];
  next_cursor: string | null;
  has_more: boolean;
}

export interface FriendsRanking {
  rank: number;
  total_friends: number;
  my_countries: number;
  leader_username: string | null;
  leader_countries: number | null;
}

export interface SocialHomePage {
  feed: FeedResponse;
  follow_stats: FollowStats;
  friends_ranking: FriendsRanking;
  pending_tag_count: number;
}

export type SocialHomeInfiniteData = InfiniteData<SocialHomePage, string | null>;

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
    queryKey: socialKeys.socialHomePage(limit),
    queryFn: ({ pageParam }) => fetchSocialHomePage(limit, (pageParam as string | null) ?? null),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => {
      if (lastPage.feed.has_more && lastPage.feed.next_cursor) {
        return lastPage.feed.next_cursor;
      }
      return undefined;
    },
    staleTime: 1000 * 60 * 5, // 5 minutes - feeds are pre-computed server-side
  });
}

/**
 * Surgically update the first page of every cached social-home query.
 * Used by mutations to keep visible stats/badges accurate without refetching
 * loaded feed pages.
 */
export function updateSocialHomeFirstPage(
  queryClient: QueryClient,
  update: (page: SocialHomePage) => SocialHomePage
): void {
  queryClient.setQueriesData<SocialHomeInfiniteData>({ queryKey: socialKeys.socialHome }, (old) => {
    if (!old?.pages?.length) return old;
    const [first, ...rest] = old.pages;
    return { ...old, pages: [update(first), ...rest] };
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
