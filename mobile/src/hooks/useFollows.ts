import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '@services/api';

// Follow user interface
export interface FollowUser {
  id: string;
  username: string;
  avatar_url: string | null;
  country_count: number;
  is_following: boolean;
  created_at: string;
}

// Follow stats interface
export interface FollowStats {
  following_count: number;
  follower_count: number;
}

// Paginated follow list response
export interface PaginatedFollowList {
  users: FollowUser[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

const FOLLOWS_KEY = ['follows'];
const FOLLOWERS_KEY = ['followers'];
const FOLLOW_STATS_KEY = ['follow-stats'];

// Get following list (users I follow)
export function useFollowing(limit = 20, offset = 0) {
  return useQuery({
    queryKey: [...FOLLOWS_KEY, 'following', { limit, offset }],
    queryFn: async (): Promise<PaginatedFollowList> => {
      const response = await api.get('/follows/following', {
        params: { limit, offset },
      });
      return response.data;
    },
  });
}

// Get followers list (users following me)
export function useFollowers(limit = 20, offset = 0) {
  return useQuery({
    queryKey: [...FOLLOWERS_KEY, { limit, offset }],
    queryFn: async (): Promise<PaginatedFollowList> => {
      const response = await api.get('/follows/followers', {
        params: { limit, offset },
      });
      return response.data;
    },
  });
}

// Get follow stats (counts)
export function useFollowStats() {
  return useQuery({
    queryKey: FOLLOW_STATS_KEY,
    queryFn: async (): Promise<FollowStats> => {
      const response = await api.get('/follows/stats');
      return response.data;
    },
  });
}

// Follow a user
export function useFollowUser(userId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      await api.post(`/follows/${userId}`);
    },

    // Optimistic update
    onMutate: async () => {
      // Cancel outgoing queries for this user
      await queryClient.cancelQueries({ queryKey: ['user', userId] });

      // Snapshot previous value
      const previousUser = queryClient.getQueryData(['user', userId]);

      // Optimistically update user profile cache
      queryClient.setQueryData(['user', userId], (old: unknown) => {
        if (!old || typeof old !== 'object') return old;
        const profile = old as Record<string, unknown>;
        return {
          ...profile,
          is_following: true,
          follower_count: ((profile.follower_count as number) || 0) + 1,
        };
      });

      return { previousUser };
    },

    // Rollback on error
    onError: (err, variables, context) => {
      if (context?.previousUser) {
        queryClient.setQueryData(['user', userId], context.previousUser);
      }
    },

    // Always refetch after mutation
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['user', userId] });
      queryClient.invalidateQueries({ queryKey: FOLLOWS_KEY });
      queryClient.invalidateQueries({ queryKey: FOLLOW_STATS_KEY });
      queryClient.invalidateQueries({ queryKey: ['feed'] });
    },
  });
}

// Unfollow a user
export function useUnfollowUser(userId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      await api.delete(`/follows/${userId}`);
    },

    // Optimistic update
    onMutate: async () => {
      // Cancel outgoing queries for this user
      await queryClient.cancelQueries({ queryKey: ['user', userId] });

      // Snapshot previous value
      const previousUser = queryClient.getQueryData(['user', userId]);

      // Optimistically update user profile cache
      queryClient.setQueryData(['user', userId], (old: unknown) => {
        if (!old || typeof old !== 'object') return old;
        const profile = old as Record<string, unknown>;
        return {
          ...profile,
          is_following: false,
          follower_count: Math.max(((profile.follower_count as number) || 0) - 1, 0),
        };
      });

      return { previousUser };
    },

    // Rollback on error
    onError: (err, variables, context) => {
      if (context?.previousUser) {
        queryClient.setQueryData(['user', userId], context.previousUser);
      }
    },

    // Always refetch after mutation
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['user', userId] });
      queryClient.invalidateQueries({ queryKey: FOLLOWS_KEY });
      queryClient.invalidateQueries({ queryKey: FOLLOW_STATS_KEY });
      queryClient.invalidateQueries({ queryKey: ['feed'] });
    },
  });
}
