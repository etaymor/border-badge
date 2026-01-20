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
    });

    it('stores schema version after initialization', async () => {
      await photoCacheDb.getLastImportTime();

      // Schema version should be stored
      expect(mockDb.runAsync).toHaveBeenCalledWith(
        'INSERT OR REPLACE INTO photo_cache_metadata (key, value) VALUES (?, ?)',
        ['schema_version', '1']
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
});
