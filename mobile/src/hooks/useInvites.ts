import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert } from 'react-native';

import { api } from '@services/api';

// Types
export interface PendingInvite {
  id: string;
  email: string;
  invite_type: 'follow' | 'trip_tag';
  status: string;
  created_at: string;
}

interface InviteRequest {
  email: string;
  invite_type?: 'follow' | 'trip_tag';
  trip_id?: string;
}

interface InviteResponse {
  status: string;
  email: string;
}

// Query keys
const INVITES_KEY = ['invites'];

/**
 * Hook to get list of pending invites sent by the current user.
 */
export function usePendingInvites(options?: { limit?: number; offset?: number }) {
  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;

  return useQuery<PendingInvite[]>({
    queryKey: [...INVITES_KEY, 'pending', { limit, offset }],
    queryFn: async () => {
      const response = await api.get<PendingInvite[]>('/invites/pending', {
        params: { limit, offset },
      });
      return response.data;
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

/**
 * Hook to send an invite to a non-user.
 */
export function useSendInvite() {
  const queryClient = useQueryClient();

  return useMutation<InviteResponse, Error, InviteRequest>({
    mutationFn: async (data) => {
      const response = await api.post<InviteResponse>('/invites', data);
      return response.data;
    },

    onSuccess: (data) => {
      // Invalidate pending invites query
      queryClient.invalidateQueries({ queryKey: INVITES_KEY });

      if (data.status === 'already_pending') {
        Alert.alert('Already Invited', `An invite is already pending for ${data.email}`);
      } else {
        Alert.alert('Invite Sent', `An invitation has been sent to ${data.email}`);
      }
    },

    onError: (error) => {
      const message = error.message || 'Failed to send invite';
      Alert.alert('Error', message);
    },
  });
}

/**
 * Hook to cancel a pending invite.
 */
export function useCancelInvite() {
  const queryClient = useQueryClient();

  return useMutation<{ status: string; invite_id: string }, Error, string>({
    mutationFn: async (inviteId) => {
      const response = await api.delete<{ status: string; invite_id: string }>(
        `/invites/${inviteId}`
      );
      return response.data;
    },

    onSuccess: () => {
      // Invalidate pending invites query
      queryClient.invalidateQueries({ queryKey: INVITES_KEY });
    },

    onError: (error) => {
      const message = error.message || 'Failed to cancel invite';
      Alert.alert('Error', message);
    },
  });
}
