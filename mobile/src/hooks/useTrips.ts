import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert } from 'react-native';

import { api } from '@services/api';
import { AdEvents } from '@services/adEvents';
import { STALE_TIMES } from '../queryClient';
import { Analytics } from '@services/analytics';

// Trip tag status enum matching backend
export type TripTagStatus = 'pending' | 'approved' | 'declined';

// User profile info for trip tag display
export interface TripTagUser {
  user_id: string;
  username: string;
  display_name?: string;
  avatar_url?: string;
}

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
  // User profile info (populated when fetching trip details)
  user?: TripTagUser;
}

// Trip interface matching backend Trip schema
export interface Trip {
  id: string;
  user_id: string;
  country_id?: string; // Nullable for system trips
  country_code?: string; // ISO 3166-1 alpha-2 code (e.g., "JP", "US"), nullable for system trips
  name: string;
  cover_image_url?: string;
  date_range?: string; // PostgreSQL daterange as string e.g. "[2024-01-01,2024-01-15]"
  is_system?: boolean; // True for uncategorized/system trips
  created_at: string;
}

// Uncategorized trip with entry count
export interface UncategorizedTrip extends Trip {
  entry_count: number;
}

// Trip with tags matching backend TripWithTags schema
export interface TripWithTags extends Trip {
  tags: TripTag[];
  // Owner profile info (for displaying trip owner when viewing someone else's trip)
  owner?: TripTagUser;
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
  country_code?: string; // 2-letter ISO code; rejected by backend for system trips
  cover_image_url?: string;
  previousCountryCode?: string; // For cache invalidation when country changes
}

const TRIPS_QUERY_KEY = ['trips'];

// Fetch all trips for the current user (includes tags and owner info)
export function useTrips() {
  return useQuery({
    queryKey: TRIPS_QUERY_KEY,
    queryFn: async (): Promise<TripWithTags[]> => {
      const response = await api.get('/trips');
      return response.data;
    },
    staleTime: STALE_TIMES.USER_DATA, // 5 minutes - trips rarely change outside mutations
    gcTime: 1000 * 60 * 30, // 30 minutes - keep in cache for navigation
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
    staleTime: STALE_TIMES.USER_DATA, // 5 minutes
    gcTime: 1000 * 60 * 30, // 30 minutes
  });
}

// Fetch a single trip by ID (includes tags)
export function useTrip(tripId: string) {
  return useQuery({
    queryKey: [...TRIPS_QUERY_KEY, tripId],
    queryFn: async (): Promise<TripWithTags> => {
      const response = await api.get(`/trips/${tripId}`);
      return response.data;
    },
    enabled: !!tripId,
    staleTime: STALE_TIMES.USER_DATA, // 5 minutes
    gcTime: 1000 * 60 * 30, // 30 minutes
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
      // Track trip creation
      if (data.country_code) {
        Analytics.createTrip(data.country_code);
        // Track ad conversion for first trip (fire-and-forget)
        AdEvents.firstTripCreated(data.country_code).catch(() => {});
      }

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
    mutationFn: async (tripId: string): Promise<string | undefined> => {
      // Get trip data before deletion for scoped invalidation
      const tripData = queryClient.getQueryData<Trip>([...TRIPS_QUERY_KEY, tripId]);
      await api.delete(`/trips/${tripId}`);
      return tripData?.country_code;
    },
    onSuccess: (countryCode, tripId) => {
      // Scope invalidations to affected queries only
      queryClient.invalidateQueries({ queryKey: TRIPS_QUERY_KEY, exact: true });
      queryClient.invalidateQueries({ queryKey: [...TRIPS_QUERY_KEY, tripId] });
      if (countryCode) {
        queryClient.invalidateQueries({
          queryKey: [...TRIPS_QUERY_KEY, { countryId: countryCode }],
        });
      }
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
    onSuccess: (data) => {
      // Scope invalidations to affected queries only
      queryClient.invalidateQueries({ queryKey: TRIPS_QUERY_KEY, exact: true });
      queryClient.invalidateQueries({ queryKey: [...TRIPS_QUERY_KEY, data.id] });
      if (data.country_code) {
        queryClient.invalidateQueries({
          queryKey: [...TRIPS_QUERY_KEY, { countryId: data.country_code }],
        });
      }
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Failed to restore trip';
      Alert.alert('Error', message);
    },
  });
}

// Add a tag to an existing trip
export function useAddTripTag() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      tripId,
      taggedUserId,
    }: {
      tripId: string;
      taggedUserId: string;
    }): Promise<TripTag> => {
      const response = await api.post(`/trip-tags/${tripId}/tags/${taggedUserId}`);
      return response.data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: [...TRIPS_QUERY_KEY, variables.tripId] });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Failed to tag friend';
      Alert.alert('Error', message);
    },
  });
}

// Remove a tag from a trip
export function useRemoveTripTag() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      tripId,
      taggedUserId,
    }: {
      tripId: string;
      taggedUserId: string;
    }): Promise<void> => {
      await api.delete(`/trip-tags/${tripId}/tags/${taggedUserId}`);
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: [...TRIPS_QUERY_KEY, variables.tripId] });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Failed to remove tag';
      Alert.alert('Error', message);
    },
  });
}

// Query key for uncategorized trip
const UNCATEGORIZED_TRIP_QUERY_KEY = ['trips', 'uncategorized'];

// Fetch the user's uncategorized/Saved Places trip (creates if doesn't exist)
export function useUncategorizedTrip() {
  return useQuery({
    queryKey: UNCATEGORIZED_TRIP_QUERY_KEY,
    queryFn: async (): Promise<UncategorizedTrip> => {
      const response = await api.get('/trips/uncategorized');
      return response.data;
    },
    // Trip metadata never changes; only entry_count changes via move mutations
    // which trigger invalidation. Longer staleTime reduces redundant fetches.
    staleTime: STALE_TIMES.SYSTEM_TRIP, // 10 minutes
    gcTime: 1000 * 60 * 60, // 1 hour - keep singleton in cache longer
  });
}

// Move entry to different trip
export interface MoveEntryInput {
  entryId: string;
  tripId: string;
  sourceTripId?: string; // Optional: for scoped cache invalidation
}

export function useMoveEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ entryId, tripId }: MoveEntryInput) => {
      const response = await api.patch(`/entries/${entryId}/move`, { trip_id: tripId });
      return response.data;
    },
    onSuccess: (_data, variables) => {
      // Invalidate uncategorized trip (entry count changed)
      queryClient.invalidateQueries({ queryKey: UNCATEGORIZED_TRIP_QUERY_KEY });
      // Invalidate target trip entries
      queryClient.invalidateQueries({ queryKey: ['entries', variables.tripId] });
      // Invalidate source trip entries if provided (scoped invalidation)
      if (variables.sourceTripId) {
        queryClient.invalidateQueries({ queryKey: ['entries', variables.sourceTripId] });
      }
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Failed to move entry';
      Alert.alert('Error', message);
    },
  });
}

// Bulk move entries to a trip
export interface BulkMoveInput {
  entryIds: string[];
  targetTripId: string;
  sourceTripId?: string; // Optional: for scoped cache invalidation
}

export interface BulkMoveResult {
  moved_count: number;
  entries: unknown[];
}

export function useBulkMoveEntries() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ entryIds, targetTripId }: BulkMoveInput): Promise<BulkMoveResult> => {
      if (entryIds.length === 0) {
        throw new Error('No entries selected');
      }
      const response = await api.post('/entries/bulk-move', {
        entry_ids: entryIds,
        target_trip_id: targetTripId,
      });
      return response.data;
    },
    onSuccess: (_data, variables) => {
      // Invalidate uncategorized trip (entry count changed)
      queryClient.invalidateQueries({ queryKey: UNCATEGORIZED_TRIP_QUERY_KEY });
      // Invalidate target trip entries
      queryClient.invalidateQueries({ queryKey: ['entries', variables.targetTripId] });
      // Invalidate source trip entries if provided (scoped invalidation)
      if (variables.sourceTripId) {
        queryClient.invalidateQueries({ queryKey: ['entries', variables.sourceTripId] });
      }
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Failed to move entries';
      Alert.alert('Error', message);
    },
  });
}
