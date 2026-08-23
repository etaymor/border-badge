/**
 * Photo clustering display structures - memory-optimized versions of cluster data.
 *
 * Converts full data structures to memory-efficient versions that store only
 * IDs and limited preview URIs. Also provides lookup helpers and cluster splitting.
 */

import type {
  LocationCluster,
  LocationClusterDisplay,
  PhotoWithLocation,
  TripCandidate,
  TripCandidateDisplay,
} from './types';
import { segmentTripsByTimeGap } from './photoClusteringTrips';

// Limit preview URIs stored per candidate/cluster (selection pool for upload).
// Exported for the best-first preview reranker in photoClusteringCache.
export const MAX_PREVIEW_URIS = 30;

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
    // Same slice as previewUris so previewAssetIds[i] is the asset for previewUris[i].
    previewAssetIds: sortedPhotos.slice(0, MAX_PREVIEW_URIS).map((p) => p.id),
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
    // Same slice as previewUris so previewAssetIds[i] is the asset for previewUris[i].
    previewAssetIds: sortedPhotos.slice(0, MAX_PREVIEW_URIS).map((p) => p.id),
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
 * Create a sub-cluster from a subset of a parent cluster's photos.
 *
 * Used for manual cluster splitting when photos from multiple places
 * are grouped into one cluster. Preserves the parent cluster's centroid
 * so the backend searches the same area and returns the same place
 * candidates — only the time range and photo set change.
 *
 * @param parentCluster - The original cluster to split from
 * @param photoIds - IDs of the photos to include in the sub-cluster
 * @param suffix - Suffix for the sub-cluster ID (e.g., "a" or "b")
 * @returns A new LocationCluster containing only the specified photos
 */
export function createSubCluster(
  parentCluster: LocationCluster,
  photoIds: Set<string>,
  suffix: string
): LocationCluster {
  const photos = parentCluster.photos.filter((p) => photoIds.has(p.id));
  if (photos.length === 0) {
    throw new Error('No matching photos found for sub-cluster');
  }

  const sorted = [...photos].sort((a, b) => a.creationTime.getTime() - b.creationTime.getTime());

  return {
    id: `${parentCluster.id}__split_${suffix}`,
    geohash: parentCluster.geohash,
    centroid: parentCluster.centroid,
    photos,
    timeRange: {
      start: sorted[0].creationTime,
      end: sorted[sorted.length - 1].creationTime,
    },
    countryCode: parentCluster.countryCode,
  };
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

/**
 * Build a sub-cluster from a parent and an explicit sub-cluster ID. Used at
 * load time to reconstruct a persisted split: the ID was decided when the
 * user originally split, and we faithfully restore it. Returns null when
 * none of the recorded photo IDs are present in the parent (e.g. those
 * photos were removed from the device library since the split).
 */
function buildSubClusterFromPersisted(
  parent: LocationCluster,
  subId: string,
  photoIds: string[]
): LocationCluster | null {
  const ids = new Set(photoIds);
  const photos = parent.photos.filter((p) => ids.has(p.id));
  if (photos.length === 0) return null;
  const sorted = [...photos].sort((a, b) => a.creationTime.getTime() - b.creationTime.getTime());
  return {
    id: subId,
    geohash: parent.geohash,
    centroid: parent.centroid,
    photos,
    timeRange: {
      start: sorted[0].creationTime,
      end: sorted[sorted.length - 1].creationTime,
    },
    countryCode: parent.countryCode,
  };
}

/**
 * Persisted split row shape used at load time. Mirrors
 * `ClusterSplitRow` from photoCacheDbSuggestions but redeclared here to keep
 * this module independent of the DB layer.
 */
export interface PersistedClusterSplit {
  subClusterId: string;
  parentClusterId: string;
  photoIds: string[];
}

/**
 * Apply persisted splits to freshly segmented trip data. For each parent ID
 * that has split rows, replace the parent in every candidate's
 * `locationClusterIds` with its sub-cluster IDs and add the sub-clusters to
 * the lookup maps. The parent stays in the cluster lookup (older
 * `processed_clusters` rows may still reference it) but is removed from any
 * candidate so it never renders.
 *
 * Pure: returns new maps and candidate objects without mutating inputs.
 */
export function applyPersistedSplits(
  data: OptimizedTripData,
  splitsByParent: Map<string, PersistedClusterSplit[]>
): OptimizedTripData {
  if (splitsByParent.size === 0) return data;

  const clusterLookup = new Map(data.clusterLookup);
  const clusterDisplays = new Map(data.clusterDisplays);

  // Materialize each split's sub-clusters once; reused below to rewrite candidate IDs.
  const subIdsByParent = new Map<string, string[]>();
  for (const [parentId, splits] of splitsByParent) {
    const parent = clusterLookup.get(parentId);
    if (!parent) continue;
    const subIds: string[] = [];
    for (const split of splits) {
      const sub = buildSubClusterFromPersisted(parent, split.subClusterId, split.photoIds);
      if (!sub) continue;
      clusterLookup.set(sub.id, sub);
      clusterDisplays.set(sub.id, toLocationClusterDisplay(sub));
      subIds.push(sub.id);
    }
    if (subIds.length > 0) {
      subIdsByParent.set(parentId, subIds);
    }
  }

  if (subIdsByParent.size === 0) {
    return { ...data, clusterLookup, clusterDisplays };
  }

  const candidates = data.candidates.map((candidate) => {
    let touched = false;
    const newIds: string[] = [];
    for (const id of candidate.locationClusterIds) {
      const subs = subIdsByParent.get(id);
      if (subs) {
        newIds.push(...subs);
        touched = true;
      } else {
        newIds.push(id);
      }
    }
    return touched ? { ...candidate, locationClusterIds: newIds } : candidate;
  });

  return { ...data, candidates, clusterLookup, clusterDisplays };
}

/**
 * Filter every cluster's photos against the saved-photo set. Clusters whose
 * photos are entirely saved end up empty; they're returned via
 * `autoDismissed` so the workflow can hide them in addition to the
 * persisted dismissal set. Non-empty clusters get fresh display objects with
 * the saved photos removed so the UI doesn't offer the user re-uploads.
 */
export function applySavedPhotoFilter(
  data: OptimizedTripData,
  savedPhotoIds: Set<string>
): { data: OptimizedTripData; autoDismissed: Set<string> } {
  const autoDismissed = new Set<string>();
  if (savedPhotoIds.size === 0) {
    return { data, autoDismissed };
  }

  const clusterLookup = new Map(data.clusterLookup);
  const clusterDisplays = new Map(data.clusterDisplays);

  for (const [id, cluster] of data.clusterLookup) {
    const remaining = cluster.photos.filter((p) => !savedPhotoIds.has(p.id));
    if (remaining.length === cluster.photos.length) continue;
    if (remaining.length === 0) {
      autoDismissed.add(id);
      continue;
    }
    const sorted = [...remaining].sort(
      (a, b) => a.creationTime.getTime() - b.creationTime.getTime()
    );
    const filtered: LocationCluster = {
      ...cluster,
      photos: remaining,
      timeRange: {
        start: sorted[0].creationTime,
        end: sorted[sorted.length - 1].creationTime,
      },
    };
    clusterLookup.set(id, filtered);
    clusterDisplays.set(id, toLocationClusterDisplay(filtered));
  }

  return {
    data: { ...data, clusterLookup, clusterDisplays },
    autoDismissed,
  };
}
