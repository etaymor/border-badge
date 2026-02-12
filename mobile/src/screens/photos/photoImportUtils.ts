/**
 * Utility functions for the photo import workflow.
 */

import { computeTimeHint, type LocationCluster } from '@services/photoImport';

/**
 * Type guard for AbortError.
 * Uses name-based check for React Native compatibility (no DOMException).
 */
export function isAbortError(error: unknown): error is Error {
  return (
    error !== null &&
    typeof error === 'object' &&
    'name' in error &&
    (error as Error).name === 'AbortError'
  );
}

/**
 * Create an AbortError compatible with React Native.
 * Standard Error with name set to 'AbortError' for isAbortError detection.
 */
export function createAbortError(message: string): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

/**
 * Truncate coordinate to 5 decimal places (~1.1m precision) for PII protection.
 * Matches backend cache precision in place_matcher/cache.py.
 */
export const truncateCoordinate = (value: number): number => Math.round(value * 100000) / 100000;

/**
 * Map a location cluster and its prepared vision images to the API request format.
 * Extracted from usePlaceSuggestions for testability.
 */
export function mapClusterToApiPayload(cluster: LocationCluster, visionImages: string[]) {
  return {
    id: cluster.id,
    centroid: {
      latitude: truncateCoordinate(cluster.centroid.latitude),
      longitude: truncateCoordinate(cluster.centroid.longitude),
    },
    photos: cluster.photos.map((p) => ({
      asset_id: p.id,
      latitude: truncateCoordinate(p.location.latitude),
      longitude: truncateCoordinate(p.location.longitude),
      timestamp: p.creationTime.toISOString(),
    })),
    start_time: cluster.timeRange.start.toISOString(),
    end_time: cluster.timeRange.end.toISOString(),
    time_hint: computeTimeHint(cluster),
    vision_images_base64: visionImages.length > 0 ? visionImages : undefined,
  };
}
