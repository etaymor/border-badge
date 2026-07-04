/**
 * Photo clustering service - groups photos by location using geohash.
 *
 * Uses geohash for spatial clustering and offline country-coder for geocoding.
 * Trip segmentation logic lives in photoClusteringTrips.ts.
 */

import * as geohash from 'ngeohash';

import { iso1A2Code } from './countryCoder';
import type { LocationCluster, PhotoWithLocation, TimeHint } from './types';

// Clustering configuration constants
// These are fixed values to ensure consistency between cached photos (SQLite)
// and runtime clustering. Changing these would create data consistency bugs.
export const GEOHASH_PRECISION = 7; // ~153m cells for location clustering
// Merge threshold: consolidates a single venue whose photos straddle a cell
// boundary (the two halves' weighted centroids sit near the venue, well under
// 40m apart). 40m rather than 80m so two DISTINCT venues 50-150m apart in
// adjacent cells stay separate clusters — merging them made the smaller venue
// unrecallable (one blended centroid, one suggestion list for two places).
const DEFAULT_MERGE_THRESHOLD_M = 40;
const GEOHASH_PREFIX_LEN = 5; // Clusters not sharing 5-char prefix are >4.9km apart
const MAX_CLUSTERS_FOR_MERGE = 200; // Safety cap: skip O(N^2) merge above this

// Multi-venue cell splitting: a ~153m geohash-7 cell can hold several distinct
// venues (restaurant + bar 60m apart), which used to force-merge into one
// cluster with a centroid at neither. Photos within a cell are sub-grouped at
// precision 8 (~38m cells) and sub-groups re-merge only when their centroids
// are within SUBCLUSTER_MERGE_THRESHOLD_M — so one venue's GPS spread stays a
// single cluster while genuinely separate venues split.
export const SUBCLUSTER_PRECISION = 8;
export const SUBCLUSTER_MERGE_THRESHOLD_M = 40;
// Suffix for automatic venue-split siblings (the largest sub-group keeps the
// parent ID so processed/hidden state and cached suggestions stay attached).
// Distinct from the manual-split suffix (`__split_`) in photoClusteringDisplay.
export const VENUE_SPLIT_ID_SEPARATOR = '__venue_';

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
 * Split one geohash-cell photo group into per-venue sub-groups.
 *
 * Photos are sub-grouped by precision-8 geohash, then sub-groups whose
 * centroids sit within SUBCLUSTER_MERGE_THRESHOLD_M are transitively
 * re-merged (one venue's GPS spread across sub-cells stays together).
 * Returns sub-groups largest-first; a single-venue group returns `[photos]`
 * unchanged, so the common case produces identical clusters to before.
 */
export function splitMultiVenueGroup<T>(
  photos: T[],
  getPoint: (photo: T) => { latitude: number; longitude: number }
): T[][] {
  if (photos.length < 2) return [photos];

  const subGroups = new Map<string, T[]>();
  for (const photo of photos) {
    const point = getPoint(photo);
    const hash = geohash.encode(point.latitude, point.longitude, SUBCLUSTER_PRECISION);
    const existing = subGroups.get(hash) ?? [];
    existing.push(photo);
    subGroups.set(hash, existing);
  }
  if (subGroups.size <= 1) return [photos];

  // Deterministic order independent of photo insertion order.
  const entries = Array.from(subGroups.entries()).sort(([a], [b]) => (a < b ? -1 : 1));
  const centroids = entries.map(([, group]) => {
    let lat = 0;
    let lng = 0;
    for (const photo of group) {
      const point = getPoint(photo);
      lat += point.latitude;
      lng += point.longitude;
    }
    return { latitude: lat / group.length, longitude: lng / group.length };
  });

  // Transitive merge of nearby sub-cells (tiny N: a geohash-7 cell holds at
  // most 32 precision-8 sub-cells).
  const parent = entries.map((_, i) => i);
  const find = (x: number): number => {
    let root = x;
    while (parent[root] !== root) root = parent[root];
    while (parent[x] !== root) {
      const next = parent[x];
      parent[x] = root;
      x = next;
    }
    return root;
  };
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const dist = haversine(
        centroids[i].latitude,
        centroids[i].longitude,
        centroids[j].latitude,
        centroids[j].longitude
      );
      if (dist <= SUBCLUSTER_MERGE_THRESHOLD_M) {
        const rootI = find(i);
        const rootJ = find(j);
        if (rootI !== rootJ) parent[rootJ] = rootI;
      }
    }
  }

  const groupsByRoot = new Map<number, T[]>();
  entries.forEach(([, group], i) => {
    const root = find(i);
    const existing = groupsByRoot.get(root) ?? [];
    existing.push(...group);
    groupsByRoot.set(root, existing);
  });

  const result = Array.from(groupsByRoot.values());
  if (result.length === 1) return [photos];
  // Largest first (stable: equal sizes keep deterministic sub-hash order).
  result.sort((a, b) => b.length - a.length);
  return result;
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
      // Same full geohash = deliberate venue-split siblings from the same
      // cell (splitMultiVenueGroup); never re-merge them.
      if (clusters[i].geohash === clusters[j].geohash) continue;
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

  // Convert to clusters with centroids, splitting multi-venue cells
  const clusters: LocationCluster[] = [];
  for (const [hash, cellPhotos] of groups.entries()) {
    const venueGroups = splitMultiVenueGroup(cellPhotos, (p) => p.location);
    const baseId = idPrefix ? `${idPrefix}_${hash}` : hash;

    venueGroups.forEach((venuePhotos, index) => {
      const avgLat =
        venuePhotos.reduce((sum, p) => sum + p.location.latitude, 0) / venuePhotos.length;
      const avgLng =
        venuePhotos.reduce((sum, p) => sum + p.location.longitude, 0) / venuePhotos.length;
      const sorted = [...venuePhotos].sort(
        (a, b) => a.creationTime.getTime() - b.creationTime.getTime()
      );

      clusters.push({
        // Largest venue group keeps the parent ID (cache/processed-state
        // stability); extra venues get a deterministic suffix.
        id: index === 0 ? baseId : `${baseId}${VENUE_SPLIT_ID_SEPARATOR}${index + 1}`,
        geohash: hash,
        centroid: { latitude: avgLat, longitude: avgLng },
        photos: sorted,
        timeRange: {
          start: sorted[0].creationTime,
          end: sorted[sorted.length - 1].creationTime,
        },
      });
    });
  }
  return clusters;
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
    // country-coder takes [longitude, latitude] order.
    // level: 'territory' so HK/MO/PR/etc. resolve to themselves, not their parent country.
    const countryCode = iso1A2Code([cluster.centroid.longitude, cluster.centroid.latitude], {
      level: 'territory',
    });
    cluster.countryCode = countryCode ?? undefined;

    completed++;
    onProgress?.(completed, total);
  }
}
