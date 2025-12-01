/**
 * React Query hooks for entries API.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert } from 'react-native';

import { api } from '@services/api';

// Entry type enum matching backend
export type EntryType = 'place' | 'food' | 'stay' | 'experience';

// Media file (for entries with media)
export interface MediaFile {
  id: string;
  url: string;
  thumbnail_url: string | null;
  status: 'processing' | 'uploaded' | 'failed';
}

// Place interface - frontend format with cleaner field names
export interface Place {
  id: string;
  entry_id: string;
  google_place_id: string | null;
  name: string;
  latitude: number | null;
  longitude: number | null;
  address: string | null;
}

// Place create input (for creating entries with places)
export interface PlaceInput {
  google_place_id: string | null;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
}

// Entry interface - frontend format with entry_type and entry_date
export interface Entry {
  id: string;
  trip_id: string;
  entry_type: EntryType;
  title: string;
  notes: string | null;
  entry_date: string | null; // ISO date string
  created_at: string;
}

// Entry with place and media
export interface EntryWithPlace extends Entry {
  place: Place | null;
  media_files?: MediaFile[];
}

// Input for creating an entry
export interface CreateEntryInput {
  trip_id: string;
  entry_type: EntryType;
  title: string;
  notes?: string;
  entry_date?: string; // ISO date string
  place?: PlaceInput;
}

// Input for updating an entry
export interface UpdateEntryInput {
  title?: string;
  entry_type?: EntryType;
  notes?: string;
  entry_date?: string;
  place?: PlaceInput;
}

const ENTRIES_QUERY_KEY = ['entries'];

// Transform backend entry to frontend format
function transformEntry(entry: Record<string, unknown>): EntryWithPlace {
  const place = entry.place as Record<string, unknown> | null;
  return {
    id: entry.id as string,
    trip_id: entry.trip_id as string,
    entry_type: (entry.type as EntryType) ?? 'place',
    title: entry.title as string,
    notes: (entry.notes as string) ?? null,
    entry_date: (entry.date as string) ?? null,
    created_at: entry.created_at as string,
    place: place
      ? {
          id: place.id as string,
          entry_id: place.entry_id as string,
          google_place_id: (place.google_place_id as string) ?? null,
          name: (place.place_name as string) ?? '',
          latitude: (place.lat as number) ?? null,
          longitude: (place.lng as number) ?? null,
          address: (place.address as string) ?? null,
        }
      : null,
    media_files: entry.media_files as MediaFile[] | undefined,
  };
}

// Fetch all entries for a trip
export function useEntries(tripId: string) {
  return useQuery({
    queryKey: [...ENTRIES_QUERY_KEY, tripId],
    queryFn: async (): Promise<EntryWithPlace[]> => {
      const response = await api.get(`/trips/${tripId}/entries`);
      return (response.data as Record<string, unknown>[]).map(transformEntry);
    },
    enabled: !!tripId,
  });
}

// Fetch a single entry by ID
export function useEntry(entryId: string) {
  return useQuery({
    queryKey: [...ENTRIES_QUERY_KEY, 'detail', entryId],
    queryFn: async (): Promise<EntryWithPlace> => {
      const response = await api.get(`/entries/${entryId}`);
      return transformEntry(response.data as Record<string, unknown>);
    },
    enabled: !!entryId,
  });
}

// Create a new entry
export function useCreateEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateEntryInput): Promise<EntryWithPlace> => {
      // Transform to backend format
      const backendInput = {
        type: input.entry_type,
        title: input.title,
        notes: input.notes,
        date: input.entry_date,
        place: input.place
          ? {
              google_place_id: input.place.google_place_id,
              place_name: input.place.name,
              lat: input.place.latitude,
              lng: input.place.longitude,
              address: input.place.address,
            }
          : undefined,
      };
      const response = await api.post(`/trips/${input.trip_id}/entries`, backendInput);
      return transformEntry(response.data as Record<string, unknown>);
    },
    onSuccess: (data) => {
      // Invalidate entries for this trip
      queryClient.invalidateQueries({ queryKey: [...ENTRIES_QUERY_KEY, data.trip_id] });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Failed to create entry';
      Alert.alert('Error', message);
    },
  });
}

// Update an existing entry
export function useUpdateEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      entryId,
      data,
    }: {
      entryId: string;
      data: UpdateEntryInput;
    }): Promise<EntryWithPlace> => {
      // Transform to backend format
      const backendInput: Record<string, unknown> = {};
      if (data.title !== undefined) backendInput.title = data.title;
      if (data.entry_type !== undefined) backendInput.type = data.entry_type;
      if (data.notes !== undefined) backendInput.notes = data.notes;
      if (data.entry_date !== undefined) backendInput.date = data.entry_date;
      if (data.place !== undefined) {
        backendInput.place = {
          google_place_id: data.place.google_place_id,
          place_name: data.place.name,
          lat: data.place.latitude,
          lng: data.place.longitude,
          address: data.place.address,
        };
      }
      const response = await api.patch(`/entries/${entryId}`, backendInput);
      return transformEntry(response.data as Record<string, unknown>);
    },
    onSuccess: (data) => {
      // Invalidate entries for this trip and the specific entry
      queryClient.invalidateQueries({ queryKey: [...ENTRIES_QUERY_KEY, data.trip_id] });
      queryClient.invalidateQueries({ queryKey: [...ENTRIES_QUERY_KEY, 'detail', data.id] });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Failed to update entry';
      Alert.alert('Error', message);
    },
  });
}

// Delete an entry
export function useDeleteEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ entryId, tripId }: { entryId: string; tripId: string }): Promise<void> => {
      await api.delete(`/entries/${entryId}`);
    },
    onSuccess: (_, variables) => {
      // Invalidate entries for this trip
      queryClient.invalidateQueries({ queryKey: [...ENTRIES_QUERY_KEY, variables.tripId] });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Failed to delete entry';
      Alert.alert('Error', message);
    },
  });
}
