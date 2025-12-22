/**
 * Social ingest hooks for saving places from TikTok and Instagram.
 * Handles URL processing, place detection, and saving to trips.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
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
  google_photo_url?: string | null;
}

// Request to ingest a social URL
export interface SocialIngestRequest {
  url: string;
  caption?: string;
}

// Response from social ingest (no longer includes saved_source_id)
export interface SocialIngestResponse {
  provider: SocialProvider;
  canonical_url: string;
  thumbnail_url: string | null;
  author_handle: string | null;
  title: string | null;
  detected_place: DetectedPlace | null;
}

// Request to save ingest data to a trip (includes full ingest data)
export interface SaveToTripRequest {
  trip_id: string;
  // Ingest data
  provider: SocialProvider;
  canonical_url: string;
  thumbnail_url?: string | null;
  author_handle?: string | null;
  title?: string | null;
  // User data
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

const ENTRIES_QUERY_KEY = ['entries'];

/**
 * Mutation to ingest a social media URL.
 * Fetches metadata, detects places, and returns the data without persistence.
 */
export function useSocialIngest() {
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
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Failed to process URL';
      Analytics.shareIngestFailed(message);
      // Don't show alert here - let the component handle it
    },
  });
}

/**
 * Mutation to save social ingest data to a trip as an entry.
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
