import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert } from 'react-native';

import type { TrackingPreset } from '@constants/trackingPreferences';
import { STALE_TIMES } from '../queryClient';
import { api } from '@services/api';

export interface Profile {
  id: string;
  email: string;
  display_name?: string;
  avatar_url?: string;
  home_country_code?: string;
  travel_motives?: string[];
  persona_tags?: string[];
  tracking_preference: TrackingPreset;
  created_at: string;
  updated_at: string;
}

export interface UpdateProfileInput {
  display_name?: string;
  avatar_url?: string;
  home_country_code?: string;
  travel_motives?: string[];
  persona_tags?: string[];
  tracking_preference?: TrackingPreset;
}

const PROFILE_QUERY_KEY = ['profile'];

// Fetch the current user's profile
export function useProfile() {
  return useQuery({
    queryKey: PROFILE_QUERY_KEY,
    queryFn: async (): Promise<Profile> => {
      const response = await api.get('/profile');
      return response.data;
    },
    staleTime: STALE_TIMES.PROFILE, // 30 minutes - profile changes infrequently
  });
}

// Update the current user's profile
export function useUpdateProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: UpdateProfileInput): Promise<Profile> => {
      const response = await api.patch('/profile', input);
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(PROFILE_QUERY_KEY, data);
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Failed to update profile';
      Alert.alert('Error', message);
    },
  });
}
