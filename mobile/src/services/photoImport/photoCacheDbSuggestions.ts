/**
 * Photo cache - processed clusters, candidate selection, and place suggestions.
 *
 * Extracted from photoCacheDb.ts to keep modules focused and under 500 lines.
 * All functions share the same SQLite database via getDb().
 */

import * as geohash from 'ngeohash';

import {
  getDb,
  getMetadata,
  setMetadata,
  SQLITE_PARAM_LIMIT,
  withPhotoCacheWriteLock,
} from './photoCacheDb';
import { GEOHASH_PRECISION, haversine } from './photoClustering';

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
  // Bare write, but still serialized: issued while another writer's transaction
  // is open it would be enrolled in that transaction and lost on its rollback —
  // the confirmed-entry-reappears-on-re-entry bug.
  await withPhotoCacheWriteLock(() =>
    database.runAsync(
      'INSERT OR REPLACE INTO processed_clusters (cluster_id, status, processed_at) VALUES (?, ?, ?)',
      [clusterId, status, Date.now()]
    )
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
  await withPhotoCacheWriteLock(() => database.runAsync('DELETE FROM processed_clusters'));
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
  // setMetadata takes the photo-cache write lock itself — do not wrap it here
  // (the mutex is not reentrant).
  await setMetadata(`last_candidate_${tripId}`, candidateId);
}

/**
 * Every destination trip this device has ever taken into the suggestions phase.
 *
 * `last_candidate_<tripId>` is written the moment a trip is opened for matching,
 * so the set of those keys IS this device's photo-import history. U10 uses it as
 * the input to the one-time grandfather pass: the durable counter is new, and a
 * user who imported repeatedly while it was unenforced must not be gated out of
 * the trip they already imported.
 *
 * ORDER IS LEXICOGRAPHIC BY TRIP ID, NOT CHRONOLOGICAL. The metadata table
 * stores no insertion time, so there is nothing here that could identify the
 * oldest import; `ORDER BY key` only guarantees that two calls on the same
 * device agree, which is what the grandfather pass needs to charge the same trip
 * every time. Do not read `[0]` as "the first trip the user ever imported".
 */
export async function getPhotoImportHistoryTripIds(): Promise<string[]> {
  const database = await getDb();
  const rows = await database.getAllAsync<{ key: string }>(
    "SELECT key FROM photo_cache_metadata WHERE key LIKE 'last_candidate_%' ORDER BY key"
  );
  return rows.map((r) => r.key.slice('last_candidate_'.length)).filter((id) => id.length > 0);
}

// =============================================================================
// Photo-import entitlement markers (U10 / R17 / KTD23)
// =============================================================================
//
// These are a FAST PATH ONLY. The server record is authoritative — it is what
// `POST /photos/suggest-places` compares against — and these rows exist purely
// so a returning user does not watch a paywall flash while the async read is in
// flight.
//
// Both keys are namespaced by user id. Cluster and candidate ids are
// deterministic per DEVICE, so an un-namespaced marker would let a second free
// account inherit the first account's exemption on a shared phone.

const CONSUMED_IMPORT_KEY_PREFIX = 'photo_import_consumed_';
const GRANDFATHER_KEY_PREFIX = 'photo_import_grandfathered_';

/** Trip ids this device believes `userId` may still run matching for (R17). */
export async function getConsumedPhotoImportTripIds(userId: string): Promise<string[]> {
  const raw = await getMetadata(`${CONSUMED_IMPORT_KEY_PREFIX}${userId}`);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

/** Record a trip id in this user's device-local exemption marker. */
export async function addConsumedPhotoImportTripId(userId: string, tripId: string): Promise<void> {
  const existing = await getConsumedPhotoImportTripIds(userId);
  if (existing.includes(tripId)) return;
  // setMetadata takes the photo-cache write lock itself — do not wrap it here
  // (the mutex is not reentrant).
  await setMetadata(
    `${CONSUMED_IMPORT_KEY_PREFIX}${userId}`,
    JSON.stringify([...existing, tripId])
  );
}

/** Whether the one-time grandfather pass has already run for this user. */
export async function hasRunPhotoImportGrandfatherPass(userId: string): Promise<boolean> {
  return (await getMetadata(`${GRANDFATHER_KEY_PREFIX}${userId}`)) === 'done';
}

/** Mark the one-time grandfather pass as complete for this user. */
export async function markPhotoImportGrandfatherPassRun(userId: string): Promise<void> {
  await setMetadata(`${GRANDFATHER_KEY_PREFIX}${userId}`, 'done');
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
  /**
   * The cluster's raw centroid. Optional — id-only callers omit it. When present,
   * the Tier-3 neighbor-cell lookup (B2/KTD9) uses it to pick the NEAREST-centroid
   * cached entry across the 8 neighbor cells (and to enforce a distance ceiling so
   * a DIFFERENT nearby venue's cache is never served). When absent, Tier 3 falls
   * back to the newest neighbor entry.
   */
  centroid?: { latitude: number; longitude: number };
}

/**
 * Max distance (meters) between a requesting cluster's centroid and a neighbor
 * cell's decoded center for that neighbor's cache to be reused (B2/KTD9 guard).
 *
 * A geohash-7 cell is ~153m wide. A same-venue re-import whose centroid drifted
 * one cell over keeps its centroid near the venue, so the neighbor cell center is
 * at most ~1.5 cells (~230m) away in the worst geometric case. 300m (~2 cells)
 * comfortably admits that legitimate drift while rejecting a distinct venue whose
 * cached cell center sits meaningfully farther — without coarsening the key (which
 * would risk silently serving the wrong venue's places). decode() returns the
 * cell CENTER, a good approximation of the cached venue's location.
 */
const NEIGHBOR_CELL_MAX_DISTANCE_M = 300;

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

  // Tier 3 (B2 / KTD9): neighbor-cell fallback for clusters that still missed.
  // A re-import can drift a split centroid just across a geohash-7 cell boundary,
  // so the exact-cell key (Tier 2) misses even though the same venue's cache sits
  // one cell over. Query the 8 neighbor cells and pick the NEAREST-centroid entry
  // within a distance ceiling — we do NOT coarsen the key (that would risk serving
  // a different nearby venue's cache).
  const stillUnresolved = refs.filter((r) => r.locationKey && !result.has(r.id));
  if (stillUnresolved.length === 0) return result;

  // Collect the neighbor cells to query, mapping each neighbor key back to the
  // refs that want it (a ref's centroid is needed for the nearest tiebreak).
  const neighborKeyToRefs = new Map<string, ClusterCacheRef[]>();
  for (const ref of stillUnresolved) {
    for (const neighborKey of geohash.neighbors(ref.locationKey)) {
      const list = neighborKeyToRefs.get(neighborKey) ?? [];
      list.push(ref);
      neighborKeyToRefs.set(neighborKey, list);
    }
  }

  // Accumulate the best candidate per ref id as neighbor rows arrive.
  // Without a centroid we tiebreak by recency (newest cached_at).
  const best = new Map<
    string,
    { places: CachedPlaceSuggestion['places']; distanceM: number; cachedAt: number }
  >();

  const neighborKeys = [...neighborKeyToRefs.keys()];
  for (let i = 0; i < neighborKeys.length; i += BATCH_SIZE) {
    const batch = neighborKeys.slice(i, i + BATCH_SIZE);
    const placeholders = batch.map(() => '?').join(',');
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
    for (const row of rows) {
      const places = parseSuggestionsRow(
        row.suggestions_json,
        row.cached_at,
        now,
        `neighbor ${row.location_key}`
      );
      if (places === null) continue;
      // The cached row stores a geohash; decode it to the cell center as a stand-in
      // for the cached venue's location.
      const cellCenter = geohash.decode(row.location_key);
      for (const ref of neighborKeyToRefs.get(row.location_key) ?? []) {
        if (result.has(ref.id)) continue; // already resolved by an earlier tier

        let distanceM = Number.POSITIVE_INFINITY;
        if (ref.centroid) {
          distanceM = haversine(
            ref.centroid.latitude,
            ref.centroid.longitude,
            cellCenter.latitude,
            cellCenter.longitude
          );
          // Guard: reject a neighbor cell whose center is too far — this is what
          // keeps a DIFFERENT venue's cache from being served (KTD9/R3).
          if (distanceM > NEIGHBOR_CELL_MAX_DISTANCE_M) continue;
        }

        const current = best.get(ref.id);
        if (!current) {
          best.set(ref.id, { places, distanceM, cachedAt: row.cached_at });
          continue;
        }
        // With a centroid: nearest wins. Without one (Infinity distance for both):
        // newest cached_at wins.
        const isBetter =
          distanceM < current.distanceM ||
          (distanceM === current.distanceM && row.cached_at > current.cachedAt);
        if (isBetter) {
          best.set(ref.id, { places, distanceM, cachedAt: row.cached_at });
        }
      }
    }
  }

  for (const [id, entry] of best) {
    if (!result.has(id)) result.set(id, entry.places);
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

  await withPhotoCacheWriteLock(async () => {
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
  });
}

/**
 * Clear all cached place suggestions.
 * Call this when user wants to refresh suggestions or on algorithm changes.
 */
export async function clearSuggestionCache(): Promise<void> {
  const database = await getDb();
  await withPhotoCacheWriteLock(() => database.runAsync('DELETE FROM cached_place_suggestions'));
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
  await withPhotoCacheWriteLock(async () => {
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

  await withPhotoCacheWriteLock(async () => {
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
