import type { CachedPhoto } from '../../../services/photoImport/types';

describe('photoCacheDb', () => {
  let mockDb: {
    execAsync: jest.Mock;
    runAsync: jest.Mock;
    getAllAsync: jest.Mock;
    getFirstAsync: jest.Mock;
    closeAsync: jest.Mock;
    withTransactionAsync: jest.Mock;
  };
  let photoCacheDb: typeof import('../../../services/photoImport/photoCacheDb');
  let photoCacheDbSuggestions: typeof import('../../../services/photoImport/photoCacheDbSuggestions');
  let mockedSQLite: jest.Mocked<typeof import('expo-sqlite')>;

  beforeEach(() => {
    // Reset module cache first to get fresh singleton state
    jest.resetModules();
    jest.resetAllMocks();

    // Create a fresh mock database for each test
    mockDb = {
      execAsync: jest.fn().mockResolvedValue(undefined),
      runAsync: jest.fn().mockResolvedValue(undefined),
      getAllAsync: jest.fn().mockResolvedValue([]),
      getFirstAsync: jest.fn().mockResolvedValue(null),
      closeAsync: jest.fn().mockResolvedValue(undefined),
      withTransactionAsync: jest.fn().mockImplementation(async (callback) => {
        await callback();
      }),
    };

    // Mock expo-sqlite before requiring the module
    jest.doMock('expo-sqlite', () => ({
      openDatabaseAsync: jest.fn().mockResolvedValue(mockDb),
    }));

    // Now require the modules (require is needed after jest.resetModules() and doMock)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mockedSQLite = require('expo-sqlite');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    photoCacheDb = require('../../../services/photoImport/photoCacheDb');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    photoCacheDbSuggestions = require('../../../services/photoImport/photoCacheDbSuggestions');
  });

  afterEach(async () => {
    // Close the DB to reset the singleton for the next test
    if (photoCacheDb) {
      try {
        await photoCacheDb.closeDb();
      } catch {
        // Ignore errors during cleanup
      }
    }
  });

  describe('getLastImportTime', () => {
    it('returns null when no import time exists', async () => {
      mockDb.getFirstAsync.mockResolvedValue(null);

      const result = await photoCacheDb.getLastImportTime();

      expect(result).toBeNull();
    });

    it('returns the stored timestamp when it exists', async () => {
      const timestamp = 1700000000000;
      mockDb.getFirstAsync.mockResolvedValue({ value: timestamp.toString() });

      const result = await photoCacheDb.getLastImportTime();

      expect(result).toBe(timestamp);
    });

    it('initializes the database on first access', async () => {
      mockDb.getFirstAsync.mockResolvedValue(null);

      await photoCacheDb.getLastImportTime();

      expect(mockedSQLite.openDatabaseAsync).toHaveBeenCalledWith('photos.db');
      expect(mockDb.execAsync).toHaveBeenCalled();
    });
  });

  describe('setLastImportTime', () => {
    it('stores the timestamp in metadata', async () => {
      const timestamp = 1700000000000;

      await photoCacheDb.setLastImportTime(timestamp);

      expect(mockDb.runAsync).toHaveBeenCalledWith(
        'INSERT OR REPLACE INTO photo_cache_metadata (key, value) VALUES (?, ?)',
        ['last_import_time', timestamp.toString()]
      );
    });
  });

  describe('cachePhotos', () => {
    const createMockPhoto = (id: string, countryCode: string | null = 'JP'): CachedPhoto => ({
      id,
      uri: `file://photo-${id}.jpg`,
      filename: `photo-${id}.jpg`,
      creationTime: Date.now(),
      latitude: 35.6762,
      longitude: 139.6503,
      geohash: 'xn76urx',
      countryCode,
    });

    it('does nothing when photos array is empty', async () => {
      await photoCacheDb.cachePhotos([]);

      // Should not even open the database
      expect(mockDb.withTransactionAsync).not.toHaveBeenCalled();
    });

    it('caches a single photo', async () => {
      const photo = createMockPhoto('photo-1');

      await photoCacheDb.cachePhotos([photo]);

      expect(mockDb.withTransactionAsync).toHaveBeenCalled();
      expect(mockDb.runAsync).toHaveBeenCalledWith(
        expect.stringContaining('INSERT OR REPLACE INTO cached_photos'),
        expect.arrayContaining([
          photo.id,
          photo.uri,
          photo.filename,
          photo.creationTime,
          photo.latitude,
          photo.longitude,
          photo.geohash,
          photo.countryCode,
          expect.any(Number), // cached_at timestamp
        ])
      );
    });

    it('caches multiple photos in batches', async () => {
      // Create 75 photos to test batching (batch size is 50)
      const photos = Array.from({ length: 75 }, (_, i) => createMockPhoto(`photo-${i}`));

      await photoCacheDb.cachePhotos(photos);

      // Should have 2 batch inserts (50 + 25) + 1 for schema_version
      // The first runAsync call is for storing schema_version during init
      const insertCalls = mockDb.runAsync.mock.calls.filter(
        (call: unknown[]) =>
          typeof call[0] === 'string' && call[0].includes('INSERT OR REPLACE INTO cached_photos')
      );
      expect(insertCalls).toHaveLength(2);
    });

    it('handles photos with null country code', async () => {
      const photo = createMockPhoto('photo-1', null);

      await photoCacheDb.cachePhotos([photo]);

      expect(mockDb.runAsync).toHaveBeenCalledWith(
        expect.stringContaining('INSERT OR REPLACE INTO cached_photos'),
        expect.arrayContaining([null]) // countryCode should be null
      );
    });
  });

  describe('getAllCachedPhotos', () => {
    it('returns empty array when no photos cached', async () => {
      mockDb.getAllAsync.mockResolvedValue([]);

      const result = await photoCacheDb.getAllCachedPhotos();

      expect(result).toEqual([]);
    });

    it('returns all cached photos sorted by creation time', async () => {
      const mockRows = [
        {
          id: 'photo-1',
          uri: 'file://photo1.jpg',
          filename: 'photo1.jpg',
          creation_time: 1700000000000,
          latitude: 35.6762,
          longitude: 139.6503,
          geohash: 'xn76urx',
          country_code: 'JP',
        },
        {
          id: 'photo-2',
          uri: 'file://photo2.jpg',
          filename: 'photo2.jpg',
          creation_time: 1699999999999,
          latitude: 40.7128,
          longitude: -74.006,
          geohash: 'dr5regw',
          country_code: 'US',
        },
      ];
      mockDb.getAllAsync.mockResolvedValue(mockRows);

      const result = await photoCacheDb.getAllCachedPhotos();

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: 'photo-1',
        uri: 'file://photo1.jpg',
        filename: 'photo1.jpg',
        creationTime: 1700000000000,
        latitude: 35.6762,
        longitude: 139.6503,
        geohash: 'xn76urx',
        countryCode: 'JP',
      });
      expect(mockDb.getAllAsync).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY creation_time DESC')
      );
    });

    it('handles null country code in results', async () => {
      const mockRows = [
        {
          id: 'photo-1',
          uri: 'file://photo1.jpg',
          filename: 'photo1.jpg',
          creation_time: 1700000000000,
          latitude: 0,
          longitude: 0,
          geohash: 's00000',
          country_code: null,
        },
      ];
      mockDb.getAllAsync.mockResolvedValue(mockRows);

      const result = await photoCacheDb.getAllCachedPhotos();

      expect(result[0].countryCode).toBeNull();
    });
  });

  describe('getCachedPhotosByCountry', () => {
    it('returns photos filtered by country code', async () => {
      const mockRows = [
        {
          id: 'photo-1',
          uri: 'file://photo1.jpg',
          filename: 'photo1.jpg',
          creation_time: 1700000000000,
          latitude: 35.6762,
          longitude: 139.6503,
          geohash: 'xn76urx',
          country_code: 'JP',
        },
      ];
      mockDb.getAllAsync.mockResolvedValue(mockRows);

      const result = await photoCacheDb.getCachedPhotosByCountry('JP');

      expect(result).toHaveLength(1);
      expect(result[0].countryCode).toBe('JP');
      expect(mockDb.getAllAsync).toHaveBeenCalledWith(
        expect.stringContaining('WHERE country_code = ?'),
        ['JP']
      );
    });

    it('returns empty array when no photos match country', async () => {
      mockDb.getAllAsync.mockResolvedValue([]);

      const result = await photoCacheDb.getCachedPhotosByCountry('XX');

      expect(result).toEqual([]);
    });
  });

  describe('getCachedPhotoCount', () => {
    it('returns 0 when no photos cached', async () => {
      mockDb.getFirstAsync.mockResolvedValue({ count: 0 });

      const result = await photoCacheDb.getCachedPhotoCount();

      expect(result).toBe(0);
    });

    it('returns the correct count', async () => {
      mockDb.getFirstAsync.mockResolvedValue({ count: 42 });

      const result = await photoCacheDb.getCachedPhotoCount();

      expect(result).toBe(42);
    });

    it('returns 0 when query returns null', async () => {
      mockDb.getFirstAsync.mockResolvedValue(null);

      const result = await photoCacheDb.getCachedPhotoCount();

      expect(result).toBe(0);
    });
  });

  describe('hasCachedPhotos', () => {
    it('returns false when no photos cached', async () => {
      mockDb.getFirstAsync.mockResolvedValue({ count: 0 });

      const result = await photoCacheDb.hasCachedPhotos();

      expect(result).toBe(false);
    });

    it('returns true when photos are cached', async () => {
      mockDb.getFirstAsync.mockResolvedValue({ count: 5 });

      const result = await photoCacheDb.hasCachedPhotos();

      expect(result).toBe(true);
    });
  });

  describe('removeCachedPhotos', () => {
    it('does nothing when ids array is empty', async () => {
      await photoCacheDb.removeCachedPhotos([]);

      expect(mockDb.runAsync).not.toHaveBeenCalled();
    });

    it('removes photos by valid IDs', async () => {
      const ids = ['photo-1', 'photo-2', 'photo-3'];

      await photoCacheDb.removeCachedPhotos(ids);

      expect(mockDb.runAsync).toHaveBeenCalledWith(
        'DELETE FROM cached_photos WHERE id IN (?,?,?)',
        ids
      );
    });

    it('filters out invalid photo IDs', async () => {
      // IDs with special characters that should be rejected
      const ids = [
        'valid-photo-1',
        'photo<script>', // Invalid - contains special chars
        'valid/photo/2', // Valid - forward slashes are allowed
        '', // Invalid - empty
      ];

      await photoCacheDb.removeCachedPhotos(ids);

      // Should only include the two valid IDs
      expect(mockDb.runAsync).toHaveBeenCalledWith('DELETE FROM cached_photos WHERE id IN (?,?)', [
        'valid-photo-1',
        'valid/photo/2',
      ]);
    });

    it('does nothing when all IDs are invalid', async () => {
      const ids = ['<script>alert(1)</script>', 'photo;DROP TABLE'];

      await photoCacheDb.removeCachedPhotos(ids);

      expect(mockDb.runAsync).not.toHaveBeenCalled();
    });

    it('drops derived ML tag and verdict rows for the same IDs', async () => {
      const ids = ['photo-1', 'photo-2'];

      await photoCacheDb.removeCachedPhotos(ids);

      expect(mockDb.runAsync).toHaveBeenCalledWith(
        'DELETE FROM photo_ml_tags WHERE id IN (?,?)',
        ids
      );
      expect(mockDb.runAsync).toHaveBeenCalledWith(
        'DELETE FROM photo_quiz_verdicts WHERE id IN (?,?)',
        ids
      );
    });
  });

  describe('getCachedPhotoIds', () => {
    it('returns empty set when no photos cached', async () => {
      mockDb.getAllAsync.mockResolvedValue([]);

      const result = await photoCacheDb.getCachedPhotoIds();

      expect(result).toBeInstanceOf(Set);
      expect(result.size).toBe(0);
    });

    it('returns set of all photo IDs', async () => {
      mockDb.getAllAsync.mockResolvedValue([
        { id: 'photo-1' },
        { id: 'photo-2' },
        { id: 'photo-3' },
      ]);

      const result = await photoCacheDb.getCachedPhotoIds();

      expect(result).toBeInstanceOf(Set);
      expect(result.size).toBe(3);
      expect(result.has('photo-1')).toBe(true);
      expect(result.has('photo-2')).toBe(true);
      expect(result.has('photo-3')).toBe(true);
    });
  });

  describe('clearPhotoCache', () => {
    it('clears all photos and import time metadata', async () => {
      await photoCacheDb.clearPhotoCache();

      expect(mockDb.withTransactionAsync).toHaveBeenCalled();
      expect(mockDb.runAsync).toHaveBeenCalledWith('DELETE FROM cached_photos');
      expect(mockDb.runAsync).toHaveBeenCalledWith(
        "DELETE FROM photo_cache_metadata WHERE key = 'last_import_time'"
      );
    });
  });

  describe('closeDb', () => {
    it('closes the database connection', async () => {
      // First, trigger DB initialization
      await photoCacheDb.getLastImportTime();
      expect(mockedSQLite.openDatabaseAsync).toHaveBeenCalled();

      // Then close it
      await photoCacheDb.closeDb();

      expect(mockDb.closeAsync).toHaveBeenCalled();
    });

    it('does nothing when database is not open', async () => {
      // Don't initialize DB first
      await photoCacheDb.closeDb();

      // closeAsync should not be called since DB was never opened
      expect(mockDb.closeAsync).not.toHaveBeenCalled();
    });
  });

  describe('getCachedSuggestions', () => {
    it('returns cached suggestions with places', async () => {
      const places = [
        {
          place_id: 'place-1',
          name: 'Test Place',
          address: '123 Main St',
          location: { latitude: 41.0, longitude: 19.8 },
          category: 'Place',
          distance_m: 50,
          types: ['tourist_attraction'],
        },
      ];
      mockDb.getAllAsync.mockResolvedValue([
        { cluster_id: 'cluster-1', suggestions_json: JSON.stringify(places) },
      ]);

      const result = await photoCacheDbSuggestions.getCachedSuggestions(['cluster-1']);

      expect(result.size).toBe(1);
      expect(result.get('cluster-1')).toEqual(places);
    });

    it('excludes stale empty suggestions that are older than TTL', async () => {
      // Simulate an empty-places entry cached 25 hours ago (beyond the 24h TTL)
      const staleTimestamp = Date.now() - 25 * 60 * 60 * 1000;
      mockDb.getAllAsync.mockResolvedValue([
        {
          cluster_id: 'cluster-stale',
          suggestions_json: '[]',
          cached_at: staleTimestamp,
        },
      ]);

      const result = await photoCacheDbSuggestions.getCachedSuggestions(['cluster-stale']);

      // Stale empty entry should NOT be returned - forces a re-fetch from API
      expect(result.size).toBe(0);
    });

    it('keeps recent empty suggestions within TTL', async () => {
      // Empty-places entry cached 1 hour ago (within the 24h TTL)
      const recentTimestamp = Date.now() - 1 * 60 * 60 * 1000;
      mockDb.getAllAsync.mockResolvedValue([
        {
          cluster_id: 'cluster-recent-empty',
          suggestions_json: '[]',
          cached_at: recentTimestamp,
        },
      ]);

      const result = await photoCacheDbSuggestions.getCachedSuggestions(['cluster-recent-empty']);

      // Recent empty entry should still be returned
      expect(result.size).toBe(1);
      expect(result.get('cluster-recent-empty')).toEqual([]);
    });

    it('keeps non-empty suggestions regardless of age', async () => {
      // Non-empty entry cached 30 days ago - should still be valid
      const oldTimestamp = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const places = [
        {
          place_id: 'place-1',
          name: 'Test Place',
          address: '123 Main St',
          location: { latitude: 41.0, longitude: 19.8 },
          category: 'Place',
          distance_m: 50,
          types: ['tourist_attraction'],
        },
      ];
      mockDb.getAllAsync.mockResolvedValue([
        {
          cluster_id: 'cluster-old-with-places',
          suggestions_json: JSON.stringify(places),
          cached_at: oldTimestamp,
        },
      ]);

      const result = await photoCacheDbSuggestions.getCachedSuggestions([
        'cluster-old-with-places',
      ]);

      // Non-empty suggestions should never expire
      expect(result.size).toBe(1);
      expect(result.get('cluster-old-with-places')).toEqual(places);
    });

    it('falls back to location_key when the cluster_id misses', async () => {
      const places = [
        {
          place_id: 'place-1',
          name: 'Test Place',
          address: '123 Main St',
          location: { latitude: 41.0, longitude: 19.8 },
          category: 'Place',
          distance_m: 50,
          types: ['tourist_attraction'],
        },
      ];
      // Tier 1 (cluster_id IN ...) misses; Tier 2 (location_key IN ...) hits.
      mockDb.getAllAsync.mockImplementation(async (sql: string) => {
        if (sql.includes('location_key IN')) {
          return [
            {
              location_key: 'geohashabc',
              suggestions_json: JSON.stringify(places),
              cached_at: Date.now(),
            },
          ];
        }
        if (sql.includes('cluster_id IN')) return [];
        return []; // PRAGMA table_info etc.
      });

      const result = await photoCacheDbSuggestions.getCachedSuggestions([
        { id: 'new-cluster-id', locationKey: 'geohashabc' },
      ]);

      // A re-segmented cluster reuses the prior result for the same physical spot.
      expect(result.get('new-cluster-id')).toEqual(places);
    });

    it('prefers the cluster_id match over the location fallback', async () => {
      const idPlaces = [
        {
          place_id: 'by-id',
          name: 'By Id',
          address: 'a',
          location: { latitude: 1, longitude: 2 },
          category: 'Place',
          distance_m: 1,
          types: [],
        },
      ];
      mockDb.getAllAsync.mockImplementation(async (sql: string) => {
        if (sql.includes('cluster_id IN')) {
          return [
            { cluster_id: 'c1', suggestions_json: JSON.stringify(idPlaces), cached_at: Date.now() },
          ];
        }
        return []; // location_key query should not be needed
      });

      const result = await photoCacheDbSuggestions.getCachedSuggestions([
        { id: 'c1', locationKey: 'geohashabc' },
      ]);

      expect(result.get('c1')).toEqual(idPlaces);
    });
  });

  describe('clusterLocationKey', () => {
    it('produces a stable key for the same centroid', () => {
      const a = photoCacheDbSuggestions.clusterLocationKey({ latitude: 41.0, longitude: 19.8 });
      const b = photoCacheDbSuggestions.clusterLocationKey({ latitude: 41.0, longitude: 19.8 });
      expect(a).toBe(b);
      expect(typeof a).toBe('string');
      expect(a.length).toBeGreaterThan(0);
    });

    it('produces different keys for far-apart centroids', () => {
      const tokyo = photoCacheDbSuggestions.clusterLocationKey({
        latitude: 35.6762,
        longitude: 139.6503,
      });
      const paris = photoCacheDbSuggestions.clusterLocationKey({
        latitude: 48.8566,
        longitude: 2.3522,
      });
      expect(tokyo).not.toBe(paris);
    });
  });

  describe('database initialization', () => {
    it('creates tables and indexes on first access', async () => {
      await photoCacheDb.getLastImportTime();

      expect(mockDb.execAsync).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE IF NOT EXISTS cached_photos')
      );
      expect(mockDb.execAsync).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE IF NOT EXISTS photo_cache_metadata')
      );
      expect(mockDb.execAsync).toHaveBeenCalledWith(
        expect.stringContaining('CREATE INDEX IF NOT EXISTS idx_cached_photos_creation_time')
      );
      expect(mockDb.execAsync).toHaveBeenCalledWith(
        expect.stringContaining('CREATE INDEX IF NOT EXISTS idx_cached_photos_country_code')
      );
      expect(mockDb.execAsync).toHaveBeenCalledWith(
        expect.stringContaining('CREATE INDEX IF NOT EXISTS idx_cached_photos_geohash')
      );
      expect(mockDb.execAsync).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE IF NOT EXISTS photo_ml_tags')
      );
      expect(mockDb.execAsync).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE IF NOT EXISTS photo_quiz_verdicts')
      );
      expect(mockDb.execAsync).toHaveBeenCalledWith(
        expect.stringContaining('CREATE INDEX IF NOT EXISTS idx_photo_ml_tags_version')
      );
    });

    it('stores schema version after initialization', async () => {
      await photoCacheDb.getLastImportTime();

      // Schema version should be stored
      expect(mockDb.runAsync).toHaveBeenCalledWith(
        'INSERT OR REPLACE INTO photo_cache_metadata (key, value) VALUES (?, ?)',
        ['schema_version', '4']
      );
    });

    it('reuses existing database connection', async () => {
      await photoCacheDb.getLastImportTime();
      await photoCacheDb.getLastImportTime();
      await photoCacheDb.getLastImportTime();

      // Should only open database once
      expect(mockedSQLite.openDatabaseAsync).toHaveBeenCalledTimes(1);
    });

    it('handles concurrent initialization requests', async () => {
      // Simulate slow database opening
      let resolveOpen: (db: unknown) => void;
      mockedSQLite.openDatabaseAsync.mockReturnValue(
        new Promise((resolve) => {
          resolveOpen = resolve as (db: unknown) => void;
        })
      );

      // Start multiple concurrent operations
      const promises = [
        photoCacheDb.getLastImportTime(),
        photoCacheDb.getLastImportTime(),
        photoCacheDb.getLastImportTime(),
      ];

      // Resolve the database opening
      resolveOpen!(mockDb);

      await Promise.all(promises);

      // Should only open database once despite concurrent requests
      expect(mockedSQLite.openDatabaseAsync).toHaveBeenCalledTimes(1);
    });
  });

  describe('getPhotosNearLocation', () => {
    // Mock geohash values — the real encode/neighbors functions are mocked below.
    // We only need to verify the SQL query uses the hashes and haversine post-filter works.
    const _CENTER_HASH = 'xn76ur';
    const _NEIGHBOR_HASHES = {
      n: 'xn76v8',
      ne: 'xn76vb',
      e: 'xn76v2',
      se: 'xn76tz',
      s: 'xn76up',
      sw: 'xn76un',
      w: 'xn76uq',
      nw: 'xn76v0',
    };

    const makeRow = (id: string, lat: number, lon: number, hash: string = 'xn76urx') => ({
      id,
      uri: `file:///photos/${id}.jpg`,
      filename: `${id}.jpg`,
      creation_time: Date.now(),
      latitude: lat,
      longitude: lon,
      geohash: hash,
      country_code: 'JP',
    });

    beforeEach(() => {
      // ngeohash is mocked via jest.doMock in the outer beforeEach,
      // but we need to set it up. Since we use jest.resetModules() each time,
      // we set it up in the outer beforeEach by adding the mock there.
    });

    it('returns empty array when no photos are within any radius tier', async () => {
      // Return rows that are all far away (>500m from center)
      // Center: 35.6762, 139.6503. A point ~1km away:
      mockDb.getAllAsync.mockResolvedValue([makeRow('far-photo', 35.685, 139.66)]);

      const result = await photoCacheDb.getPhotosNearLocation(35.6762, 139.6503);

      // haversine(35.6762, 139.6503, 35.685, 139.660) ≈ 1270m > 500m
      expect(result).toEqual([]);
    });

    it('returns photos within the 500m radius when 10 or fewer results', async () => {
      // Center: 35.6762, 139.6503. A point ~100m away:
      const nearbyLat = 35.677;
      const nearbyLon = 139.6503;
      mockDb.getAllAsync.mockResolvedValue([makeRow('nearby-photo', nearbyLat, nearbyLon)]);

      const result = await photoCacheDb.getPhotosNearLocation(35.6762, 139.6503);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('nearby-photo');
    });

    it('narrows from 500m to 200m when more than 10 results at 500m', async () => {
      // Create 15 photos: 5 within 200m, 10 more between 200-500m
      const centerLat = 35.6762;
      const centerLon = 139.6503;

      // 5 photos very close (~50m) — well within 200m
      const closePhotos = Array.from({ length: 5 }, (_, i) =>
        makeRow(`close-${i}`, centerLat + 0.0002 * (i + 1), centerLon)
      );

      // 10 photos ~350m away — within 500m but outside 200m
      const midPhotos = Array.from({ length: 10 }, (_, i) =>
        makeRow(`mid-${i}`, centerLat + 0.003, centerLon + 0.0001 * i)
      );

      mockDb.getAllAsync.mockResolvedValue([...closePhotos, ...midPhotos]);

      const result = await photoCacheDb.getPhotosNearLocation(centerLat, centerLon);

      // 15 total within 500m > MAX_BEFORE_NARROWING (10), so narrows to 200m
      // Only the 5 close photos should remain (within 200m)
      expect(result.length).toBeLessThanOrEqual(10);
      // All returned photos should have IDs starting with 'close-'
      for (const photo of result) {
        expect(photo.id).toMatch(/^close-/);
      }
    });

    it('caps results at maxResults', async () => {
      const centerLat = 35.6762;
      const centerLon = 139.6503;

      // Create 8 photos all within 100m — under the narrowing threshold
      const photos = Array.from({ length: 8 }, (_, i) =>
        makeRow(`photo-${i}`, centerLat + 0.00005 * (i + 1), centerLon)
      );
      mockDb.getAllAsync.mockResolvedValue(photos);

      const result = await photoCacheDb.getPhotosNearLocation(
        centerLat,
        centerLon,
        3 // maxResults = 3
      );

      expect(result).toHaveLength(3);
    });

    it('sorts results by distance (nearest first)', async () => {
      const centerLat = 35.6762;
      const centerLon = 139.6503;

      // Three photos at varying distances
      mockDb.getAllAsync.mockResolvedValue([
        makeRow('far', centerLat + 0.003, centerLon), // ~333m
        makeRow('near', centerLat + 0.0005, centerLon), // ~56m
        makeRow('mid', centerLat + 0.0015, centerLon), // ~167m
      ]);

      const result = await photoCacheDb.getPhotosNearLocation(centerLat, centerLon);

      expect(result.map((p) => p.id)).toEqual(['near', 'mid', 'far']);
    });

    it('builds geohash prefix query with center and all 8 neighbors', async () => {
      mockDb.getAllAsync.mockResolvedValue([]);

      await photoCacheDb.getPhotosNearLocation(35.6762, 139.6503);

      // Should query with 9 LIKE conditions (center + 8 neighbors)
      const query = mockDb.getAllAsync.mock.calls[0][0] as string;
      const likeCount = (query.match(/geohash LIKE/g) || []).length;
      expect(likeCount).toBe(9);

      // Should pass 9 hash prefix parameters
      const params = mockDb.getAllAsync.mock.calls[0][1] as string[];
      expect(params).toHaveLength(9);
    });
  });

  describe('saveClusterSplit / getClusterSplitsForParents', () => {
    it('persists both sub-clusters in a single transaction with the parent ID', async () => {
      await photoCacheDbSuggestions.saveClusterSplit(
        'parent-1',
        { id: 'parent-1__split_a', photoIds: ['p1', 'p2'] },
        { id: 'parent-1__split_b', photoIds: ['p3', 'p4'] }
      );

      expect(mockDb.withTransactionAsync).toHaveBeenCalled();
      const call = mockDb.runAsync.mock.calls.find(
        (c) => typeof c[0] === 'string' && c[0].includes('cluster_splits')
      );
      expect(call).toBeDefined();
      const [, params] = call!;
      expect(params).toEqual([
        'parent-1__split_a',
        'parent-1',
        JSON.stringify(['p1', 'p2']),
        expect.any(Number),
        'parent-1__split_b',
        'parent-1',
        JSON.stringify(['p3', 'p4']),
        expect.any(Number),
      ]);
    });

    it('returns persisted splits keyed by parent ID', async () => {
      mockDb.getAllAsync.mockResolvedValue([
        {
          sub_cluster_id: 'parent-1__split_a',
          parent_cluster_id: 'parent-1',
          photo_ids: JSON.stringify(['p1', 'p2']),
        },
        {
          sub_cluster_id: 'parent-1__split_b',
          parent_cluster_id: 'parent-1',
          photo_ids: JSON.stringify(['p3']),
        },
      ]);

      const result = await photoCacheDbSuggestions.getClusterSplitsForParents([
        'parent-1',
        'parent-2',
      ]);

      expect(result.size).toBe(1);
      const splits = result.get('parent-1');
      expect(splits).toHaveLength(2);
      expect(splits![0].photoIds).toEqual(['p1', 'p2']);
      expect(splits![1].photoIds).toEqual(['p3']);
    });

    it('returns empty map when no parent IDs are provided', async () => {
      const result = await photoCacheDbSuggestions.getClusterSplitsForParents([]);
      expect(result.size).toBe(0);
      expect(mockDb.getAllAsync).not.toHaveBeenCalled();
    });

    it('skips rows with malformed photo_ids JSON', async () => {
      mockDb.getAllAsync.mockResolvedValue([
        {
          sub_cluster_id: 'parent-1__split_a',
          parent_cluster_id: 'parent-1',
          photo_ids: 'not-json',
        },
      ]);

      const result = await photoCacheDbSuggestions.getClusterSplitsForParents(['parent-1']);
      expect(result.size).toBe(0);
    });
  });

  describe('markPhotosSaved / getAllSavedPhotoIds', () => {
    it('persists every supplied photo ID in a transaction', async () => {
      await photoCacheDbSuggestions.markPhotosSaved('cluster-1', ['p1', 'p2', 'p3']);

      expect(mockDb.withTransactionAsync).toHaveBeenCalled();
      const insertCall = mockDb.runAsync.mock.calls.find(
        (c) => typeof c[0] === 'string' && c[0].includes('saved_cluster_photos')
      );
      expect(insertCall).toBeDefined();
      const params = insertCall![1] as unknown[];
      // 3 photos × 3 columns each
      expect(params).toHaveLength(9);
      expect(params[0]).toBe('p1');
      expect(params[3]).toBe('p2');
      expect(params[6]).toBe('p3');
    });

    it('is a no-op for an empty photo list', async () => {
      await photoCacheDbSuggestions.markPhotosSaved('cluster-1', []);
      expect(mockDb.withTransactionAsync).not.toHaveBeenCalled();
      expect(mockDb.runAsync).not.toHaveBeenCalled();
    });

    it('returns the union of all saved photo IDs', async () => {
      mockDb.getAllAsync.mockResolvedValue([
        { photo_id: 'p1' },
        { photo_id: 'p2' },
        { photo_id: 'p3' },
      ]);

      const result = await photoCacheDbSuggestions.getAllSavedPhotoIds();

      expect(result).toEqual(new Set(['p1', 'p2', 'p3']));
    });
  });

  describe('clearPhotoCache (new tables)', () => {
    it('deletes cluster_splits and saved_cluster_photos rows', async () => {
      await photoCacheDb.clearPhotoCache();

      expect(mockDb.runAsync).toHaveBeenCalledWith('DELETE FROM cluster_splits');
      expect(mockDb.runAsync).toHaveBeenCalledWith('DELETE FROM saved_cluster_photos');
    });

    it('purges ML tags and quiz verdicts', async () => {
      await photoCacheDb.clearPhotoCache();

      expect(mockDb.runAsync).toHaveBeenCalledWith('DELETE FROM photo_ml_tags');
      expect(mockDb.runAsync).toHaveBeenCalledWith('DELETE FROM photo_quiz_verdicts');
    });

    it('resets the tagging-pass throttle so a re-tag can start immediately', async () => {
      await photoCacheDb.clearPhotoCache();

      expect(mockDb.runAsync).toHaveBeenCalledWith(
        "DELETE FROM photo_cache_metadata WHERE key = 'last_tagging_pass_at'"
      );
    });
  });

  describe('trip segments previewAssetIds', () => {
    it('persists previewAssetIds and reads it back', async () => {
      await photoCacheDb.saveTripSegments([
        {
          id: 'trip-1',
          countryCode: 'JP',
          startTime: 1700000000000,
          endTime: 1700009999999,
          photoCount: 2,
          clusterCount: 1,
          previewUris: ['file://a.jpg', 'file://b.jpg'],
          previewAssetIds: ['asset-a', 'asset-b'],
          clusterIds: ['c1'],
          photoIds: ['asset-a', 'asset-b'],
        },
      ]);

      // The insert must include the serialized previewAssetIds.
      const insertCall = mockDb.runAsync.mock.calls.find((c) =>
        String(c[0]).includes('INSERT INTO cached_trip_segments')
      );
      expect(insertCall).toBeDefined();
      expect(insertCall![1]).toContain(JSON.stringify(['asset-a', 'asset-b']));

      // Round-trip read.
      mockDb.getAllAsync.mockResolvedValue([
        {
          id: 'trip-1',
          country_code: 'JP',
          start_time: 1700000000000,
          end_time: 1700009999999,
          photo_count: 2,
          cluster_count: 1,
          preview_uris: JSON.stringify(['file://a.jpg', 'file://b.jpg']),
          preview_asset_ids: JSON.stringify(['asset-a', 'asset-b']),
          cluster_ids: JSON.stringify(['c1']),
          photo_ids: JSON.stringify(['asset-a', 'asset-b']),
        },
      ]);

      const [segment] = await photoCacheDb.getTripSegments();
      expect(segment.previewAssetIds).toEqual(['asset-a', 'asset-b']);
    });

    it('reads pre-migration rows (no preview_asset_ids column) as an empty array', async () => {
      mockDb.getAllAsync.mockResolvedValue([
        {
          id: 'trip-old',
          country_code: 'JP',
          start_time: 1700000000000,
          end_time: 1700009999999,
          photo_count: 1,
          cluster_count: 1,
          preview_uris: JSON.stringify(['file://a.jpg']),
          // preview_asset_ids intentionally absent (old row, pre-migration)
          cluster_ids: JSON.stringify(['c1']),
          photo_ids: JSON.stringify(['asset-a']),
        },
      ]);

      const [segment] = await photoCacheDb.getTripSegments();
      expect(segment.previewAssetIds).toEqual([]);
      // The rest of the row still reads correctly.
      expect(segment.previewUris).toEqual(['file://a.jpg']);
    });
  });
});
