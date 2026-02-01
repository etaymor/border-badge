/**
 * Social ingest hooks for saving places from TikTok and Instagram.
 * Handles URL processing, place detection, and saving to trips.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert } from 'react-native';
import { AxiosError } from 'axios';

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
  // LLM-predicted entry type: "place", "food", "stay", "experience"
  llm_entry_type?: string | null;
}

// Request to ingest a social URL
export interface SocialIngestRequest {
  url: string;
  caption?: string;
  extraction_method?: 'auto' | 'llm' | 'regex';
}

// Country detected from location hints (when place detection fails)
export interface DetectedCountry {
  country_code: string;
  country_name: string;
  latitude: number | null;
  longitude: number | null;
}

// Trip suggested for agent-native batch save
export interface SuggestedTrip {
  id: string;
  name: string;
  country_code: string | null;
  is_system: boolean;
}

// Response from social ingest - supports multi-place extraction
export interface SocialIngestResponse {
  provider: SocialProvider;
  canonical_url: string;
  thumbnail_url: string | null;
  author_handle: string | null;
  title: string | null;
  // Multi-place extraction: array of all detected places (max 10)
  detected_places: DetectedPlace[];
  // DEPRECATED: keep for backward compat, populated with first place from detected_places
  detected_place: DetectedPlace | null;
  // Country hint even when place detection fails (for trip defaulting & autocomplete bias)
  detected_country: DetectedCountry | null;
  // Extraction metrics
  extraction_method_used?: 'llm' | 'regex' | 'none';
  extraction_source?: 'caption' | 'video_frames' | 'slideshow' | 'screenshot';
  extraction_latency_ms?: number;
  // Context location detected from content (e.g., "Thailand") - used as search bias
  context_location?: string | null;
  // Suggested trips for agent-native batch save (matching country first, then "Saved Places")
  suggested_trips?: SuggestedTrip[];
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

// A single place to save in a batch operation
export interface PlaceToSave {
  google_place_id: string | null;
  name: string;
  entry_type: EntryType;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  city: string | null;
  country: string | null;
  country_code: string | null;
  google_photo_url?: string | null;
}

// Request to save multiple places from a social post
export interface SavePlacesRequest {
  trip_id: string;
  places: PlaceToSave[];
  // Ingest data
  provider: SocialProvider;
  canonical_url: string;
  thumbnail_url?: string | null;
  author_handle?: string | null;
  title?: string | null;
  // Notes applied to all entries
  notes?: string | null;
}

// Response from batch save operation
export interface SavePlacesResponse {
  saved_count: number;
  skipped_count: number;
  saved_entry_ids: string[];
  skipped_place_names: string[];
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
 * Extract a user-friendly error message from an axios error response.
 * Handles Pydantic validation errors (422) specially to show field-level details.
 */
function getErrorMessage(error: unknown): string {
  if (error instanceof AxiosError && error.response) {
    const { status, data } = error.response;

    // Handle 422 validation errors (Pydantic)
    if (status === 422 && data?.detail) {
      // Pydantic returns errors as array of {loc, msg, type}
      if (Array.isArray(data.detail)) {
        const fieldErrors = data.detail
          .map((err: { loc?: string[]; msg?: string }) => {
            const field = err.loc?.slice(1).join('.') || 'unknown';
            return `${field}: ${err.msg || 'invalid'}`;
          })
          .join(', ');
        return `Validation error: ${fieldErrors}`;
      }
      // Handle string detail
      if (typeof data.detail === 'string') {
        return data.detail;
      }
    }

    // Handle other HTTP errors with detail message
    if (data?.detail && typeof data.detail === 'string') {
      return data.detail;
    }

    // Fallback to status text
    return `Request failed (${status})`;
  }

  // Generic error message
  return error instanceof Error ? error.message : 'Failed to save to trip';
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
      const message = getErrorMessage(error);
      Alert.alert('Error', message);
    },
  });
}

/**
 * Mutation to save multiple places from a social post to a trip.
 * Used for multi-place extraction where a single post contains multiple places.
 */
export function useSavePlaces() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: SavePlacesRequest): Promise<SavePlacesResponse> => {
      const response = await api.post('/ingest/save-places', input);
      return response.data;
    },
    onSuccess: (data, variables) => {
      // Track analytics for each saved entry
      data.saved_entry_ids.forEach((entryId) => {
        Analytics.shareSaved({
          entryId,
          tripId: variables.trip_id,
        });
      });

      // Invalidate entries for the trip
      queryClient.invalidateQueries({ queryKey: [...ENTRIES_QUERY_KEY, variables.trip_id] });

      // Invalidate trips list (entry count may have changed)
      queryClient.invalidateQueries({ queryKey: ['trips'] });
    },
    onError: (error) => {
      const message = getErrorMessage(error);
      Alert.alert('Error', message);
    },
  });
}
