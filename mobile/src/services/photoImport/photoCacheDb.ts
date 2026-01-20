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

let db: SQLite.SQLiteDatabase | null = null;
let dbInitPromise: Promise<SQLite.SQLiteDatabase> | null = null;

/**
 * Validate photo ID format for defense-in-depth.
 * expo-media-library returns UUIDs on iOS and numeric strings on Android.
 * Allows alphanumeric characters, hyphens, and forward slashes.
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
      dbInitPromise = null;
      return db;
    } catch (error) {
      if (conn) {
        await conn.closeAsync();
      }
      db = null;
      dbInitPromise = null;
      throw error;
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
 * Check if cache has any data.
 */
export async function hasCachedPhotos(): Promise<boolean> {
  const count = await getCachedPhotoCount();
  return count > 0;
}

/**
 * Remove photos by IDs (for handling deleted photos).
 * IDs are validated for defense-in-depth against malformed input.
 */
export async function removeCachedPhotos(ids: string[]): Promise<void> {
  if (ids.length === 0) return;

  // Defense-in-depth: validate IDs even though we use parameterized queries
  const validIds = validatePhotoIds(ids);
  if (validIds.length === 0) return;

  const database = await getDb();
  const placeholders = validIds.map(() => '?').join(',');
  await database.runAsync(`DELETE FROM cached_photos WHERE id IN (${placeholders})`, validIds);
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
 * Clear entire photo cache.
 * Call this on logout or when user requests full refresh.
 */
export async function clearPhotoCache(): Promise<void> {
  const database = await getDb();
  await database.withTransactionAsync(async () => {
    await database.runAsync('DELETE FROM cached_photos');
    await database.runAsync("DELETE FROM photo_cache_metadata WHERE key = 'last_import_time'");
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

  // Skip if already syncing
  if (backgroundSyncInProgress) {
    return null;
  }

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

    // Start background sync
    backgroundSyncInProgress = true;
    backgroundSyncController = new AbortController();

    // Perform incremental scan (only photos since last import)
    const newPhotos = await extractPhotosWithLocation(
      () => {}, // No-op progress callback
      backgroundSyncController.signal,
      new Date(lastImportTime)
    );

    // Check if aborted
    if (backgroundSyncController?.signal.aborted) {
      return null;
    }

    // Cache new photos if found
    if (newPhotos.length > 0) {
      const newCachedPhotos = newPhotos.map(photoToCachedPhoto);
      await cachePhotos(newCachedPhotos);
    }

    // Update timestamps
    const syncTime = Date.now();
    await setLastImportTime(syncTime);
    await setLastBackgroundSyncTime(syncTime);

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
