/**
 * Photo clustering service - groups photos by location and time.
 *
 * Uses geohash for spatial clustering and time gaps for trip segmentation.
 * Uses offline country-coder library for coordinate-to-country lookups.
 */

import { iso1A2Code } from '@rapideditor/country-coder';
import * as geohash from 'ngeohash';

import type {
  CachedPhoto,
  LocationCluster,
  LocationClusterDisplay,
  PhotoWithLocation,
  TripCandidate,
  TripCandidateDisplay,
} from './types';

// Clustering configuration constants
// These are fixed values to ensure consistency between cached photos (SQLite)
// and runtime clustering. Changing these would create data consistency bugs.
const TIME_GAP_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days between trips
const GEOHASH_PRECISION = 7; // ~153m cells for location clustering
const MAX_PREVIEW_URIS = 5; // Limit preview URIs stored per candidate/cluster

/**
 * Group photos into location clusters using geohash.
 *
 * @param photos - Photos with location data
 * @param idPrefix - Optional prefix for cluster IDs (e.g., trip timestamp) to ensure uniqueness across trips
 * @returns Location clusters grouped by geohash
 */
export function clusterByLocation(
  photos: PhotoWithLocation[],
  idPrefix?: string
): LocationCluster[] {
  // Group by geohash
  const groups = new Map<string, PhotoWithLocation[]>();

  for (const photo of photos) {
    const hash = geohash.encode(
      photo.location.latitude,
      photo.location.longitude,
      GEOHASH_PRECISION
    );
    const existing = groups.get(hash) ?? [];
    existing.push(photo);
    groups.set(hash, existing);
  }

  // Convert to clusters with centroids
  return Array.from(groups.entries()).map(([hash, clusterPhotos]) => {
    const avgLat =
      clusterPhotos.reduce((sum, p) => sum + p.location.latitude, 0) / clusterPhotos.length;
    const avgLng =
      clusterPhotos.reduce((sum, p) => sum + p.location.longitude, 0) / clusterPhotos.length;
    const sorted = clusterPhotos.sort(
      (a, b) => a.creationTime.getTime() - b.creationTime.getTime()
    );

    // Use prefixed ID if provided to ensure uniqueness across trips
    const clusterId = idPrefix ? `${idPrefix}_${hash}` : hash;

    return {
      id: clusterId,
      geohash: hash,
      centroid: { latitude: avgLat, longitude: avgLng },
      photos: clusterPhotos,
      timeRange: {
        start: sorted[0].creationTime,
        end: sorted[sorted.length - 1].creationTime,
      },
    };
  });
}

/**
 * Geocode cluster centroids to get country codes using offline lookup.
 *
 * Uses @rapideditor/country-coder for instant local coordinate-to-country conversion.
 * No API calls, no permissions required.
 *
 * @param clusters - Location clusters to geocode
 * @param onProgress - Optional progress callback
 */
export function geocodeClusterCentroids(
  clusters: LocationCluster[],
  onProgress?: (completed: number, total: number) => void
): void {
  let completed = 0;
  const total = clusters.length;

  for (const cluster of clusters) {
    // country-coder takes [longitude, latitude] order
    const countryCode = iso1A2Code([cluster.centroid.longitude, cluster.centroid.latitude]);
    cluster.countryCode = countryCode ?? undefined;

    completed++;
    onProgress?.(completed, total);
  }
}

/**
 * Segment clusters into trip candidates by country and time gaps.
 *
 * @param clusters - Geocoded location clusters
 * @param homeCountryCode - User's home country to filter out
 * @returns Trip candidates grouped by country and time
 */
export function segmentTripsByTimeGap(
  clusters: LocationCluster[],
  homeCountryCode: string | null
): TripCandidate[] {
  // Filter out home country and clusters without country code
  const travelClusters = clusters.filter((c) => c.countryCode && c.countryCode !== homeCountryCode);

  if (__DEV__) {
    // Debug: count photos by country before filtering
    const photosByCountry = new Map<string, number>();
    for (const cluster of clusters) {
      const code = cluster.countryCode ?? 'unknown';
      photosByCountry.set(code, (photosByCountry.get(code) ?? 0) + cluster.photos.length);
    }
    console.log(
      '[PhotoImport] Photos by country (before home filter):',
      Object.fromEntries(photosByCountry)
    );
    console.log('[PhotoImport] Home country:', homeCountryCode);

    // Debug: count after filtering
    const travelPhotosByCountry = new Map<string, number>();
    for (const cluster of travelClusters) {
      const code = cluster.countryCode!;
      travelPhotosByCountry.set(
        code,
        (travelPhotosByCountry.get(code) ?? 0) + cluster.photos.length
      );
    }
    console.log(
      '[PhotoImport] Photos by country (after home filter):',
      Object.fromEntries(travelPhotosByCountry)
    );
  }

  // Group by country
  const byCountry = new Map<string, LocationCluster[]>();
  for (const cluster of travelClusters) {
    const code = cluster.countryCode!;
    const existing = byCountry.get(code) ?? [];
    existing.push(cluster);
    byCountry.set(code, existing);
  }

  // For each country, segment by time gaps
  const trips: TripCandidate[] = [];

  for (const [countryCode, countryClusters] of byCountry) {
    // Sort all photos across clusters by time
    const allPhotos = countryClusters.flatMap((c) => c.photos);
    const sorted = allPhotos.sort((a, b) => a.creationTime.getTime() - b.creationTime.getTime());

    let currentTrip: PhotoWithLocation[] = [];

    for (const photo of sorted) {
      if (currentTrip.length === 0) {
        currentTrip.push(photo);
      } else {
        const lastPhoto = currentTrip[currentTrip.length - 1];
        const gap = photo.creationTime.getTime() - lastPhoto.creationTime.getTime();

        // Negative gap indicates corrupted/invalid timestamps (photos should be sorted)
        // Treat as same trip to avoid splitting on bad data
        if (gap < 0) {
          currentTrip.push(photo);
        } else if (gap > TIME_GAP_THRESHOLD_MS) {
          // Save current trip, start new one
          trips.push(createTripCandidate(countryCode, currentTrip));
          currentTrip = [photo];
        } else {
          currentTrip.push(photo);
        }
      }
    }

    if (currentTrip.length > 0) {
      trips.push(createTripCandidate(countryCode, currentTrip));
    }
  }

  if (__DEV__) {
    // Debug: show final trip candidates with photo counts
    const tripSummary = trips.map((t) => ({
      country: t.countryCode,
      photos: t.photos.length,
      clusters: t.locationClusters.length,
      dates: `${t.dateRange.start.toISOString().split('T')[0]} to ${t.dateRange.end.toISOString().split('T')[0]}`,
    }));
    console.log('[PhotoImport] Trip candidates:', tripSummary);
  }

  // Sort trips by date (most recent first)
  return trips.sort((a, b) => b.dateRange.end.getTime() - a.dateRange.end.getTime());
}

/**
 * Generate a stable trip prefix from country code and start date.
 *
 * Uses year-month-day granularity to create an identifier that remains stable
 * even if the oldest photo in the trip is deleted. This prevents cluster IDs
 * from changing when photos are added/removed from the cache.
 *
 * Format: {countryCode}_{YYYYMMDD}
 * Example: "JP_20240315" for a Japan trip starting March 15, 2024
 */
function generateStableTripPrefix(countryCode: string, startDate: Date): string {
  const year = startDate.getFullYear();
  const month = String(startDate.getMonth() + 1).padStart(2, '0');
  const day = String(startDate.getDate()).padStart(2, '0');
  return `${countryCode}_${year}${month}${day}`;
}

/**
 * Create a trip candidate from a group of photos.
 */
function createTripCandidate(countryCode: string, photos: PhotoWithLocation[]): TripCandidate {
  const sorted = photos.sort((a, b) => a.creationTime.getTime() - b.creationTime.getTime());
  // Use stable prefix based on country and start date to ensure cluster IDs
  // remain consistent even if the oldest photo is deleted from the device.
  // This prevents orphaned entries in processed_clusters and cached_place_suggestions.
  const tripPrefix = generateStableTripPrefix(countryCode, sorted[0].creationTime);
  const locationClusters = clusterByLocation(photos, tripPrefix);

  return {
    id: `trip_${tripPrefix}`,
    countryCode,
    dateRange: {
      start: sorted[0].creationTime,
      end: sorted[sorted.length - 1].creationTime,
    },
    photos,
    locationClusters,
  };
}

// ============================================================================
// MEMORY-OPTIMIZED DISPLAY STRUCTURES
// These functions convert full data structures to memory-efficient versions
// that store only IDs and limited preview URIs.
// ============================================================================

/**
 * Create a photo lookup map from an array of photos.
 * This allows O(1) lookup of full photo data when needed.
 *
 * @param photos - Array of photos with location data
 * @returns Map of photo ID to full photo object
 */
export function createPhotoLookupMap(photos: PhotoWithLocation[]): Map<string, PhotoWithLocation> {
  const map = new Map<string, PhotoWithLocation>();
  for (const photo of photos) {
    map.set(photo.id, photo);
  }
  return map;
}

/**
 * Convert a LocationCluster to memory-optimized LocationClusterDisplay.
 *
 * @param cluster - Full location cluster
 * @returns Memory-optimized cluster with only IDs and limited preview URIs
 */
export function toLocationClusterDisplay(cluster: LocationCluster): LocationClusterDisplay {
  const sortedPhotos = [...cluster.photos].sort(
    (a, b) => a.creationTime.getTime() - b.creationTime.getTime()
  );

  return {
    id: cluster.id,
    geohash: cluster.geohash,
    centroid: cluster.centroid,
    photoIds: sortedPhotos.map((p) => p.id),
    photoCount: sortedPhotos.length,
    previewUris: sortedPhotos.slice(0, MAX_PREVIEW_URIS).map((p) => p.uri),
    timeRange: cluster.timeRange,
    countryCode: cluster.countryCode,
  };
}

/**
 * Convert a TripCandidate to memory-optimized TripCandidateDisplay.
 *
 * Memory savings:
 * - Full PhotoWithLocation: ~200 bytes each (id, uri, filename, date, location)
 * - Optimized: ~40 bytes per photo ID + 5 preview URIs (~500 bytes)
 * - For a trip with 200 photos: 40KB -> 8.5KB (~79% reduction)
 *
 * @param candidate - Full trip candidate
 * @returns Memory-optimized candidate with only IDs and limited preview URIs
 */
export function toTripCandidateDisplay(candidate: TripCandidate): TripCandidateDisplay {
  const sortedPhotos = [...candidate.photos].sort(
    (a, b) => a.creationTime.getTime() - b.creationTime.getTime()
  );

  return {
    id: candidate.id,
    countryCode: candidate.countryCode,
    dateRange: candidate.dateRange,
    photoIds: sortedPhotos.map((p) => p.id),
    photoCount: sortedPhotos.length,
    previewUris: sortedPhotos.slice(0, MAX_PREVIEW_URIS).map((p) => p.uri),
    locationClusterIds: candidate.locationClusters.map((c) => c.id),
  };
}

/**
 * Result of optimized trip segmentation.
 * Contains display-optimized structures plus lookup maps for full data when needed.
 */
export interface OptimizedTripData {
  /** Memory-optimized trip candidates for display */
  candidates: TripCandidateDisplay[];
  /** Lookup map: photo ID -> full PhotoWithLocation */
  photoLookup: Map<string, PhotoWithLocation>;
  /** Lookup map: cluster ID -> full LocationCluster */
  clusterLookup: Map<string, LocationCluster>;
  /** Memory-optimized clusters for display */
  clusterDisplays: Map<string, LocationClusterDisplay>;
}

/**
 * Segment trips and return memory-optimized structures.
 *
 * This is the main entry point for memory-efficient photo import.
 * It returns both optimized display structures and lookup maps
 * for retrieving full data when needed (e.g., for API calls).
 *
 * @param clusters - Geocoded location clusters
 * @param homeCountryCode - User's home country to filter out
 * @returns Optimized trip data with display structures and lookups
 */
export function segmentTripsOptimized(
  clusters: LocationCluster[],
  homeCountryCode: string | null
): OptimizedTripData {
  // Get full trip candidates using existing logic
  const fullCandidates = segmentTripsByTimeGap(clusters, homeCountryCode);

  // Build photo lookup from all photos
  const allPhotos = fullCandidates.flatMap((c) => c.photos);
  const photoLookup = createPhotoLookupMap(allPhotos);

  // Build cluster lookup from all clusters
  const clusterLookup = new Map<string, LocationCluster>();
  const clusterDisplays = new Map<string, LocationClusterDisplay>();

  for (const candidate of fullCandidates) {
    for (const cluster of candidate.locationClusters) {
      if (!clusterLookup.has(cluster.id)) {
        clusterLookup.set(cluster.id, cluster);
        clusterDisplays.set(cluster.id, toLocationClusterDisplay(cluster));
      }
    }
  }

  // Convert candidates to display format
  const candidates = fullCandidates.map(toTripCandidateDisplay);

  return {
    candidates,
    photoLookup,
    clusterLookup,
    clusterDisplays,
  };
}

/**
 * Get full photos for a cluster from the lookup map.
 *
 * @param clusterDisplay - Memory-optimized cluster
 * @param photoLookup - Photo lookup map
 * @returns Array of full photo objects
 */
export function getClusterPhotos(
  clusterDisplay: LocationClusterDisplay,
  photoLookup: Map<string, PhotoWithLocation>
): PhotoWithLocation[] {
  return clusterDisplay.photoIds
    .map((id) => photoLookup.get(id))
    .filter((p): p is PhotoWithLocation => p !== undefined);
}

/**
 * Get full location cluster from the lookup map.
 *
 * @param clusterId - Cluster ID (geohash)
 * @param clusterLookup - Cluster lookup map
 * @returns Full location cluster or undefined
 */
export function getFullCluster(
  clusterId: string,
  clusterLookup: Map<string, LocationCluster>
): LocationCluster | undefined {
  return clusterLookup.get(clusterId);
}

// ============================================================================
// CACHED PHOTO CLUSTERING
// These functions work with pre-computed cached photo data from SQLite.
// ============================================================================

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
 */
export function photoToCachedPhoto(photo: PhotoWithLocation): CachedPhoto {
  const hash = geohash.encode(photo.location.latitude, photo.location.longitude, GEOHASH_PRECISION);
  const countryCode = iso1A2Code([photo.location.longitude, photo.location.latitude]);

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

  // Convert to clusters with centroids
  return Array.from(groups.entries()).map(([hash, clusterPhotos]) => {
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
