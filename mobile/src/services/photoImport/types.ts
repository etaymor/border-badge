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
}

// Progress reporting during scan
export interface ScanProgress {
  phase: 'counting' | 'scanning' | 'geocoding' | 'complete';
  current: number;
  total: number;
  percentage: number;
  /** Retry information during geocoding (only present when retrying) */
  retry?: {
    /** Current retry attempt (1-based) */
    attempt: number;
    /** Maximum retry attempts */
    maxAttempts: number;
    /** Seconds until next retry */
    delaySeconds: number;
  };
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
}

// Cluster suggestion from backend
export interface ClusterSuggestion {
  cluster_id: string;
  photo_ids: string[];
  places: PlaceSuggestion[];
}

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
  }>;
}

// Response from place suggestion API
export interface PlaceSuggestionResponse {
  suggestions: ClusterSuggestion[];
}

// Configuration for photo clustering
export interface ClusteringConfig {
  /**
   * Geohash precision for location clustering.
   * Higher = more precise (smaller cells), lower = coarser (larger cells).
   *
   * Common values:
   * - 6: ~610m cells (coarse, groups across blocks)
   * - 7: ~153m cells (default, good for most use cases)
   * - 8: ~19m cells (fine, separates restaurant from hotel across street)
   *
   * Use higher precision in dense urban areas where different venues
   * may be very close together (e.g., Tokyo, NYC).
   */
  geohashPrecision: number;
  /** Time gap (ms) that separates distinct trips (default: 7 days) */
  timeGapThresholdMs: number;
  /** Max preview URIs stored per candidate/cluster (default: 5) */
  maxPreviewUris: number;
}
