/**
 * Type definitions for photo import service.
 */

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

// Trip candidate derived from clustering
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

// Place suggestion from backend
export interface PlaceSuggestion {
  place_id: string;
  name: string;
  address: string;
  location: {
    latitude: number;
    longitude: number;
  };
  category: 'food' | 'stay' | 'experience' | 'place';
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
