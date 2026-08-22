/**
 * Photo clustering cache - bridges SQLite cached photos with the clustering pipeline.
 *
 * Works with pre-computed cached photo data from SQLite, avoiding redundant
 * geohash and country code computation on subsequent imports.
 */

import * as geohash from 'ngeohash';

import { features } from '@config/features';
import { rankBestPhotos } from '@services/photoSignals/bestPhotos';

import { iso1A2Code } from './countryCoder';
import { getIntentTagsForIds, getTagsForIds } from './photoTagDb';
import type {
  CachedPhoto,
  LocationCluster,
  PhotoWithLocation,
  TripCandidateDisplay,
} from './types';
import {
  mergeAdjacentClusters,
  splitMultiVenueGroup,
  VENUE_SPLIT_ID_SEPARATOR,
} from './photoClustering';
import {
  MAX_PREVIEW_URIS,
  segmentTripsOptimized,
  type OptimizedTripData,
} from './photoClusteringDisplay';

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
    // U5/R7: carried through so vision preparation can skip the probe decode.
    width: cached.width,
    height: cached.height,
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
    width: photo.width,
    height: photo.height,
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

  // Convert to clusters with centroids (splitting multi-venue cells the same
  // way as clusterByLocation), then merge adjacent clusters
  const rawClusters: LocationCluster[] = [];
  for (const [hash, cellPhotos] of groups.entries()) {
    const venueGroups = splitMultiVenueGroup(cellPhotos, (p) => ({
      latitude: p.latitude,
      longitude: p.longitude,
    }));
    const baseId = idPrefix ? `${idPrefix}_${hash}` : hash;

    venueGroups.forEach((venuePhotos, index) => {
      const avgLat = venuePhotos.reduce((sum, p) => sum + p.latitude, 0) / venuePhotos.length;
      const avgLng = venuePhotos.reduce((sum, p) => sum + p.longitude, 0) / venuePhotos.length;
      const sorted = [...venuePhotos].sort((a, b) => a.creationTime - b.creationTime);

      // Convert cached photos to PhotoWithLocation for the cluster
      const photos = sorted.map(cachedPhotoToPhotoWithLocation);

      // Use the country code from the first photo (all photos in cluster should have same country)
      const countryCode = venuePhotos[0].countryCode ?? undefined;

      rawClusters.push({
        // Largest venue group keeps the parent ID; extra venues get a suffix
        // (mirrors clusterByLocation).
        id: index === 0 ? baseId : `${baseId}${VENUE_SPLIT_ID_SEPARATOR}${index + 1}`,
        geohash: hash,
        centroid: { latitude: avgLat, longitude: avgLng },
        photos,
        timeRange: {
          start: new Date(sorted[0].creationTime),
          end: new Date(sorted[sorted.length - 1].creationTime),
        },
        countryCode,
      });
    });
  }
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

/**
 * Rewrite each trip segment's preview strip to pick the BEST photos of the
 * segment instead of the chronologically first ones (plan 2026-08-21-001,
 * step 3c target 1). Quality comes from `rankBestPhotos`: screenshots/utility
 * images excluded, near-duplicate runs collapsed to their best frame,
 * remainder ordered by composite quality.
 *
 * Scope is deliberately the CANDIDATE previews only (Photo Trips cards,
 * `cached_trip_segments.preview_uris`, callouts) — display-only strips.
 * Cluster previews are NOT touched: they feed the gallery, the upload
 * selection pool, and "Split here", where chronological order is load-bearing.
 *
 * `previewAssetIds[i]` stays the asset for `previewUris[i]` — both arrays are
 * rebuilt from the same ranked list.
 *
 * Degrades to the input unchanged when either quality flag is off or the tag
 * read fails; an untagged library still gets duplicate collapse, which is part
 * of the flagged behavior change.
 */
/**
 * Cap on photos ranked (and tag rows read) per segment. Without it, a scan's
 * preview pass reads and JSON-parses tag rows for effectively the whole
 * library just to build 30-item strips. Sampling is EVENLY SPACED through the
 * segment's chronology - a plain prefix would bias every strip toward the
 * start of the trip.
 */
const PREVIEW_RANK_POOL_MAX = 300;

function sampleEvenly<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  const step = items.length / max;
  const sampled: T[] = [];
  for (let i = 0; i < max; i++) sampled.push(items[Math.floor(i * step)]);
  return sampled;
}

export async function rankTripSegmentPreviews(
  candidates: TripCandidateDisplay[],
  photoLookup: Map<string, PhotoWithLocation>
): Promise<TripCandidateDisplay[]> {
  if (!features.enableQualityRanking || !features.enableIntentSignals) return candidates;
  if (candidates.length === 0) return candidates;

  try {
    const sampledIds = new Map(
      candidates.map((c) => [c.id, sampleEvenly(c.photoIds, PREVIEW_RANK_POOL_MAX)])
    );
    const allIds = [...new Set([...sampledIds.values()].flat())];
    const [mlTags, intentTags] = await Promise.all([
      getTagsForIds(allIds),
      getIntentTagsForIds(allIds),
    ]);

    return candidates.map((candidate) => {
      // Rank over a bounded, evenly-spread sample of the segment (not just the
      // current preview slice) so "best" still means best of the whole trip.
      const pool = (sampledIds.get(candidate.id) ?? [])
        .map((id) => photoLookup.get(id))
        .filter((p): p is PhotoWithLocation => p !== undefined);
      if (pool.length < 2) return candidate;

      const ranked = rankBestPhotos(
        pool.map((p) => ({
          id: p.id,
          uri: p.uri,
          creationTime: p.creationTime.getTime(),
          latitude: p.location.latitude,
          longitude: p.location.longitude,
          // Segments are per-country, so the candidate's code holds for
          // every photo (PhotoWithLocation itself doesn't carry one).
          countryCode: candidate.countryCode,
          width: p.width,
          height: p.height,
        })),
        { mlTags, intentTags, limit: MAX_PREVIEW_URIS }
      );

      return {
        ...candidate,
        previewUris: ranked.map((p) => p.uri),
        previewAssetIds: ranked.map((p) => p.id),
      };
    });
  } catch {
    // Tag read failed (fresh install, DB migration in flight): previews keep
    // their chronological order — never fail the scan over curation.
    return candidates;
  }
}
