/**
 * Photo clustering service - groups photos by location and time.
 *
 * Uses geohash for spatial clustering and time gaps for trip segmentation.
 * Optimized to geocode only cluster centroids (not individual photos).
 */

import * as Location from 'expo-location';
import * as geohash from 'ngeohash';

import type {
  ClusteringConfig,
  LocationCluster,
  LocationClusterDisplay,
  PhotoWithLocation,
  TripCandidate,
  TripCandidateDisplay,
} from './types';

// Default configuration
const DEFAULT_CLUSTERING_CONFIG = {
  TIME_GAP_THRESHOLD_MS: 7 * 24 * 60 * 60 * 1000, // 7 days between trips
  GEOHASH_PRECISION: 7, // ~153m cells for location clustering
  GEOCODE_CACHE_PRECISION: 3, // ~78km for geocode deduplication
  GEOCODE_RATE_LIMIT_MS: 1000, // 1 request per second (Apple rate limit)
  MAX_CACHE_SIZE: 1000, // LRU cache max entries
  MAX_PREVIEW_URIS: 5, // Limit preview URIs stored per candidate/cluster
} as const;

// Current active configuration (can be overridden)
let CLUSTERING_CONFIG = { ...DEFAULT_CLUSTERING_CONFIG };

/**
 * Update clustering configuration.
 * Useful for adjusting precision in dense urban areas.
 *
 * @param config - Partial config to merge with defaults
 */
export function setClusteringConfig(config: Partial<ClusteringConfig>): void {
  CLUSTERING_CONFIG = {
    ...DEFAULT_CLUSTERING_CONFIG,
    ...(config.geohashPrecision !== undefined && {
      GEOHASH_PRECISION: config.geohashPrecision,
    }),
    ...(config.timeGapThresholdMs !== undefined && {
      TIME_GAP_THRESHOLD_MS: config.timeGapThresholdMs,
    }),
    ...(config.maxPreviewUris !== undefined && {
      MAX_PREVIEW_URIS: config.maxPreviewUris,
    }),
  };
}

/**
 * Reset clustering configuration to defaults.
 */
export function resetClusteringConfig(): void {
  CLUSTERING_CONFIG = { ...DEFAULT_CLUSTERING_CONFIG };
}

/**
 * Get current clustering configuration (for testing/debugging).
 */
export function getClusteringConfig(): typeof DEFAULT_CLUSTERING_CONFIG {
  return { ...CLUSTERING_CONFIG };
}

/**
 * LRU cache manager for geocode results to prevent memory leaks.
 */
class GeocodeCacheManager {
  private cache = new Map<string, string | null>();
  private readonly maxSize: number;

  constructor(maxSize = CLUSTERING_CONFIG.MAX_CACHE_SIZE) {
    this.maxSize = maxSize;
  }

  get(key: string): string | null | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key: string, value: string | null): void {
    if (this.cache.size >= this.maxSize) {
      // Remove oldest entry (first inserted)
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }

  clear(): void {
    this.cache.clear();
  }
}

// Module-level cache instance
const geocodeCache = new GeocodeCacheManager();

/**
 * Generate cache key for geocode lookup.
 */
function getCacheKey(lat: number, lng: number): string {
  // Round to ~78km precision for cache deduplication
  return geohash.encode(lat, lng, CLUSTERING_CONFIG.GEOCODE_CACHE_PRECISION);
}

/**
 * Group photos into location clusters using geohash.
 *
 * @param photos - Photos with location data
 * @returns Location clusters grouped by geohash
 */
export function clusterByLocation(photos: PhotoWithLocation[]): LocationCluster[] {
  // Group by geohash
  const groups = new Map<string, PhotoWithLocation[]>();

  for (const photo of photos) {
    const hash = geohash.encode(
      photo.location.latitude,
      photo.location.longitude,
      CLUSTERING_CONFIG.GEOHASH_PRECISION
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

    return {
      id: hash,
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
 * Geocode cluster centroids to get country codes.
 *
 * CRITICAL OPTIMIZATION: Geocode only cluster centroids, not individual photos.
 * Reduces API calls from 10,000 to ~200-500.
 *
 * @param clusters - Location clusters to geocode
 * @param onProgress - Optional progress callback
 */
export async function geocodeClusterCentroids(
  clusters: LocationCluster[],
  onProgress?: (completed: number, total: number) => void
): Promise<void> {
  // Request location permissions for reverse geocoding
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') {
    if (__DEV__) {
      console.warn('[PhotoClustering] Location permission denied - skipping geocoding');
    }
    return;
  }

  // Deduplicate by geocode cache key
  const uniqueCentroids = new Map<string, LocationCluster[]>();

  for (const cluster of clusters) {
    const key = getCacheKey(cluster.centroid.latitude, cluster.centroid.longitude);
    const existing = uniqueCentroids.get(key) ?? [];
    existing.push(cluster);
    uniqueCentroids.set(key, existing);
  }

  let completed = 0;
  const total = uniqueCentroids.size;

  for (const [cacheKey, clusterGroup] of uniqueCentroids) {
    // Check cache first
    let countryCode = geocodeCache.get(cacheKey);

    if (countryCode === undefined) {
      // Rate-limited geocode call
      try {
        const [address] = await Location.reverseGeocodeAsync(clusterGroup[0].centroid);
        countryCode = address?.isoCountryCode ?? null;
        geocodeCache.set(cacheKey, countryCode);
      } catch (error) {
        if (__DEV__) {
          console.warn('[PhotoClustering] Geocode failed:', error);
        }
        countryCode = null;
        geocodeCache.set(cacheKey, null);
      }

      // Respect rate limits (1 req/sec for Apple geocoding)
      await new Promise((r) => setTimeout(r, CLUSTERING_CONFIG.GEOCODE_RATE_LIMIT_MS));
    }

    // Apply country code to all clusters in this group
    for (const cluster of clusterGroup) {
      cluster.countryCode = countryCode ?? undefined;
    }

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

        if (gap > CLUSTERING_CONFIG.TIME_GAP_THRESHOLD_MS) {
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

  // Sort trips by date (most recent first)
  return trips.sort((a, b) => b.dateRange.end.getTime() - a.dateRange.end.getTime());
}

/**
 * Create a trip candidate from a group of photos.
 */
function createTripCandidate(countryCode: string, photos: PhotoWithLocation[]): TripCandidate {
  const sorted = photos.sort((a, b) => a.creationTime.getTime() - b.creationTime.getTime());
  const locationClusters = clusterByLocation(photos);

  return {
    id: `trip_${countryCode}_${sorted[0].creationTime.getTime()}`,
    countryCode,
    dateRange: {
      start: sorted[0].creationTime,
      end: sorted[sorted.length - 1].creationTime,
    },
    photos,
    locationClusters,
  };
}

/**
 * Clear the geocode cache. Useful for testing or memory management.
 */
export function clearGeocodeCache(): void {
  geocodeCache.clear();
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
    previewUris: sortedPhotos.slice(0, CLUSTERING_CONFIG.MAX_PREVIEW_URIS).map((p) => p.uri),
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
    previewUris: sortedPhotos.slice(0, CLUSTERING_CONFIG.MAX_PREVIEW_URIS).map((p) => p.uri),
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
