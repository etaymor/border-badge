/**
 * Photo cache - processed clusters, candidate selection, and place suggestions.
 *
 * Extracted from photoCacheDb.ts to keep modules focused and under 500 lines.
 * All functions share the same SQLite database via getDb().
 */

import * as geohash from 'ngeohash';

import { getDb, getMetadata, setMetadata, SQLITE_PARAM_LIMIT } from './photoCacheDb';
import { GEOHASH_PRECISION } from './photoClustering';

/** Empty suggestions expire after 24 hours so transient failures get retried. */
const EMPTY_SUGGESTION_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Compute the location cache key for a cluster centroid. Stable across cluster-id
 * changes (splits, re-segmentation) for the same physical location, so a
 * re-segmented cluster at the same spot reuses cached results instead of
 * re-buying them from Google. Uses the shared GEOHASH_PRECISION (~153m cells) so
 * the key granularity always tracks the clustering granularity.
 */
export function clusterLocationKey(centroid: { latitude: number; longitude: number }): string {
  return geohash.encode(centroid.latitude, centroid.longitude, GEOHASH_PRECISION);
}

// =============================================================================
// Processed Clusters (for hiding already-processed suggestions)
// =============================================================================

export type ProcessedClusterStatus = 'confirmed' | 'hidden' | 'split';

/**
 * Mark a cluster as processed (confirmed or hidden).
 * This prevents the cluster from appearing in future suggestion lists.
 */
export async function markClusterProcessed(
  clusterId: string,
  status: ProcessedClusterStatus
): Promise<void> {
  const database = await getDb();
  await database.runAsync(
    'INSERT OR REPLACE INTO processed_clusters (cluster_id, status, processed_at) VALUES (?, ?, ?)',
    [clusterId, status, Date.now()]
  );
}

/**
 * Get all processed cluster IDs.
 * Returns a Set for efficient lookup when filtering suggestions.
 * Excludes 'split' status — splits are ephemeral (sub-clusters aren't persisted),
 * so treating a persisted split as dismissed would make the parent disappear
 * on return with nothing to show.
 */
export async function getProcessedClusterIds(): Promise<Set<string>> {
  const database = await getDb();
  const rows = await database.getAllAsync<{ cluster_id: string }>(
    "SELECT cluster_id FROM processed_clusters WHERE status != 'split'"
  );
  return new Set(rows.map((r) => r.cluster_id));
}

/**
 * Clear all processed clusters.
 * Call this when user wants to see all suggestions again.
 */
export async function clearProcessedClusters(): Promise<void> {
  const database = await getDb();
  await database.runAsync('DELETE FROM processed_clusters');
}

// =============================================================================
// Last Selected Photo Trip Candidate (remembers user's photo trip choice per destination)
// =============================================================================

/**
 * Get the last selected photo trip candidate ID for a destination trip.
 * Returns null if no previous selection exists.
 */
export async function getLastSelectedCandidateId(tripId: string): Promise<string | null> {
  return getMetadata(`last_candidate_${tripId}`);
}

/**
 * Set the last selected photo trip candidate ID for a destination trip.
 * Called when user switches between photo trips in the switcher sheet.
 */
export async function setLastSelectedCandidateId(
  tripId: string,
  candidateId: string
): Promise<void> {
  await setMetadata(`last_candidate_${tripId}`, candidateId);
}

// =============================================================================
// Place Suggestions Cache (prevents redundant Google Places API calls)
// =============================================================================

export interface CachedPlaceSuggestion {
  cluster_id: string;
  /**
   * Quantized centroid geohash for the location-fallback lookup. Optional for
   * backward compatibility; when omitted the row is only reachable by cluster_id.
   */
  location_key?: string;
  places: Array<{
    place_id: string;
    name: string;
    address: string;
    location: { latitude: number; longitude: number };
    category: string;
    distance_m: number;
    types: string[];
  }>;
}

/** A cluster identified for cache lookup by both its id and physical location. */
export interface ClusterCacheRef {
  id: string;
  locationKey: string;
}

/**
 * Parse a cached suggestions row, honoring the empty-result TTL.
 * Returns the places array, or null if the row is invalid or an expired empty.
 */
function parseSuggestionsRow(
  suggestionsJson: string,
  cachedAt: number,
  now: number,
  label: string
): CachedPlaceSuggestion['places'] | null {
  try {
    const places = JSON.parse(suggestionsJson);
    // Empty suggestions expire after TTL so transient failures get retried
    if (Array.isArray(places) && places.length === 0) {
      if (now - (cachedAt ?? 0) > EMPTY_SUGGESTION_TTL_MS) {
        if (__DEV__) console.log(`[PhotoCache] Expired empty cache for ${label}`);
        return null;
      }
    }
    return places;
  } catch {
    if (__DEV__) console.warn(`[PhotoCache] Invalid JSON for ${label}`);
    return null;
  }
}

/**
 * Get cached place suggestions for multiple clusters.
 * Returns a Map of cluster_id -> places array for clusters that have cached data.
 *
 * Lookup is two-tier: an exact cluster_id match first, then a fallback to the
 * cluster's physical location_key. The location fallback means a manual split or
 * re-segmentation that mints a new cluster_id still reuses the prior result for
 * the same physical spot instead of re-buying it from Google.
 *
 * Accepts either ClusterCacheRef objects (preferred) or bare cluster-id strings
 * (id-only lookup, for callers without centroid data).
 */
export async function getCachedSuggestions(
  clusters: ClusterCacheRef[] | string[]
): Promise<Map<string, CachedPlaceSuggestion['places']>> {
  if (clusters.length === 0) return new Map();

  // Normalize input: bare strings become id-only refs (no location fallback).
  const refs: ClusterCacheRef[] =
    typeof clusters[0] === 'string'
      ? (clusters as string[]).map((id) => ({ id, locationKey: '' }))
      : (clusters as ClusterCacheRef[]);

  const database = await getDb();
  const result = new Map<string, CachedPlaceSuggestion['places']>();
  const now = Date.now();

  const BATCH_SIZE = Math.min(100, SQLITE_PARAM_LIMIT);

  // Tier 1: exact cluster_id match.
  const ids = refs.map((r) => r.id);
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);
    const placeholders = batch.map(() => '?').join(',');
    const rows = await database.getAllAsync<{
      cluster_id: string;
      suggestions_json: string;
      cached_at: number;
    }>(
      `SELECT cluster_id, suggestions_json, cached_at FROM cached_place_suggestions WHERE cluster_id IN (${placeholders})`,
      batch
    );
    for (const row of rows) {
      const places = parseSuggestionsRow(
        row.suggestions_json,
        row.cached_at,
        now,
        `cluster ${row.cluster_id}`
      );
      if (places !== null) result.set(row.cluster_id, places);
    }
  }

  // Tier 2: location_key fallback for clusters that missed the id lookup.
  const unresolved = refs.filter((r) => r.locationKey && !result.has(r.id));
  if (unresolved.length === 0) return result;

  // Map each location_key back to the cluster id(s) waiting on it.
  const keyToIds = new Map<string, string[]>();
  for (const ref of unresolved) {
    const list = keyToIds.get(ref.locationKey) ?? [];
    list.push(ref.id);
    keyToIds.set(ref.locationKey, list);
  }

  const keys = [...keyToIds.keys()];
  for (let i = 0; i < keys.length; i += BATCH_SIZE) {
    const batch = keys.slice(i, i + BATCH_SIZE);
    const placeholders = batch.map(() => '?').join(',');
    // Pick the most recent entry per location_key.
    const rows = await database.getAllAsync<{
      location_key: string;
      suggestions_json: string;
      cached_at: number;
    }>(
      `SELECT location_key, suggestions_json, cached_at FROM cached_place_suggestions
       WHERE location_key IN (${placeholders})
       ORDER BY cached_at DESC`,
      batch
    );
    const seenKeys = new Set<string>();
    for (const row of rows) {
      if (seenKeys.has(row.location_key)) continue; // keep newest per key
      seenKeys.add(row.location_key);
      const places = parseSuggestionsRow(
        row.suggestions_json,
        row.cached_at,
        now,
        `location ${row.location_key}`
      );
      if (places === null) continue;
      for (const id of keyToIds.get(row.location_key) ?? []) {
        if (!result.has(id)) result.set(id, places);
      }
    }
  }

  return result;
}

/**
 * Cache place suggestions for multiple clusters.
 * Stores results persistently so we don't need to re-query the Google Places API.
 * Empty place arrays are also cached to prevent re-querying locations with no nearby places.
 */
export async function cacheSuggestions(suggestions: CachedPlaceSuggestion[]): Promise<void> {
  if (suggestions.length === 0) return;

  const database = await getDb();
  const now = Date.now();
  const BATCH_SIZE = 50;

  await database.withTransactionAsync(async () => {
    for (let i = 0; i < suggestions.length; i += BATCH_SIZE) {
      const batch = suggestions.slice(i, i + BATCH_SIZE);
      const placeholders = batch.map(() => '(?, ?, ?, ?)').join(', ');
      const values = batch.flatMap((s) => [
        s.cluster_id,
        JSON.stringify(s.places),
        now,
        s.location_key ?? null,
      ]);

      await database.runAsync(
        `INSERT OR REPLACE INTO cached_place_suggestions (cluster_id, suggestions_json, cached_at, location_key) VALUES ${placeholders}`,
        values
      );
    }
  });
}

/**
 * Clear all cached place suggestions.
 * Call this when user wants to refresh suggestions or on algorithm changes.
 */
export async function clearSuggestionCache(): Promise<void> {
  const database = await getDb();
  await database.runAsync('DELETE FROM cached_place_suggestions');
}

/**
 * Get the count of cached suggestions.
 */
export async function getCachedSuggestionCount(): Promise<number> {
  const database = await getDb();
  const result = await database.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) as count FROM cached_place_suggestions'
  );
  return result?.count ?? 0;
}

// =============================================================================
// Cluster Splits (persisted manual splits — survive across sessions)
// =============================================================================

export interface ClusterSplitRow {
  subClusterId: string;
  parentClusterId: string;
  photoIds: string[];
}

export interface ClusterSplitInput {
  id: string;
  photoIds: string[];
}

/**
 * Persist a manual split as two sub-cluster rows for one parent cluster.
 * Re-segmentation rebuilds the parent cluster ID by geohash on every load,
 * so without this rows the user's split would silently disappear on return.
 */
export async function saveClusterSplit(
  parentClusterId: string,
  subA: ClusterSplitInput,
  subB: ClusterSplitInput
): Promise<void> {
  const database = await getDb();
  const now = Date.now();
  await database.withTransactionAsync(async () => {
    await database.runAsync(
      'INSERT OR REPLACE INTO cluster_splits (sub_cluster_id, parent_cluster_id, photo_ids, created_at) VALUES (?, ?, ?, ?), (?, ?, ?, ?)',
      [
        subA.id,
        parentClusterId,
        JSON.stringify(subA.photoIds),
        now,
        subB.id,
        parentClusterId,
        JSON.stringify(subB.photoIds),
        now,
      ]
    );
  });
}

/**
 * Look up persisted splits keyed by parent cluster ID. Used at load time to
 * replace each parent in the candidate's cluster list with its sub-clusters.
 */
export async function getClusterSplitsForParents(
  parentClusterIds: string[]
): Promise<Map<string, ClusterSplitRow[]>> {
  if (parentClusterIds.length === 0) return new Map();

  const database = await getDb();
  const result = new Map<string, ClusterSplitRow[]>();

  const BATCH_SIZE = Math.min(100, SQLITE_PARAM_LIMIT);
  for (let i = 0; i < parentClusterIds.length; i += BATCH_SIZE) {
    const batch = parentClusterIds.slice(i, i + BATCH_SIZE);
    const placeholders = batch.map(() => '?').join(',');
    const rows = await database.getAllAsync<{
      sub_cluster_id: string;
      parent_cluster_id: string;
      photo_ids: string;
    }>(
      `SELECT sub_cluster_id, parent_cluster_id, photo_ids FROM cluster_splits WHERE parent_cluster_id IN (${placeholders})`,
      batch
    );
    for (const row of rows) {
      let photoIds: string[];
      try {
        photoIds = JSON.parse(row.photo_ids);
        if (!Array.isArray(photoIds)) continue;
      } catch {
        continue;
      }
      const list = result.get(row.parent_cluster_id) ?? [];
      list.push({
        subClusterId: row.sub_cluster_id,
        parentClusterId: row.parent_cluster_id,
        photoIds,
      });
      result.set(row.parent_cluster_id, list);
    }
  }

  return result;
}

// =============================================================================
// Saved Cluster Photos (photo IDs that have been uploaded to an entry)
// =============================================================================

/**
 * Record photo IDs that were uploaded to an entry. On next load, any cluster
 * whose photos are entirely in this set gets auto-dismissed — handles the
 * cluster-ID-mismatch edge case where a user splits, saves a half, returns,
 * and re-segmentation rebuilds the parent ID instead of the split sub-ID.
 */
export async function markPhotosSaved(clusterId: string, photoIds: string[]): Promise<void> {
  if (photoIds.length === 0) return;

  const database = await getDb();
  const now = Date.now();
  // 3 params per row; chunk to stay well under SQLITE_PARAM_LIMIT.
  const BATCH_SIZE = 200;

  await database.withTransactionAsync(async () => {
    for (let i = 0; i < photoIds.length; i += BATCH_SIZE) {
      const batch = photoIds.slice(i, i + BATCH_SIZE);
      const placeholders = batch.map(() => '(?, ?, ?)').join(', ');
      const values = batch.flatMap((id) => [id, clusterId, now]);
      await database.runAsync(
        `INSERT OR REPLACE INTO saved_cluster_photos (photo_id, cluster_id, saved_at) VALUES ${placeholders}`,
        values
      );
    }
  });
}

/**
 * Returns all photo IDs that have been uploaded to an entry across any cluster.
 */
export async function getAllSavedPhotoIds(): Promise<Set<string>> {
  const database = await getDb();
  const rows = await database.getAllAsync<{ photo_id: string }>(
    'SELECT photo_id FROM saved_cluster_photos'
  );
  return new Set(rows.map((r) => r.photo_id));
}
