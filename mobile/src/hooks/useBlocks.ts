import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert } from 'react-native';

import { api } from '@services/api';

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

// Query keys
const BLOCKS_KEY = ['blocks'];

/**
 * Hook to get list of blocked users.
 */
export function useBlockedUsers(options?: { limit?: number; offset?: number }) {
  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;

  return useQuery<BlockedUser[]>({
    queryKey: [...BLOCKS_KEY, { limit, offset }],
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
 */
export function useBlockUser(userId: string) {
  const queryClient = useQueryClient();

  return useMutation<BlockResponse, Error>({
    mutationFn: async () => {
      const response = await api.post<BlockResponse>(`/blocks/${userId}`);
      return response.data;
    },

    onSuccess: () => {
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: BLOCKS_KEY });
      queryClient.invalidateQueries({ queryKey: ['follows'] });
      queryClient.invalidateQueries({ queryKey: ['user', userId] });
      queryClient.invalidateQueries({ queryKey: ['feed'] });
    },

    onError: (error) => {
      const message = error.message || 'Failed to block user';
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
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: BLOCKS_KEY });
    },

    onError: (error) => {
      const message = error.message || 'Failed to unblock user';
      Alert.alert('Error', message);
    },
  });
}
