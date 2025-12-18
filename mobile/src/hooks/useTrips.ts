import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert } from 'react-native';

import { api } from '@services/api';

// Trip tag status enum matching backend
export type TripTagStatus = 'pending' | 'approved' | 'declined';

// Trip tag interface matching backend TripTag schema
export interface TripTag {
  id: string;
  trip_id: string;
  tagged_user_id: string;
  status: TripTagStatus;
  initiated_by?: string;
  notification_id?: string;
  created_at: string;
  responded_at?: string;
}

// Trip interface matching backend Trip schema
export interface Trip {
  id: string;
  user_id: string;
  country_id: string;
  country_code: string; // ISO 3166-1 alpha-2 code (e.g., "JP", "US")
  name: string;
  cover_image_url?: string;
  date_range?: string; // PostgreSQL daterange as string e.g. "[2024-01-01,2024-01-15]"
  created_at: string;
}

// Trip with tags matching backend TripWithTags schema
export interface TripWithTags extends Trip {
  tags: TripTag[];
}

export interface CreateTripInput {
  name: string;
  country_code: string; // 2-letter ISO code
  cover_image_url?: string;
  tagged_user_ids?: string[];
}

export interface UpdateTripInput {
  id: string;
  name?: string;
  cover_image_url?: string;
  previousCountryCode?: string; // For cache invalidation when country changes
}

const TRIPS_QUERY_KEY = ['trips'];

// Fetch all trips for the current user
export function useTrips() {
  return useQuery({
    queryKey: TRIPS_QUERY_KEY,
    queryFn: async (): Promise<Trip[]> => {
      const response = await api.get('/trips');
      return response.data;
    },
  });
}

// Fetch trips filtered by country
export function useTripsByCountry(countryId: string) {
  return useQuery({
    queryKey: [...TRIPS_QUERY_KEY, { countryId }],
    queryFn: async (): Promise<Trip[]> => {
      const response = await api.get(`/trips?country_code=${countryId}`);
      return response.data;
    },
    enabled: !!countryId,
  });
}

// Fetch a single trip by ID
export function useTrip(tripId: string) {
  return useQuery({
    queryKey: [...TRIPS_QUERY_KEY, tripId],
    queryFn: async (): Promise<Trip> => {
      const response = await api.get(`/trips/${tripId}`);
      return response.data;
    },
    enabled: !!tripId,
  });
}

// Create a new trip
export function useCreateTrip() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateTripInput): Promise<TripWithTags> => {
      const response = await api.post('/trips', input);
      return response.data;
    },
    onSuccess: (data) => {
      // Invalidate the main trips list and country-specific list
      queryClient.invalidateQueries({ queryKey: TRIPS_QUERY_KEY, exact: true });
      queryClient.invalidateQueries({
        queryKey: [...TRIPS_QUERY_KEY, { countryId: data.country_code }],
      });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Failed to create trip';
      Alert.alert('Error', message);
    },
  });
}

// Update an existing trip
export function useUpdateTrip() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      previousCountryCode: _,
      ...input
    }: UpdateTripInput): Promise<Trip> => {
      const response = await api.patch(`/trips/${id}`, input);
      return response.data;
    },
    onSuccess: (data, variables) => {
      // Invalidate only the affected queries (not all trips)
      queryClient.invalidateQueries({ queryKey: TRIPS_QUERY_KEY, exact: true });
      queryClient.invalidateQueries({ queryKey: [...TRIPS_QUERY_KEY, data.id] });
      queryClient.invalidateQueries({
        queryKey: [...TRIPS_QUERY_KEY, { countryId: data.country_code }],
      });

      // Invalidate old country's cache if country was changed
      if (variables.previousCountryCode && variables.previousCountryCode !== data.country_code) {
        queryClient.invalidateQueries({
          queryKey: [...TRIPS_QUERY_KEY, { countryId: variables.previousCountryCode }],
        });
      }
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Failed to update trip';
      Alert.alert('Error', message);
    },
  });
}

// Delete a trip (soft-delete)
export function useDeleteTrip() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (tripId: string): Promise<void> => {
      await api.delete(`/trips/${tripId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: TRIPS_QUERY_KEY });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Failed to delete trip';
      Alert.alert('Error', message);
    },
  });
}

// Restore a soft-deleted trip
export function useRestoreTrip() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (tripId: string): Promise<Trip> => {
      const response = await api.post(`/trips/${tripId}/restore`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: TRIPS_QUERY_KEY });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Failed to restore trip';
      Alert.alert('Error', message);
    },
  });
}
