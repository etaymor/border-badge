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

  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS countries (
      code TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      region TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sync_metadata (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_countries_region ON countries(region);
    CREATE INDEX IF NOT EXISTS idx_countries_name ON countries(name);
  `);
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

    // Insert new countries
    for (const country of countries) {
      await database.runAsync('INSERT INTO countries (code, name, region) VALUES (?, ?, ?)', [
        country.code,
        country.name,
        country.region,
      ]);
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
  return database.getAllAsync<Country>('SELECT code, name, region FROM countries ORDER BY name');
}

/**
 * Get countries by region
 */
export async function getCountriesByRegion(region: string): Promise<Country[]> {
  const database = await getDb();
  return database.getAllAsync<Country>(
    'SELECT code, name, region FROM countries WHERE region = ? ORDER BY name',
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
    `SELECT code, name, region FROM countries
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
    'SELECT code, name, region FROM countries WHERE code = ?',
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
  const placeholders = codes.map(() => '?').join(',');

  return database.getAllAsync<Country>(
    `SELECT code, name, region FROM countries WHERE code IN (${placeholders}) ORDER BY name`,
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
