/**
 * Photo clustering service - groups photos by location and time.
 *
 * Uses geohash for spatial clustering and time gaps for trip segmentation.
 * Uses offline country-coder library for coordinate-to-country lookups.
 */

import { iso1A2Code } from '@rapideditor/country-coder';
import * as geohash from 'ngeohash';

import type { LocationCluster, PhotoWithLocation, TimeHint, TripCandidate } from './types';

// Clustering configuration constants
// These are fixed values to ensure consistency between cached photos (SQLite)
// and runtime clustering. Changing these would create data consistency bugs.
const TIME_GAP_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days between trips
const GEOHASH_PRECISION = 7; // ~153m cells for location clustering
const DEFAULT_MERGE_THRESHOLD_M = 80; // Merge clusters whose centroids are within 80m
const GEOHASH_PREFIX_LEN = 5; // Clusters not sharing 5-char prefix are >4.9km apart
const MAX_CLUSTERS_FOR_MERGE = 200; // Safety cap: skip O(N^2) merge above this

/**
 * Calculate distance in meters between two coordinates using Haversine formula.
 * At <300m distances, haversine error is <1m vs Vincenty — well within GPS accuracy (5-15m).
 */
export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Merge clusters whose centroids are within a threshold distance.
 *
 * Uses union-find with Int32Array and iterative path compression (safe on Hermes).
 * Geohash prefix pre-filter skips haversine for pairs >4.9km apart.
 * Merged clusters have weighted centroids (by photo count), combined photos,
 * extended time ranges, and preserve the largest constituent's ID for cache stability.
 *
 * @param clusters - Location clusters to merge
 * @param thresholdMeters - Maximum centroid distance for merging
 * @returns Merged clusters
 */
export function mergeAdjacentClusters(
  clusters: LocationCluster[],
  thresholdMeters: number = DEFAULT_MERGE_THRESHOLD_M
): LocationCluster[] {
  const n = clusters.length;
  if (n <= 1) return clusters;

  // Safety cap: O(N^2) pairwise comparisons become expensive beyond 200 clusters.
  if (n > MAX_CLUSTERS_FOR_MERGE) {
    if (__DEV__) {
      console.warn(
        `[PhotoClustering] Skipping merge: ${n} clusters exceeds safety cap of ${MAX_CLUSTERS_FOR_MERGE}`
      );
    }
    return clusters;
  }

  // Union-Find with Int32Array (4 bytes/element vs 8 for regular arrays)
  const parent = new Int32Array(n);
  const size = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    parent[i] = i;
    size[i] = 1;
  }

  function find(x: number): number {
    let root = x;
    while (parent[root] !== root) root = parent[root];
    // Iterative path compression (safer than recursive on Hermes)
    while (parent[x] !== root) {
      const next = parent[x];
      parent[x] = root;
      x = next;
    }
    return root;
  }

  function union(a: number, b: number): void {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA === rootB) return;
    if (size[rootA] < size[rootB]) {
      parent[rootA] = rootB;
      size[rootB] += size[rootA];
    } else {
      parent[rootB] = rootA;
      size[rootA] += size[rootB];
    }
  }

  // Warn on 0-photo clusters (data integrity issue upstream)
  if (__DEV__) {
    for (let i = 0; i < n; i++) {
      if (clusters[i].photos.length === 0) {
        console.warn('[PhotoClustering] 0-photo cluster detected', clusters[i].id);
      }
    }
  }

  // Pairwise distance check with geohash prefix pre-filter
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (
        clusters[i].geohash.substring(0, GEOHASH_PREFIX_LEN) !==
        clusters[j].geohash.substring(0, GEOHASH_PREFIX_LEN)
      )
        continue;

      const dist = haversine(
        clusters[i].centroid.latitude,
        clusters[i].centroid.longitude,
        clusters[j].centroid.latitude,
        clusters[j].centroid.longitude
      );
      if (dist <= thresholdMeters) union(i, j);
    }
  }

  // Group by root and build merged clusters
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    const group = groups.get(root) ?? [];
    group.push(i);
    groups.set(root, group);
  }

  const merged: LocationCluster[] = [];
  for (const indices of groups.values()) {
    if (indices.length === 1) {
      merged.push(clusters[indices[0]]);
      continue;
    }

    // Weighted centroid by photo count (anchors centroid near densest cluster)
    let weightedLat = 0;
    let weightedLng = 0;
    let totalPhotos = 0;
    const allPhotos: PhotoWithLocation[] = [];
    let earliest = Infinity;
    let latest = -Infinity;

    for (const idx of indices) {
      const c = clusters[idx];
      const w = c.photos.length;
      weightedLat += c.centroid.latitude * w;
      weightedLng += c.centroid.longitude * w;
      totalPhotos += w;
      allPhotos.push(...c.photos);
      // Use timeRange from constituent clusters (works even when photos is empty)
      const s = c.timeRange.start.getTime();
      const e = c.timeRange.end.getTime();
      if (s < earliest) earliest = s;
      if (e > latest) latest = e;
    }

    // Preserve largest constituent cluster's ID for cache stability
    const largestIdx = indices.reduce((best, idx) =>
      clusters[idx].photos.length > clusters[best].photos.length ? idx : best
    );

    // Fall back to simple average of centroids when all clusters have 0 photos
    let centroidLat: number;
    let centroidLng: number;
    if (totalPhotos > 0) {
      centroidLat = weightedLat / totalPhotos;
      centroidLng = weightedLng / totalPhotos;
    } else {
      centroidLat =
        indices.reduce((sum, idx) => sum + clusters[idx].centroid.latitude, 0) / indices.length;
      centroidLng =
        indices.reduce((sum, idx) => sum + clusters[idx].centroid.longitude, 0) / indices.length;
    }

    merged.push({
      id: clusters[largestIdx].id,
      geohash: clusters[largestIdx].geohash,
      centroid: {
        latitude: centroidLat,
        longitude: centroidLng,
      },
      photos: allPhotos,
      timeRange: {
        start: new Date(earliest),
        end: new Date(latest),
      },
      countryCode: clusters[largestIdx].countryCode,
    });
  }
  return merged;
}

/**
 * Compute a time-of-day category hint from a cluster's time range.
 *
 * Priority order: dwell time > time-of-day (longer signals are stronger).
 * Used by the backend to boost matching types in ranking (soft bonus, never hard filter).
 */
export function computeTimeHint(cluster: LocationCluster): TimeHint | null {
  const startHour = cluster.timeRange.start.getHours();
  const dwellMs = cluster.timeRange.end.getTime() - cluster.timeRange.start.getTime();
  const dwellMinutes = dwellMs / (1000 * 60);

  const isMealTime = (startHour >= 11 && startHour < 15) || (startHour >= 17 && startHour < 22);
  const isLateNight = startHour >= 22 || startHour < 4;
  const isMorning = startHour >= 6 && startHour < 11;
  const isLongDwell = dwellMinutes >= 90;
  const isShortDwell = dwellMinutes < 45;

  // Priority order: dwell time > time-of-day
  if (isLongDwell) return 'attraction';
  if (isLateNight && dwellMinutes < 90) return 'nightlife';
  if (isMealTime && isShortDwell) return 'food';
  if (isMorning && isShortDwell) return 'food';
  if (isShortDwell) return 'quick_stop';
  if (isMealTime) return 'food'; // Medium dwell at meal time: leisurely meal
  return null;
}

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
  const locationClusters = mergeAdjacentClusters(clusterByLocation(photos, tripPrefix));

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
