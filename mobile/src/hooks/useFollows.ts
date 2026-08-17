import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { Alert } from 'react-native';

import { socialKeys } from '@hooks/queryKeys';
import type { SocialHomeInfiniteData } from '@hooks/useSocialHome';
import { updateSocialHomeFirstPage } from '@hooks/useSocialHome';
import type { UserProfile } from '@hooks/useUserProfile';
import type { UserSearchResult } from '@hooks/useUserSearch';
import { api } from '@services/api';
import { getSocialErrorMessage } from '@utils/socialErrors';

// Types
export interface UserSummary {
  id: string;
  user_id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  country_count: number;
}

export interface FollowStats {
  follower_count: number;
  following_count: number;
}

interface FollowResponse {
  status: string;
  following_id: string;
}

interface FollowMutationContext {
  previousProfile?: UserProfile;
  previousSocialHome: Array<[QueryKey, SocialHomeInfiniteData | undefined]>;
  previousSearches: Array<[QueryKey, UserSearchResult[] | undefined]>;
}

/**
 * Hook to get list of users the current user is following.
 */
export function useFollowing(options?: { limit?: number; offset?: number }) {
  const limit = options?.limit ?? 20;
  const offset = options?.offset ?? 0;

  return useQuery<UserSummary[]>({
    queryKey: socialKeys.followingPage(limit, offset),
    queryFn: async () => {
      const response = await api.get<UserSummary[]>('/follows/following', {
        params: { limit, offset },
      });
      return response.data;
    },
    staleTime: 1000 * 60, // 1 minute
  });
}

/**
 * Hook to get list of users following the current user.
 */
export function useFollowers(options?: { limit?: number; offset?: number }) {
  const limit = options?.limit ?? 20;
  const offset = options?.offset ?? 0;

  return useQuery<UserSummary[]>({
    queryKey: socialKeys.followersPage(limit, offset),
    queryFn: async () => {
      const response = await api.get<UserSummary[]>('/follows/followers', {
        params: { limit, offset },
      });
      return response.data;
    },
    staleTime: 1000 * 60, // 1 minute
  });
}

/**
 * Surgically apply a follow/unfollow change to every cache the user can see:
 * the target's profile, my social-home follow stats (page 1), and any cached
 * search results showing the target. Snapshots are returned for rollback.
 */
async function applyOptimisticFollowChange(
  queryClient: QueryClient,
  userId: string,
  username: string | undefined,
  isFollowing: boolean
): Promise<FollowMutationContext> {
  const delta = isFollowing ? 1 : -1;

  // Cancel in-flight fetches so they cannot clobber the optimistic values.
  await queryClient.cancelQueries({ queryKey: socialKeys.socialHome });
  await queryClient.cancelQueries({ queryKey: socialKeys.userSearch });
  if (username) {
    await queryClient.cancelQueries({ queryKey: socialKeys.userProfile(username) });
  }

  // Snapshot previous values for rollback.
  const previousProfile = username
    ? queryClient.getQueryData<UserProfile>(socialKeys.userProfile(username))
    : undefined;
  const previousSocialHome = queryClient.getQueriesData<SocialHomeInfiniteData>({
    queryKey: socialKeys.socialHome,
  });
  const previousSearches = queryClient.getQueriesData<UserSearchResult[]>({
    queryKey: socialKeys.userSearch,
  });

  // Target user's profile: flip follow state, adjust their follower count.
  if (username) {
    queryClient.setQueryData<UserProfile>(socialKeys.userProfile(username), (old) =>
      old
        ? {
            ...old,
            is_following: isFollowing,
            follower_count: Math.max(0, old.follower_count + delta),
          }
        : old
    );
  }

  // Social-home page 1: adjust my following count. Feed pages stay untouched.
  updateSocialHomeFirstPage(queryClient, (page) => ({
    ...page,
    follow_stats: {
      ...page.follow_stats,
      following_count: Math.max(0, page.follow_stats.following_count + delta),
    },
  }));

  // Cached search results showing this user: flip follow state.
  queryClient.setQueriesData<UserSearchResult[]>({ queryKey: socialKeys.userSearch }, (old) =>
    old?.map((user) => (user.id === userId ? { ...user, is_following: isFollowing } : user))
  );

  return { previousProfile, previousSocialHome, previousSearches };
}

function rollbackFollowChange(
  queryClient: QueryClient,
  username: string | undefined,
  context: FollowMutationContext | undefined
): void {
  if (!context) return;
  if (username && context.previousProfile !== undefined) {
    queryClient.setQueryData(socialKeys.userProfile(username), context.previousProfile);
  }
  for (const [queryKey, data] of context.previousSocialHome) {
    queryClient.setQueryData(queryKey, data);
  }
  for (const [queryKey, data] of context.previousSearches) {
    queryClient.setQueryData(queryKey, data);
  }
}

/**
 * Hook to follow a user with optimistic updates.
 */
export function useFollowUser(userId: string, username?: string) {
  const queryClient = useQueryClient();

  return useMutation<FollowResponse, Error, void, FollowMutationContext>({
    mutationFn: async () => {
      const response = await api.post<FollowResponse>(`/follows/${userId}`);
      return response.data;
    },

    onMutate: () => applyOptimisticFollowChange(queryClient, userId, username, true),

    onError: (error, _variables, context) => {
      rollbackFollowChange(queryClient, username, context);
      Alert.alert('Error', getSocialErrorMessage(error, 'follow'));
    },

    onSettled: () => {
      // The following list is the only visible cache not updated in place.
      queryClient.invalidateQueries({ queryKey: socialKeys.following });
    },
  });
}

/**
 * Hook to unfollow a user with optimistic updates.
 */
export function useUnfollowUser(userId: string, username?: string) {
  const queryClient = useQueryClient();

  return useMutation<FollowResponse, Error, void, FollowMutationContext>({
    mutationFn: async () => {
      const response = await api.delete<FollowResponse>(`/follows/${userId}`);
      return response.data;
    },

    onMutate: () => applyOptimisticFollowChange(queryClient, userId, username, false),

    onError: (error, _variables, context) => {
      rollbackFollowChange(queryClient, username, context);
      Alert.alert('Error', getSocialErrorMessage(error, 'unfollow'));
    },

    onSettled: () => {
      // The following list is the only visible cache not updated in place.
      queryClient.invalidateQueries({ queryKey: socialKeys.following });
    },
  });
}
