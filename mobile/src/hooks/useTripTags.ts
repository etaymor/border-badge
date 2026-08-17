/**
 * Hooks for managing trip tag invitations (pending, approve, decline).
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert } from 'react-native';

import { features } from '@config/features';
import { api } from '@services/api';

/**
 * Extended type for pending trip tag with trip and initiator details.
 */
export interface PendingTripTag {
  id: string;
  trip_id: string;
  trip_name: string;
  trip_country_code: string;
  initiated_by: string | null;
  initiated_by_username: string | null;
  initiated_by_avatar_url: string | null;
  created_at: string;
}

/**
 * Response from approve/decline actions.
 */
export interface TripTagActionResponse {
  status: 'pending' | 'approved' | 'declined';
  responded_at: string;
}

const PENDING_TAGS_KEY = ['trip-tags', 'pending'];
const PENDING_TAG_COUNT_KEY = ['trip-tags', 'pending', 'count'];

/**
 * Fetch pending trip tag invitations for the current user.
 */
export function usePendingTripTags() {
  return useQuery({
    queryKey: PENDING_TAGS_KEY,
    queryFn: async (): Promise<PendingTripTag[]> => {
      const response = await api.get('/trip-tags/pending');
      return response.data;
    },
    staleTime: 1000 * 60 * 2, // 2 minutes
  });
}

/**
 * Fetch the count of pending trip tags for badge indicators.
 */
export function usePendingTripTagCount() {
  return useQuery({
    queryKey: PENDING_TAG_COUNT_KEY,
    queryFn: async (): Promise<number> => {
      const response = await api.get('/trip-tags/pending/count');
      return response.data.count;
    },
    staleTime: 1000 * 30, // 30 seconds
    // Trip tags are a social feature; the endpoint 404s when the flag is off.
    enabled: features.enableSocial,
  });
}

/**
 * Approve a pending trip tag invitation.
 */
export function useApproveTripTag() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (tripId: string): Promise<TripTagActionResponse> => {
      const response = await api.post(`/trip-tags/${tripId}/approve`);
      return response.data;
    },
    onSuccess: () => {
      // Invalidate pending tags to refresh the list
      queryClient.invalidateQueries({ queryKey: PENDING_TAGS_KEY });
      // Also invalidate trips in case tags affect trip visibility
      queryClient.invalidateQueries({ queryKey: ['trips'] });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Failed to approve invitation';
      Alert.alert('Error', message);
    },
  });
}

/**
 * Decline a pending trip tag invitation.
 */
export function useDeclineTripTag() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (tripId: string): Promise<TripTagActionResponse> => {
      const response = await api.post(`/trip-tags/${tripId}/decline`);
      return response.data;
    },
    onSuccess: () => {
      // Invalidate pending tags to refresh the list
      queryClient.invalidateQueries({ queryKey: PENDING_TAGS_KEY });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Failed to decline invitation';
      Alert.alert('Error', message);
    },
  });
}
