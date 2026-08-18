/**
 * Type definitions for photo import service.
 */

import type { EntryType } from '../../types/shared';

// Photo with GPS location data
export interface PhotoWithLocation {
  id: string;
  uri: string;
  filename: string;
  creationTime: Date;
  location: {
    latitude: number;
    longitude: number;
  };
  /**
   * Pixel dimensions, captured during the library scan and persisted on the
   * photo cache (U5/R7). Vision preparation needs them only to decide whether
   * the image is above the 768px cap; carrying them here removes a second
   * decode of every representative photo. Undefined for rows cached before the
   * migration — preparation falls back to probing the file in that case.
   */
  width?: number;
  height?: number;
}

// Country discovered during photo scanning
export interface DiscoveredCountry {
  code: string;
  name: string;
}

// Progress reporting during scan
export interface ScanProgress {
  phase: 'counting' | 'scanning' | 'geocoding' | 'complete';
  current: number;
  total: number;
  percentage: number;
  /** Number of photos found with GPS data (only populated during scanning phase) */
  gpsPhotoCount?: number;
  /** Countries discovered so far during scanning (for live discovery feed) */
  discoveredCountries?: DiscoveredCountry[];
}

// Location cluster from geohash grouping
export interface LocationCluster {
  id: string;
  geohash: string;
  centroid: {
    latitude: number;
    longitude: number;
  };
  photos: PhotoWithLocation[];
  timeRange: {
    start: Date;
    end: Date;
  };
  countryCode?: string;
}

// Trip candidate derived from clustering (full data - used internally during processing)
export interface TripCandidate {
  id: string;
  countryCode: string;
  dateRange: {
    start: Date;
    end: Date;
  };
  photos: PhotoWithLocation[];
  locationClusters: LocationCluster[];
}

// Memory-optimized trip candidate for display (stores IDs instead of full objects)
// Reduces memory by ~75% for large photo libraries
export interface TripCandidateDisplay {
  id: string;
  countryCode: string;
  dateRange: {
    start: Date;
    end: Date;
  };
  photoIds: string[]; // Reference by ID instead of full object
  photoCount: number; // Total count (since we limit stored IDs)
  previewUris: string[]; // First 5 URIs for thumbnail display
  previewAssetIds: string[]; // Asset IDs positionally aligned with previewUris (for on-error re-resolve)
  locationClusterIds: string[]; // Reference clusters by geohash ID
}

// Memory-optimized location cluster for display
export interface LocationClusterDisplay {
  id: string;
  geohash: string;
  centroid: {
    latitude: number;
    longitude: number;
  };
  photoIds: string[]; // Reference by ID instead of full object
  photoCount: number;
  previewUris: string[]; // First 5 URIs for thumbnails
  previewAssetIds: string[]; // Asset IDs positionally aligned with previewUris (for on-error re-resolve)
  timeRange: {
    start: Date;
    end: Date;
  };
  countryCode?: string;
}

// Place suggestion from backend
export interface PlaceSuggestion {
  place_id: string;
  name: string;
  address: string;
  location: {
    latitude: number;
    longitude: number;
  };
  category: EntryType;
  distance_m: number;
  types: string[];
  vision_category?: string | null;
}

// Cluster suggestion from backend
export interface ClusterSuggestion {
  cluster_id: string;
  photo_ids: string[];
  places: PlaceSuggestion[];
}

// Time-of-day category hint for place matching
export type TimeHint = 'food' | 'attraction' | 'nightlife' | 'quick_stop';

// Request body for place suggestion API
export interface PlaceSuggestionRequest {
  clusters: Array<{
    id: string;
    centroid: {
      latitude: number;
      longitude: number;
    };
    photos: Array<{
      asset_id: string;
      latitude: number;
      longitude: number;
      timestamp?: string;
    }>;
    start_time?: string;
    end_time?: string;
    time_hint?: TimeHint | null;
    vision_images_base64?: string[] | null;
  }>;
}

// Response from place suggestion API
export interface PlaceSuggestionResponse {
  suggestions: ClusterSuggestion[];
  failed_cluster_count: number; // Clusters that timed out or failed to process
}

// Cached photo metadata stored in SQLite
export interface CachedPhoto {
  id: string; // Asset ID from MediaLibrary
  uri: string;
  filename: string;
  creationTime: number; // Unix timestamp (ms)
  latitude: number;
  longitude: number;
  geohash: string; // Precomputed geohash (precision 7)
  countryCode: string | null; // Precomputed ISO 3166-1 alpha-2
  /** Pixel width, when known (U5/R7). Undefined for rows predating the migration. */
  width?: number;
  /** Pixel height, when known (U5/R7). Undefined for rows predating the migration. */
  height?: number;
}
