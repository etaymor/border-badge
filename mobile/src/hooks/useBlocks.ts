import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert } from 'react-native';

import { socialKeys } from '@hooks/queryKeys';
import { api } from '@services/api';
import { getSocialErrorMessage } from '@utils/socialErrors';

// Types
export interface BlockedUser {
  id: string;
  user_id: string;
  username: string;
  avatar_url: string | null;
}

interface BlockResponse {
  status: string;
  blocked_id: string;
}

/**
 * Hook to get list of blocked users.
 */
export function useBlockedUsers(options?: { limit?: number; offset?: number }) {
  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;

  return useQuery<BlockedUser[]>({
    queryKey: socialKeys.blocksPage(limit, offset),
    queryFn: async () => {
      const response = await api.get<BlockedUser[]>('/blocks', {
        params: { limit, offset },
      });
      return response.data;
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

/**
 * Hook to block a user.
 *
 * On success the blocked user's content is purged (`removeQueries`, not
 * invalidated) from every cache that could show it. Removal also scrubs the
 * entries from the persisted query cache, so a cold-start rehydration cannot
 * resurrect the blocked user's items.
 */
export function useBlockUser(userId: string, username?: string) {
  const queryClient = useQueryClient();

  return useMutation<BlockResponse, Error>({
    mutationFn: async () => {
      const response = await api.post<BlockResponse>(`/blocks/${userId}`);
      return response.data;
    },

    onSuccess: () => {
      // Relationship lists refetch on next use.
      queryClient.invalidateQueries({ queryKey: socialKeys.blocks });
      queryClient.invalidateQueries({ queryKey: socialKeys.follows });

      // Purge caches that may contain the blocked user's content.
      queryClient.removeQueries({ queryKey: socialKeys.socialHome });
      queryClient.removeQueries({ queryKey: socialKeys.userFeed(userId) });
      queryClient.removeQueries({ queryKey: socialKeys.userSearch });
      if (username) {
        queryClient.removeQueries({ queryKey: socialKeys.userProfile(username) });
      }
    },

    onError: (error) => {
      const message = getSocialErrorMessage(error, 'block');
      Alert.alert('Error', message);
    },
  });
}

/**
 * Hook to unblock a user.
 */
export function useUnblockUser(userId: string) {
  const queryClient = useQueryClient();

  return useMutation<BlockResponse, Error>({
    mutationFn: async () => {
      const response = await api.delete<BlockResponse>(`/blocks/${userId}`);
      return response.data;
    },

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: socialKeys.blocks });
    },

    onError: (error) => {
      const message = getSocialErrorMessage(error, 'unblock');
      Alert.alert('Error', message);
    },
  });
}
