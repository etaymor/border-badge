/**
 * Photo clustering cache - bridges SQLite cached photos with the clustering pipeline.
 *
 * Works with pre-computed cached photo data from SQLite, avoiding redundant
 * geohash and country code computation on subsequent imports.
 */

import { iso1A2Code } from '@rapideditor/country-coder';
import * as geohash from 'ngeohash';

import type { CachedPhoto, LocationCluster, PhotoWithLocation } from './types';
import { mergeAdjacentClusters } from './photoClustering';
import { segmentTripsOptimized, type OptimizedTripData } from './photoClusteringDisplay';

const GEOHASH_PRECISION = 7; // ~153m cells for location clustering

/**
 * Convert a CachedPhoto to PhotoWithLocation for use with existing clustering functions.
 */
function cachedPhotoToPhotoWithLocation(cached: CachedPhoto): PhotoWithLocation {
  return {
    id: cached.id,
    uri: cached.uri,
    filename: cached.filename,
    creationTime: new Date(cached.creationTime),
    location: {
      latitude: cached.latitude,
      longitude: cached.longitude,
    },
  };
}

/**
 * Convert PhotoWithLocation to CachedPhoto for storage.
 * Computes geohash and country code for caching.
 *
 * @param photo - Photo with location data
 * @param precomputedCountryCode - Optional pre-computed country code to avoid redundant iso1A2Code lookup
 */
export function photoToCachedPhoto(
  photo: PhotoWithLocation,
  precomputedCountryCode?: string | null
): CachedPhoto {
  const hash = geohash.encode(photo.location.latitude, photo.location.longitude, GEOHASH_PRECISION);
  const countryCode =
    precomputedCountryCode !== undefined
      ? precomputedCountryCode
      : (iso1A2Code([photo.location.longitude, photo.location.latitude], {
          level: 'territory',
        }) ?? null);

  return {
    id: photo.id,
    uri: photo.uri,
    filename: photo.filename,
    creationTime: photo.creationTime.getTime(),
    latitude: photo.location.latitude,
    longitude: photo.location.longitude,
    geohash: hash,
    countryCode: countryCode ?? null,
  };
}

/**
 * Build location clusters from cached photos.
 *
 * Unlike clusterByLocation(), this uses the precomputed geohash and country code
 * from the cache, avoiding recomputation.
 *
 * @param cachedPhotos - Photos loaded from cache
 * @param idPrefix - Optional prefix for cluster IDs (e.g., trip timestamp) to ensure uniqueness across trips
 * @returns Location clusters with country codes already set
 */
export function clusterFromCachedPhotos(
  cachedPhotos: CachedPhoto[],
  idPrefix?: string
): LocationCluster[] {
  // Group by precomputed geohash
  const groups = new Map<string, CachedPhoto[]>();

  for (const photo of cachedPhotos) {
    const existing = groups.get(photo.geohash) ?? [];
    existing.push(photo);
    groups.set(photo.geohash, existing);
  }

  // Convert to clusters with centroids, then merge adjacent clusters
  const rawClusters = Array.from(groups.entries()).map(([hash, clusterPhotos]) => {
    const avgLat = clusterPhotos.reduce((sum, p) => sum + p.latitude, 0) / clusterPhotos.length;
    const avgLng = clusterPhotos.reduce((sum, p) => sum + p.longitude, 0) / clusterPhotos.length;
    const sorted = [...clusterPhotos].sort((a, b) => a.creationTime - b.creationTime);

    // Convert cached photos to PhotoWithLocation for the cluster
    const photos = clusterPhotos.map(cachedPhotoToPhotoWithLocation);

    // Use the country code from the first photo (all photos in cluster should have same country)
    const countryCode = clusterPhotos[0].countryCode ?? undefined;

    // Use prefixed ID if provided to ensure uniqueness across trips
    const clusterId = idPrefix ? `${idPrefix}_${hash}` : hash;

    return {
      id: clusterId,
      geohash: hash,
      centroid: { latitude: avgLat, longitude: avgLng },
      photos,
      timeRange: {
        start: new Date(sorted[0].creationTime),
        end: new Date(sorted[sorted.length - 1].creationTime),
      },
      countryCode,
    };
  });
  return mergeAdjacentClusters(rawClusters);
}

/**
 * Segment trips from cached photos and return memory-optimized structures.
 *
 * This is the main entry point for processing cached photo data.
 * It skips the geocoding step since country codes are already cached.
 *
 * @param cachedPhotos - Photos loaded from cache
 * @param homeCountryCode - User's home country to filter out
 * @returns Optimized trip data with display structures and lookups
 */
export function segmentTripsFromCache(
  cachedPhotos: CachedPhoto[],
  homeCountryCode: string | null
): OptimizedTripData {
  // Build clusters from cached data (no geocoding needed)
  const clusters = clusterFromCachedPhotos(cachedPhotos);

  // Use existing segmentation logic
  return segmentTripsOptimized(clusters, homeCountryCode);
}
