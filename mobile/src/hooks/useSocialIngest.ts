/**
 * Social ingest hooks for saving places from TikTok and Instagram.
 * Handles URL processing, place detection, and saving to trips.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert } from 'react-native';

import { api } from '@services/api';
import { Analytics } from '@services/analytics';
import type { EntryType, SocialProvider } from '../types/shared';

export type { EntryType, SocialProvider };

// Place detected from social media content
export interface DetectedPlace {
  google_place_id: string | null;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  city: string | null;
  country: string | null;
  country_code: string | null;
  confidence: number;
  // Google Places type information for category inference
  primary_type: string | null;
  types: string[];
}

// Request to ingest a social URL
export interface SocialIngestRequest {
  url: string;
  caption?: string;
}

// Response from social ingest
export interface SocialIngestResponse {
  saved_source_id: string;
  provider: SocialProvider;
  canonical_url: string;
  thumbnail_url: string | null;
  author_handle: string | null;
  title: string | null;
  detected_place: DetectedPlace | null;
}

// Saved source record
export interface SavedSource {
  id: string;
  user_id: string;
  provider: SocialProvider;
  original_url: string;
  canonical_url: string;
  thumbnail_url: string | null;
  author_handle: string | null;
  caption: string | null;
  title: string | null;
  entry_id: string | null;
  created_at: string;
  updated_at: string;
}

// Request to save a source to a trip
export interface SaveToTripRequest {
  saved_source_id: string;
  trip_id: string;
  place: DetectedPlace | null;
  entry_type: EntryType;
  notes?: string;
}

// Place attached to an entry
export interface EntryPlace {
  id: string;
  entry_id: string;
  google_place_id: string | null;
  place_name: string;
  lat: number | null;
  lng: number | null;
  address: string | null;
  extra_data: Record<string, unknown> | null;
}

// Media file attached to an entry
export interface EntryMediaFile {
  id: string;
  url: string;
  thumbnail_url: string | null;
  status: string;
}

// Response from saving to trip - matches backend EntryWithPlace
export interface SaveToTripResponse {
  id: string;
  trip_id: string;
  type: EntryType;
  title: string;
  notes: string | null;
  link: string | null;
  metadata: Record<string, unknown> | null;
  date: string | null;
  created_at: string;
  deleted_at: string | null;
  place: EntryPlace | null;
  media_files: EntryMediaFile[];
}

const SAVED_SOURCES_QUERY_KEY = ['saved_sources'];
const ENTRIES_QUERY_KEY = ['entries'];

/**
 * Mutation to ingest a social media URL.
 * Fetches metadata, detects places, and creates a saved_source record.
 */
export function useSocialIngest() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: SocialIngestRequest): Promise<SocialIngestResponse> => {
      const response = await api.post('/ingest/social', input);
      return response.data;
    },
    onSuccess: (data) => {
      // Track analytics
      Analytics.shareIngested({
        provider: data.provider,
        hasPlace: !!data.detected_place,
        confidence: data.detected_place?.confidence ?? 0,
      });

      // Invalidate saved sources list
      queryClient.invalidateQueries({ queryKey: SAVED_SOURCES_QUERY_KEY });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Failed to process URL';
      Analytics.shareIngestFailed(message);
      // Don't show alert here - let the component handle it
    },
  });
}

/**
 * Mutation to save a social source to a trip as an entry.
 */
export function useSaveToTrip() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: SaveToTripRequest): Promise<SaveToTripResponse> => {
      const response = await api.post('/ingest/save-to-trip', input);
      return response.data;
    },
    onSuccess: (data) => {
      // Track analytics
      Analytics.shareSaved({
        entryId: data.id,
        tripId: data.trip_id,
      });

      // Invalidate saved sources (now has entry_id linked)
      queryClient.invalidateQueries({ queryKey: SAVED_SOURCES_QUERY_KEY });

      // Invalidate entries for the trip
      queryClient.invalidateQueries({ queryKey: [...ENTRIES_QUERY_KEY, data.trip_id] });

      // Invalidate trips list (entry count may have changed)
      queryClient.invalidateQueries({ queryKey: ['trips'] });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Failed to save to trip';
      Alert.alert('Error', message);
    },
  });
}

/**
 * Query to fetch saved sources that haven't been linked to entries yet.
 */
export function useSavedSources(unlinkedOnly = true) {
  return useQuery({
    queryKey: [...SAVED_SOURCES_QUERY_KEY, { unlinkedOnly }],
    queryFn: async (): Promise<SavedSource[]> => {
      const params = new URLSearchParams();
      if (unlinkedOnly) {
        params.append('unlinked_only', 'true');
      }
      const response = await api.get(`/ingest/saved-sources?${params.toString()}`);
      return response.data;
    },
  });
}

/**
 * Mutation to delete a saved source.
 */
export function useDeleteSavedSource() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (sourceId: string): Promise<void> => {
      await api.delete(`/ingest/saved-sources/${sourceId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SAVED_SOURCES_QUERY_KEY });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Failed to delete';
      Alert.alert('Error', message);
    },
  });
}
