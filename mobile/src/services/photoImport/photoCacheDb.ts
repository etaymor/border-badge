/**
 * Photo cache database - SQLite storage for photo metadata.
 *
 * Enables incremental photo imports by caching:
 * - Photo metadata (id, uri, filename, creation time)
 * - Location data (latitude, longitude)
 * - Precomputed geohash and country code
 *
 * On subsequent imports, only photos newer than last_import_time are scanned.
 */

import * as SQLite from 'expo-sqlite';

import type { CachedPhoto } from './types';

const DB_NAME = 'photos.db';
const SCHEMA_VERSION = 1;

/**
 * SQLite has a default limit of 999 bound parameters per query.
 * All batch operations use sizes well under this limit:
 * - cachePhotos: 50 rows × 9 params = 450 params
 * - cacheSuggestions: 50 rows × 3 params = 150 params
 * - removeCachedPhotos: 100 IDs = 100 params
 * - getCachedSuggestions: 100 IDs = 100 params
 */
const SQLITE_PARAM_LIMIT = 999;

let db: SQLite.SQLiteDatabase | null = null;
let dbInitPromise: Promise<SQLite.SQLiteDatabase> | null = null;

/**
 * Validate photo ID format for defense-in-depth.
 * expo-media-library returns UUIDs on iOS and numeric strings on Android.
 * Allows alphanumeric characters, hyphens, and forward slashes (Android uses
 * content:// URIs which contain forward slashes when accessed via certain APIs).
 *
 * Note: This validation is defense-in-depth. The primary SQL injection protection
 * comes from parameterized queries (using ? placeholders with batch arrays).
 * This pattern matching provides an additional layer of safety.
 */
const VALID_PHOTO_ID_PATTERN = /^[a-zA-Z0-9/-]+$/;

function isValidPhotoId(id: string): boolean {
  return id.length > 0 && id.length <= 256 && VALID_PHOTO_ID_PATTERN.test(id);
}

function validatePhotoIds(ids: string[]): string[] {
  return ids.filter((id) => {
    if (!isValidPhotoId(id)) {
      if (__DEV__) {
        console.warn(`[PhotoCache] Invalid photo ID format: ${id.substring(0, 50)}`);
      }
      return false;
    }
    return true;
  });
}

/**
 * Get or create the database instance.
 * Uses a promise-based singleton to prevent race conditions where
 * concurrent callers could each open separate DB connections.
 */
async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (db) {
    return db;
  }

  if (dbInitPromise) {
    return dbInitPromise;
  }

  dbInitPromise = (async () => {
    let conn: SQLite.SQLiteDatabase | null = null;
    try {
      conn = await SQLite.openDatabaseAsync(DB_NAME);
      db = conn;
      await initSchema();
      return db;
    } catch (error) {
      if (conn) {
        await conn.closeAsync();
      }
      db = null;
      throw error;
    } finally {
      // Clear promise so subsequent calls after close/failure re-init fresh
      dbInitPromise = null;
    }
  })();

  return dbInitPromise;
}

/**
 * Initialize database schema.
 */
async function initSchema(): Promise<void> {
  if (!db) return;

  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS cached_photos (
      id TEXT PRIMARY KEY NOT NULL,
      uri TEXT NOT NULL,
      filename TEXT NOT NULL,
      creation_time INTEGER NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      geohash TEXT NOT NULL,
      country_code TEXT,
      cached_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS photo_cache_metadata (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS processed_clusters (
      cluster_id TEXT PRIMARY KEY NOT NULL,
      status TEXT NOT NULL,
      processed_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cached_place_suggestions (
      cluster_id TEXT PRIMARY KEY NOT NULL,
      suggestions_json TEXT NOT NULL,
      cached_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_cached_photos_creation_time ON cached_photos(creation_time);
    CREATE INDEX IF NOT EXISTS idx_cached_photos_country_code ON cached_photos(country_code);
    CREATE INDEX IF NOT EXISTS idx_cached_photos_geohash ON cached_photos(geohash);
  `);

  // Store schema version for future migrations
  await setMetadata('schema_version', SCHEMA_VERSION.toString());
}

/**
 * Get metadata value by key.
 */
async function getMetadata(key: string): Promise<string | null> {
  const database = await getDb();
  const result = await database.getFirstAsync<{ value: string }>(
    'SELECT value FROM photo_cache_metadata WHERE key = ?',
    [key]
  );
  return result?.value ?? null;
}

/**
 * Set metadata value.
 */
async function setMetadata(key: string, value: string): Promise<void> {
  const database = await getDb();
  await database.runAsync(
    'INSERT OR REPLACE INTO photo_cache_metadata (key, value) VALUES (?, ?)',
    [key, value]
  );
}

/**
 * Get the timestamp of the last successful photo import.
 * Returns null if no import has been done.
 */
export async function getLastImportTime(): Promise<number | null> {
  const value = await getMetadata('last_import_time');
  return value ? parseInt(value, 10) : null;
}

/**
 * Set the timestamp of the last successful photo import.
 */
export async function setLastImportTime(timestamp: number): Promise<void> {
  await setMetadata('last_import_time', timestamp.toString());
}

/**
 * Cache a batch of photos with their computed metadata.
 * Uses INSERT OR REPLACE to upsert existing entries.
 */
export async function cachePhotos(photos: CachedPhoto[]): Promise<void> {
  if (photos.length === 0) return;

  const database = await getDb();
  const now = Date.now();
  const BATCH_SIZE = 50;

  await database.withTransactionAsync(async () => {
    for (let i = 0; i < photos.length; i += BATCH_SIZE) {
      const batch = photos.slice(i, i + BATCH_SIZE);
      const placeholders = batch.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
      const values = batch.flatMap((p) => [
        p.id,
        p.uri,
        p.filename,
        p.creationTime,
        p.latitude,
        p.longitude,
        p.geohash,
        p.countryCode,
        now,
      ]);

      await database.runAsync(
        `INSERT OR REPLACE INTO cached_photos
         (id, uri, filename, creation_time, latitude, longitude, geohash, country_code, cached_at)
         VALUES ${placeholders}`,
        values
      );
    }
  });
}

/**
 * Get all cached photos.
 * Returns photos sorted by creation time (newest first).
 */
export async function getAllCachedPhotos(): Promise<CachedPhoto[]> {
  const database = await getDb();
  const rows = await database.getAllAsync<{
    id: string;
    uri: string;
    filename: string;
    creation_time: number;
    latitude: number;
    longitude: number;
    geohash: string;
    country_code: string | null;
  }>(
    'SELECT id, uri, filename, creation_time, latitude, longitude, geohash, country_code FROM cached_photos ORDER BY creation_time DESC'
  );

  return rows.map((row) => ({
    id: row.id,
    uri: row.uri,
    filename: row.filename,
    creationTime: row.creation_time,
    latitude: row.latitude,
    longitude: row.longitude,
    geohash: row.geohash,
    countryCode: row.country_code,
  }));
}

/**
 * Get cached photos by country code.
 */
export async function getCachedPhotosByCountry(countryCode: string): Promise<CachedPhoto[]> {
  const database = await getDb();
  const rows = await database.getAllAsync<{
    id: string;
    uri: string;
    filename: string;
    creation_time: number;
    latitude: number;
    longitude: number;
    geohash: string;
    country_code: string | null;
  }>(
    'SELECT id, uri, filename, creation_time, latitude, longitude, geohash, country_code FROM cached_photos WHERE country_code = ? ORDER BY creation_time DESC',
    [countryCode]
  );

  return rows.map((row) => ({
    id: row.id,
    uri: row.uri,
    filename: row.filename,
    creationTime: row.creation_time,
    latitude: row.latitude,
    longitude: row.longitude,
    geohash: row.geohash,
    countryCode: row.country_code,
  }));
}

/**
 * Get count of cached photos.
 */
export async function getCachedPhotoCount(): Promise<number> {
  const database = await getDb();
  const result = await database.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) as count FROM cached_photos'
  );
  return result?.count ?? 0;
}

/**
 * Get count of cached photos for a specific country.
 * Uses indexed query - fast O(1) lookup.
 */
export async function getPhotoCountByCountry(countryCode: string): Promise<number> {
  const database = await getDb();
  const result = await database.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) as count FROM cached_photos WHERE country_code = ?',
    [countryCode]
  );
  return result?.count ?? 0;
}

// 14 days in milliseconds - matches TIME_GAP_THRESHOLD_MS in photoClustering.ts
const TRIP_GAP_THRESHOLD_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Get count of potential trip candidates for a specific country.
 * Trips are segmented by 14+ day gaps between photos.
 * This is a lightweight calculation that doesn't require full clustering.
 */
export async function getTripCandidateCountByCountry(countryCode: string): Promise<number> {
  const database = await getDb();
  // Get creation times sorted for this country
  const rows = await database.getAllAsync<{ creation_time: number }>(
    'SELECT creation_time FROM cached_photos WHERE country_code = ? ORDER BY creation_time ASC',
    [countryCode]
  );

  if (rows.length === 0) return 0;

  let tripCount = 1; // At least one trip if we have photos
  for (let i = 1; i < rows.length; i++) {
    const gap = rows[i].creation_time - rows[i - 1].creation_time;
    if (gap > TRIP_GAP_THRESHOLD_MS) {
      tripCount++;
    }
  }

  return tripCount;
}

/**
 * Check if cache has any data.
 */
export async function hasCachedPhotos(): Promise<boolean> {
  const count = await getCachedPhotoCount();
  return count > 0;
}

/**
 * Remove photos by IDs (for handling deleted photos).
 * IDs are validated for defense-in-depth against malformed input.
 * Deletes in batches to avoid SQLite bound-parameter limits.
 */
export async function removeCachedPhotos(ids: string[]): Promise<void> {
  if (ids.length === 0) return;

  // Defense-in-depth: validate IDs even though we use parameterized queries
  const validIds = validatePhotoIds(ids);
  if (validIds.length === 0) return;

  // Batch size must stay under SQLITE_PARAM_LIMIT (999)
  const BATCH_SIZE = Math.min(100, SQLITE_PARAM_LIMIT);

  const database = await getDb();

  for (let i = 0; i < validIds.length; i += BATCH_SIZE) {
    const batch = validIds.slice(i, i + BATCH_SIZE);
    const placeholders = batch.map(() => '?').join(',');
    await database.runAsync(`DELETE FROM cached_photos WHERE id IN (${placeholders})`, batch);
  }
}

/**
 * Get all cached photo IDs (for validation against device library).
 */
export async function getCachedPhotoIds(): Promise<Set<string>> {
  const database = await getDb();
  const rows = await database.getAllAsync<{ id: string }>('SELECT id FROM cached_photos');
  return new Set(rows.map((r) => r.id));
}

/**
 * Clear entire photo cache including sensitive suggestion/cluster data.
 * Call this on logout or when user requests full refresh.
 */
export async function clearPhotoCache(): Promise<void> {
  const database = await getDb();
  await database.withTransactionAsync(async () => {
    await database.runAsync('DELETE FROM cached_photos');
    await database.runAsync('DELETE FROM processed_clusters');
    await database.runAsync('DELETE FROM cached_place_suggestions');
    await database.runAsync("DELETE FROM photo_cache_metadata WHERE key = 'last_import_time'");
    await database.runAsync(
      "DELETE FROM photo_cache_metadata WHERE key = 'last_background_sync_time'"
    );
    // Clear last_candidate_* metadata keys to avoid stale selections.
    // Note: The LIKE pattern is a hardcoded string literal, not user input,
    // so there is no SQL injection risk here.
    await database.runAsync("DELETE FROM photo_cache_metadata WHERE key LIKE 'last_candidate_%'");
  });
}

// =============================================================================
// Processed Clusters (for hiding already-processed suggestions)
// =============================================================================

export type ProcessedClusterStatus = 'confirmed' | 'hidden';

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
 */
export async function getProcessedClusterIds(): Promise<Set<string>> {
  const database = await getDb();
  const rows = await database.getAllAsync<{ cluster_id: string }>(
    'SELECT cluster_id FROM processed_clusters'
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

/**
 * Close the database connection.
 * Primarily used for testing cleanup.
 */
export async function closeDb(): Promise<void> {
  if (db) {
    await db.closeAsync();
    db = null;
  }
  dbInitPromise = null;
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
    }>(
      `SELECT cluster_id, suggestions_json FROM cached_place_suggestions WHERE cluster_id IN (${placeholders})`,
      batch
    );

    for (const row of rows) {
      try {
        const places = JSON.parse(row.suggestions_json);
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

// =============================================================================
// Background Photo Sync
// =============================================================================

// Lazy imports to avoid circular dependency
// These are only used by performBackgroundPhotoSync
let _extractPhotosWithLocation: typeof import('./photoImportService').extractPhotosWithLocation;
let _photoToCachedPhoto: typeof import('./photoClustering').photoToCachedPhoto;
let _MediaLibrary: typeof import('expo-media-library');

async function getBackgroundSyncDeps() {
  if (!_extractPhotosWithLocation) {
    const { extractPhotosWithLocation } = await import('./photoImportService');
    _extractPhotosWithLocation = extractPhotosWithLocation;
  }
  if (!_photoToCachedPhoto) {
    const { photoToCachedPhoto } = await import('./photoClustering');
    _photoToCachedPhoto = photoToCachedPhoto;
  }
  if (!_MediaLibrary) {
    _MediaLibrary = await import('expo-media-library');
  }
  return {
    extractPhotosWithLocation: _extractPhotosWithLocation,
    photoToCachedPhoto: _photoToCachedPhoto,
    MediaLibrary: _MediaLibrary,
  };
}

// Module-level state for background sync coordination
let backgroundSyncController: AbortController | null = null;
let backgroundSyncInProgress = false;

// Minimum interval between background syncs (1 hour)
const BACKGROUND_SYNC_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Check if a background sync is currently in progress.
 */
export function isBackgroundSyncInProgress(): boolean {
  return backgroundSyncInProgress;
}

/**
 * Abort any in-progress background sync.
 * Call this before starting a manual scan to prevent conflicts.
 */
export function abortBackgroundSync(): void {
  if (backgroundSyncController) {
    backgroundSyncController.abort();
    backgroundSyncController = null;
    backgroundSyncInProgress = false;
  }
}

/**
 * Get the timestamp of the last background sync.
 */
export async function getLastBackgroundSyncTime(): Promise<number | null> {
  const value = await getMetadata('last_background_sync_time');
  return value ? parseInt(value, 10) : null;
}

/**
 * Set the timestamp of the last background sync.
 */
async function setLastBackgroundSyncTime(timestamp: number): Promise<void> {
  await setMetadata('last_background_sync_time', timestamp.toString());
}

/**
 * Perform a silent background photo sync.
 *
 * Called when app comes to foreground to keep the photo cache fresh.
 * Only runs if:
 * 1. Home country is set (required for filtering)
 * 2. Photo permissions are granted (checked without prompting)
 * 3. Enough time has passed since last sync (1 hour)
 * 4. A previous import exists (user has used photo import)
 *
 * Errors are swallowed silently - this is a convenience feature.
 */
export async function performBackgroundPhotoSync(
  homeCountry: string | null
): Promise<{ newPhotos: number } | null> {
  // Skip if no home country set
  if (!homeCountry) {
    return null;
  }

  // Atomically check and acquire lock before any async operations to prevent race conditions.
  // In JavaScript's single-threaded event loop, synchronous code runs to completion,
  // so this check-and-set is atomic as long as it happens before any `await`.
  // This is sufficient for our use case: preventing duplicate background syncs from
  // concurrent UI events (e.g., rapid button presses). True thread-safety is not needed
  // since React Native runs on a single JS thread.
  if (backgroundSyncInProgress) {
    return null;
  }
  backgroundSyncInProgress = true;
  backgroundSyncController = new AbortController();

  // Capture controller locally to avoid race condition where abortBackgroundSync()
  // sets backgroundSyncController to null before we check the aborted signal.
  // The captured localController will still reflect the aborted signal even after
  // the global reference is cleared.
  const localController = backgroundSyncController;

  try {
    // Lazy load dependencies to avoid circular imports
    const { extractPhotosWithLocation, photoToCachedPhoto, MediaLibrary } =
      await getBackgroundSyncDeps();

    // Check permissions without prompting
    const { status } = await MediaLibrary.getPermissionsAsync();
    if (status !== 'granted') {
      return null;
    }

    // Check if we have a previous import (cache exists)
    const lastImportTime = await getLastImportTime();
    if (!lastImportTime) {
      // No previous import - user hasn't used photo import yet
      return null;
    }

    // Check if enough time has passed since last background sync
    const lastBackgroundSync = await getLastBackgroundSyncTime();
    const now = Date.now();
    if (lastBackgroundSync && now - lastBackgroundSync < BACKGROUND_SYNC_INTERVAL_MS) {
      return null;
    }

    // Perform incremental scan (only photos since last import)
    const newPhotos = await extractPhotosWithLocation(
      () => {}, // No-op progress callback
      localController.signal,
      new Date(lastImportTime)
    );

    // Check if aborted (use local controller to avoid race with abortBackgroundSync)
    if (localController.signal.aborted) {
      return null;
    }

    // Cache new photos if found
    if (newPhotos.length > 0) {
      const newCachedPhotos = newPhotos.map(photoToCachedPhoto);
      await cachePhotos(newCachedPhotos);
    }

    // Update timestamps (skip if aborted to avoid updating state after cancellation)
    if (localController.signal.aborted) {
      return null;
    }

    // Update last_import_time to the newest photo's creation time (not wall-clock).
    // This prevents skipping photos created during the scan window.
    // Only update if we processed photos; otherwise keep the previous value.
    if (newPhotos.length > 0) {
      const newestPhotoTime = Math.max(...newPhotos.map((p) => p.creationTime.getTime()));
      await setLastImportTime(newestPhotoTime);
    }

    // Background sync time uses wall-clock to throttle sync frequency
    await setLastBackgroundSyncTime(Date.now());

    if (__DEV__) {
      console.log(`[PhotoSync] Background sync complete: ${newPhotos.length} new photos`);
    }

    return { newPhotos: newPhotos.length };
  } catch (error) {
    // Swallow all errors - this is a convenience feature
    if (__DEV__) {
      console.log('[PhotoSync] Background sync failed:', error);
    }
    return null;
  } finally {
    backgroundSyncInProgress = false;
    backgroundSyncController = null;
  }
}
