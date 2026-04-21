/**
 * Photo cache - processed clusters, candidate selection, and place suggestions.
 *
 * Extracted from photoCacheDb.ts to keep modules focused and under 500 lines.
 * All functions share the same SQLite database via getDb().
 */

import { getDb, getMetadata, setMetadata, SQLITE_PARAM_LIMIT } from './photoCacheDb';

/** Empty suggestions expire after 24 hours so transient failures get retried. */
const EMPTY_SUGGESTION_TTL_MS = 24 * 60 * 60 * 1000;

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

/**
 * Get cached place suggestions for multiple clusters.
 * Returns a Map of cluster_id -> places array for clusters that have cached data.
 * Clusters not in the cache are not included in the result.
 */
export async function getCachedSuggestions(
  clusterIds: string[]
): Promise<Map<string, CachedPlaceSuggestion['places']>> {
  if (clusterIds.length === 0) return new Map();

  const database = await getDb();
  const result = new Map<string, CachedPlaceSuggestion['places']>();

  // Batch size must stay under SQLITE_PARAM_LIMIT (999)
  const BATCH_SIZE = Math.min(100, SQLITE_PARAM_LIMIT);
  for (let i = 0; i < clusterIds.length; i += BATCH_SIZE) {
    const batch = clusterIds.slice(i, i + BATCH_SIZE);
    const placeholders = batch.map(() => '?').join(',');
    const rows = await database.getAllAsync<{
      cluster_id: string;
      suggestions_json: string;
      cached_at: number;
    }>(
      `SELECT cluster_id, suggestions_json, cached_at FROM cached_place_suggestions WHERE cluster_id IN (${placeholders})`,
      batch
    );

    const now = Date.now();
    for (const row of rows) {
      try {
        const places = JSON.parse(row.suggestions_json);
        // Empty suggestions expire after TTL so transient failures get retried
        if (Array.isArray(places) && places.length === 0) {
          const age = now - (row.cached_at ?? 0);
          if (age > EMPTY_SUGGESTION_TTL_MS) {
            if (__DEV__) {
              console.log(`[PhotoCache] Expired empty cache for cluster ${row.cluster_id}`);
            }
            continue;
          }
        }
        result.set(row.cluster_id, places);
      } catch {
        // Skip invalid JSON entries
        if (__DEV__) {
          console.warn(`[PhotoCache] Invalid JSON for cluster ${row.cluster_id}`);
        }
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
      const placeholders = batch.map(() => '(?, ?, ?)').join(', ');
      const values = batch.flatMap((s) => [s.cluster_id, JSON.stringify(s.places), now]);

      await database.runAsync(
        `INSERT OR REPLACE INTO cached_place_suggestions (cluster_id, suggestions_json, cached_at) VALUES ${placeholders}`,
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
