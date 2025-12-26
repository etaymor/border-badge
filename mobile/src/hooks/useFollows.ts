import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert } from 'react-native';

import { api } from '@services/api';

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
  previousStats?: FollowStats;
  previousFollowing?: UserSummary[];
}

// Query keys
const FOLLOWS_KEY = ['follows'];
const STATS_KEY = [...FOLLOWS_KEY, 'stats'];
const FOLLOWING_KEY = [...FOLLOWS_KEY, 'following'];
const FOLLOWERS_KEY = [...FOLLOWS_KEY, 'followers'];

/**
 * Hook to get follow statistics for the current user.
 */
export function useFollowStats() {
  return useQuery<FollowStats>({
    queryKey: STATS_KEY,
    queryFn: async () => {
      const response = await api.get<FollowStats>('/follows/stats');
      return response.data;
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

/**
 * Hook to get list of users the current user is following.
 */
export function useFollowing(options?: { limit?: number; offset?: number }) {
  const limit = options?.limit ?? 20;
  const offset = options?.offset ?? 0;

  return useQuery<UserSummary[]>({
    queryKey: [...FOLLOWING_KEY, { limit, offset }],
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
    queryKey: [...FOLLOWERS_KEY, { limit, offset }],
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
 * Hook to follow a user with optimistic updates.
 */
export function useFollowUser(userId: string) {
  const queryClient = useQueryClient();

  return useMutation<FollowResponse, Error, void, FollowMutationContext>({
    mutationFn: async () => {
      const response = await api.post<FollowResponse>(`/follows/${userId}`);
      return response.data;
    },

    onMutate: async () => {
      // Cancel outgoing queries
      await queryClient.cancelQueries({ queryKey: STATS_KEY });
      await queryClient.cancelQueries({ queryKey: ['user', userId] });

      // Snapshot previous values
      const previousStats = queryClient.getQueryData<FollowStats>(STATS_KEY);

      // Optimistically update stats
      queryClient.setQueryData<FollowStats>(STATS_KEY, (old) => {
        if (!old) return old;
        return {
          ...old,
          following_count: old.following_count + 1,
        };
      });

      return { previousStats };
    },

    onError: (error, _variables, context) => {
      // Rollback on error
      if (context?.previousStats) {
        queryClient.setQueryData(STATS_KEY, context.previousStats);
      }

      const message = error.message || 'Failed to follow user';
      Alert.alert('Error', message);
    },

    onSettled: () => {
      // Always refetch after mutation
      queryClient.invalidateQueries({ queryKey: STATS_KEY });
      queryClient.invalidateQueries({ queryKey: FOLLOWING_KEY });
      queryClient.invalidateQueries({ queryKey: ['user', userId] });
      queryClient.invalidateQueries({ queryKey: ['feed'] });
    },
  });
}

/**
 * Hook to unfollow a user with optimistic updates.
 */
export function useUnfollowUser(userId: string) {
  const queryClient = useQueryClient();

  return useMutation<FollowResponse, Error, void, FollowMutationContext>({
    mutationFn: async () => {
      const response = await api.delete<FollowResponse>(`/follows/${userId}`);
      return response.data;
    },

    onMutate: async () => {
      // Cancel outgoing queries
      await queryClient.cancelQueries({ queryKey: STATS_KEY });
      await queryClient.cancelQueries({ queryKey: ['user', userId] });

      // Snapshot previous values
      const previousStats = queryClient.getQueryData<FollowStats>(STATS_KEY);

      // Optimistically update stats
      queryClient.setQueryData<FollowStats>(STATS_KEY, (old) => {
        if (!old) return old;
        return {
          ...old,
          following_count: Math.max(0, old.following_count - 1),
        };
      });

      return { previousStats };
    },

    onError: (error, _variables, context) => {
      // Rollback on error
      if (context?.previousStats) {
        queryClient.setQueryData(STATS_KEY, context.previousStats);
      }

      const message = error.message || 'Failed to unfollow user';
      Alert.alert('Error', message);
    },

    onSettled: () => {
      // Always refetch after mutation
      queryClient.invalidateQueries({ queryKey: STATS_KEY });
      queryClient.invalidateQueries({ queryKey: FOLLOWING_KEY });
      queryClient.invalidateQueries({ queryKey: ['user', userId] });
      queryClient.invalidateQueries({ queryKey: ['feed'] });
    },
  });
}
