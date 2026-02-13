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
export const SQLITE_PARAM_LIMIT = 999;

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
export async function getDb(): Promise<SQLite.SQLiteDatabase> {
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
export async function getMetadata(key: string): Promise<string | null> {
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
export async function setMetadata(key: string, value: string): Promise<void> {
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
