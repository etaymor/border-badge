/**
 * Local SQLite database for countries data.
 * Downloads countries once from Supabase and stores locally for fast offline queries.
 */

// NOTE: FTS5 deferred - LIKE queries are fast enough for 197 countries.
// FTS5 adds complexity (index rebuild on sync, different query syntax).
// Revisit if search performance becomes an issue with larger datasets.

import * as SQLite from 'expo-sqlite';

export interface Country {
  code: string;
  name: string;
  region: string;
  subregion: string | null;
  recognition: string | null;
}

/**
 * Local user country data - stored in SQLite during onboarding
 * for immediate display before backend sync completes.
 */
export interface LocalUserCountry {
  id: string;
  country_code: string;
  status: 'visited' | 'wishlist';
  created_at: string;
  added_during_onboarding: boolean;
}

const DB_NAME = 'countries.db';
const SYNC_KEY = 'countries_last_sync';
const SYNC_INTERVAL_MS = 1000 * 60 * 60 * 24; // 24 hours

let db: SQLite.SQLiteDatabase | null = null;

/**
 * Get or create the database instance
 */
async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!db) {
    db = await SQLite.openDatabaseAsync(DB_NAME);
    await initSchema();
  }
  return db;
}

/**
 * Initialize database schema
 */
async function initSchema(): Promise<void> {
  if (!db) return;

  // Create tables if they don't exist
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS countries (
      code TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      region TEXT NOT NULL,
      subregion TEXT,
      recognition TEXT
    );

    CREATE TABLE IF NOT EXISTS sync_metadata (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_countries (
      id TEXT PRIMARY KEY NOT NULL,
      country_code TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      added_during_onboarding INTEGER DEFAULT 1
    );

    CREATE INDEX IF NOT EXISTS idx_countries_region ON countries(region);
    CREATE INDEX IF NOT EXISTS idx_countries_name ON countries(name);
    CREATE INDEX IF NOT EXISTS idx_user_countries_code ON user_countries(country_code);
  `);

  // Migrate existing tables: add new columns if they don't exist
  // SQLite doesn't have IF NOT EXISTS for ALTER TABLE, so we check schema first
  const tableInfo = await db.getAllAsync<{ name: string }>('PRAGMA table_info(countries)');
  const columns = tableInfo.map((col) => col.name);

  if (!columns.includes('subregion')) {
    await db.execAsync('ALTER TABLE countries ADD COLUMN subregion TEXT');
    await db.execAsync(
      'CREATE INDEX IF NOT EXISTS idx_countries_subregion ON countries(subregion)'
    );
    // Clear sync timestamp to force re-sync with new data
    await db.runAsync('DELETE FROM sync_metadata WHERE key = ?', [SYNC_KEY]);
  }

  if (!columns.includes('recognition')) {
    await db.execAsync('ALTER TABLE countries ADD COLUMN recognition TEXT');
    // Clear sync timestamp to force re-sync with new data
    await db.runAsync('DELETE FROM sync_metadata WHERE key = ?', [SYNC_KEY]);
  }
}

/**
 * Get the last sync timestamp
 */
export async function getLastSyncTime(): Promise<number | null> {
  const database = await getDb();
  const result = await database.getFirstAsync<{ value: string }>(
    'SELECT value FROM sync_metadata WHERE key = ?',
    [SYNC_KEY]
  );
  return result ? parseInt(result.value, 10) : null;
}

/**
 * Set the last sync timestamp
 */
export async function setLastSyncTime(timestamp: number): Promise<void> {
  const database = await getDb();
  await database.runAsync('INSERT OR REPLACE INTO sync_metadata (key, value) VALUES (?, ?)', [
    SYNC_KEY,
    timestamp.toString(),
  ]);
}

/**
 * Check if sync is needed (no data or stale)
 */
export async function needsSync(): Promise<boolean> {
  const database = await getDb();

  // Check if we have any countries
  const countResult = await database.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) as count FROM countries'
  );

  if (!countResult || countResult.count === 0) {
    return true;
  }

  // Check if data is stale
  const lastSync = await getLastSyncTime();
  if (!lastSync) {
    return true;
  }

  return Date.now() - lastSync > SYNC_INTERVAL_MS;
}

/**
 * Save countries to local database
 */
export async function saveCountries(countries: Country[]): Promise<void> {
  const database = await getDb();

  // Use a transaction for better performance
  await database.withTransactionAsync(async () => {
    // Clear existing data
    await database.runAsync('DELETE FROM countries');

    // Batch insert in chunks for better performance
    const BATCH_SIZE = 50;
    for (let i = 0; i < countries.length; i += BATCH_SIZE) {
      const batch = countries.slice(i, i + BATCH_SIZE);
      const placeholders = batch.map(() => '(?, ?, ?, ?, ?)').join(', ');
      const values = batch.flatMap((c) => [
        c.code,
        c.name,
        c.region,
        c.subregion ?? null,
        c.recognition ?? null,
      ]);

      await database.runAsync(
        `INSERT INTO countries (code, name, region, subregion, recognition) VALUES ${placeholders}`,
        values
      );
    }
  });

  // Update sync timestamp
  await setLastSyncTime(Date.now());
}

/**
 * Get all countries from local database
 */
export async function getAllCountries(): Promise<Country[]> {
  const database = await getDb();
  return database.getAllAsync<Country>(
    'SELECT code, name, region, subregion, recognition FROM countries ORDER BY name'
  );
}

/**
 * Get countries by region
 */
export async function getCountriesByRegion(region: string): Promise<Country[]> {
  const database = await getDb();
  return database.getAllAsync<Country>(
    'SELECT code, name, region, subregion, recognition FROM countries WHERE region = ? ORDER BY name',
    [region]
  );
}

/**
 * Search countries by name or code
 */
export async function searchCountries(query: string, limit: number = 10): Promise<Country[]> {
  if (!query || query.trim().length === 0) {
    return [];
  }

  const database = await getDb();
  const searchTerm = `%${query.toLowerCase()}%`;

  return database.getAllAsync<Country>(
    `SELECT code, name, region, subregion, recognition FROM countries
     WHERE LOWER(name) LIKE ? OR LOWER(code) LIKE ?
     ORDER BY name
     LIMIT ?`,
    [searchTerm, searchTerm, limit]
  );
}

/**
 * Get a single country by code
 */
export async function getCountryByCode(code: string): Promise<Country | null> {
  const database = await getDb();
  return database.getFirstAsync<Country>(
    'SELECT code, name, region, subregion, recognition FROM countries WHERE code = ?',
    [code]
  );
}

/**
 * Get multiple countries by codes
 */
export async function getCountriesByCodes(codes: string[]): Promise<Country[]> {
  if (codes.length === 0) {
    return [];
  }

  const database = await getDb();
  // Safe: placeholders only contains '?' characters, actual values are parameterized
  const placeholders = codes.map(() => '?').join(',');

  return database.getAllAsync<Country>(
    `SELECT code, name, region, subregion, recognition FROM countries WHERE code IN (${placeholders}) ORDER BY name`,
    codes
  );
}

/**
 * Get count of countries in database
 */
export async function getCountriesCount(): Promise<number> {
  const database = await getDb();
  const result = await database.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) as count FROM countries'
  );
  return result?.count ?? 0;
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
// Local User Countries - for onboarding data persistence
// =============================================================================

/**
 * Save a user country to local SQLite database.
 * Uses INSERT OR REPLACE to upsert (update if country_code exists).
 */
export async function saveLocalUserCountry(country: LocalUserCountry): Promise<void> {
  const database = await getDb();
  await database.runAsync(
    `INSERT OR REPLACE INTO user_countries (id, country_code, status, created_at, added_during_onboarding)
     VALUES (?, ?, ?, ?, ?)`,
    [country.id, country.country_code, country.status, country.created_at, 1]
  );
}

/**
 * Save multiple user countries to local SQLite database.
 * Uses INSERT OR REPLACE to upsert.
 */
export async function saveLocalUserCountries(countries: LocalUserCountry[]): Promise<void> {
  if (countries.length === 0) return;

  const database = await getDb();

  await database.withTransactionAsync(async () => {
    for (const country of countries) {
      await database.runAsync(
        `INSERT OR REPLACE INTO user_countries (id, country_code, status, created_at, added_during_onboarding)
         VALUES (?, ?, ?, ?, ?)`,
        [country.id, country.country_code, country.status, country.created_at, 1]
      );
    }
  });
}

/**
 * Remove a user country from local SQLite database.
 */
export async function removeLocalUserCountry(countryCode: string): Promise<void> {
  const database = await getDb();
  await database.runAsync('DELETE FROM user_countries WHERE country_code = ?', [countryCode]);
}

/**
 * Get all user countries from local SQLite database.
 */
export async function getLocalUserCountries(): Promise<LocalUserCountry[]> {
  const database = await getDb();
  const rows = await database.getAllAsync<{
    id: string;
    country_code: string;
    status: string;
    created_at: string;
    added_during_onboarding: number;
  }>('SELECT id, country_code, status, created_at, added_during_onboarding FROM user_countries');

  return rows.map((row) => ({
    id: row.id,
    country_code: row.country_code,
    status: row.status as 'visited' | 'wishlist',
    created_at: row.created_at,
    added_during_onboarding: row.added_during_onboarding === 1,
  }));
}

/**
 * Clear all user countries from local SQLite database.
 * Called after successful migration to backend.
 */
export async function clearLocalUserCountries(): Promise<void> {
  const database = await getDb();
  await database.runAsync('DELETE FROM user_countries');
}

/**
 * Check if there are any local user countries stored.
 */
export async function hasLocalUserCountries(): Promise<boolean> {
  const database = await getDb();
  const result = await database.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) as count FROM user_countries'
  );
  return (result?.count ?? 0) > 0;
}

// =============================================================================
// Home Country - SQLite backup for onboarding migration reliability
// =============================================================================

const HOME_COUNTRY_KEY = 'onboarding_home_country';

/**
 * Save the home country code to SQLite as a backup for migration.
 * Zustand persist middleware can lose in-memory state during rehydration,
 * so SQLite serves as a reliable secondary source of truth.
 */
export async function saveHomeCountry(countryCode: string): Promise<void> {
  const database = await getDb();
  await database.runAsync('INSERT OR REPLACE INTO sync_metadata (key, value) VALUES (?, ?)', [
    HOME_COUNTRY_KEY,
    countryCode,
  ]);
}

/**
 * Get the home country code from SQLite.
 * Returns null if not set.
 */
export async function getHomeCountry(): Promise<string | null> {
  const database = await getDb();
  const result = await database.getFirstAsync<{ value: string }>(
    'SELECT value FROM sync_metadata WHERE key = ?',
    [HOME_COUNTRY_KEY]
  );
  return result?.value ?? null;
}

/**
 * Clear the home country code from SQLite.
 * Called after successful migration or store reset.
 */
export async function clearHomeCountry(): Promise<void> {
  const database = await getDb();
  await database.runAsync('DELETE FROM sync_metadata WHERE key = ?', [HOME_COUNTRY_KEY]);
}
