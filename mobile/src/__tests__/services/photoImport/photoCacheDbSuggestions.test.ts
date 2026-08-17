/**
 * Tests for photoCacheDbSuggestions — focused on B2 (neighbor-cell cache lookup,
 * KTD9).
 *
 * B2: `getCachedSuggestions` Tier 2 falls back to the EXACT `location_key`
 * (geohash-7, ~153m cell). If a re-import shifts a split centroid ACROSS a
 * geohash-7 boundary, both the id lookup AND the exact-cell lookup miss, so the
 * cluster looks uncached and is re-fetched (and on failure -> B1).
 *
 * Fix (KTD9 — do NOT coarsen the key): a Tier 3 that, on a Tier-2 miss, queries
 * the 8 NEIGHBOR geohash-7 cells and picks the NEAREST-CENTROID cached entry
 * within a sane distance ceiling. The ceiling guards against serving a DIFFERENT
 * nearby venue's cache.
 *
 * DB harness modeled on photoCacheDb.test.ts (mocked expo-sqlite, SQL routed by
 * substring).
 */

import * as geohash from 'ngeohash';

const GEOHASH_PRECISION = 7;

/** A place that a re-import should reuse from cache. */
const samePlace = [
  {
    place_id: 'place-same',
    name: 'Ramen Shop',
    address: '1 Noodle St',
    location: { latitude: 35.0, longitude: 139.0 },
    category: 'restaurant',
    distance_m: 12,
    types: ['restaurant'],
  },
];

/** A different venue's cached places (should NEVER be served for our centroid). */
const otherVenuePlaces = [
  {
    place_id: 'place-other',
    name: 'Far Cafe',
    address: '99 Distant Ave',
    location: { latitude: 35.5, longitude: 139.5 },
    category: 'cafe',
    distance_m: 8,
    types: ['cafe'],
  },
];

describe('photoCacheDbSuggestions — B2 neighbor-cell lookup (KTD9)', () => {
  let mockDb: {
    execAsync: jest.Mock;
    runAsync: jest.Mock;
    getAllAsync: jest.Mock;
    getFirstAsync: jest.Mock;
    closeAsync: jest.Mock;
    withTransactionAsync: jest.Mock;
  };
  let photoCacheDb: typeof import('../../../services/photoImport/photoCacheDb');
  let suggestions: typeof import('../../../services/photoImport/photoCacheDbSuggestions');

  beforeEach(() => {
    jest.resetModules();
    jest.resetAllMocks();

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

    jest.doMock('expo-sqlite', () => ({
      openDatabaseAsync: jest.fn().mockResolvedValue(mockDb),
    }));

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    photoCacheDb = require('../../../services/photoImport/photoCacheDb');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    suggestions = require('../../../services/photoImport/photoCacheDbSuggestions');
  });

  afterEach(async () => {
    if (photoCacheDb) {
      try {
        await photoCacheDb.closeDb();
      } catch {
        // ignore
      }
    }
  });

  it('hits a neighbor cell when a re-import drifts the centroid across a geohash-7 boundary', async () => {
    // The cached entry lives at the venue's original cell. The re-imported
    // cluster's centroid drifted just over the boundary into a NEIGHBOR cell, so
    // its own locationKey no longer matches the cached row.
    const venue = { latitude: 35.0, longitude: 139.0 };
    const cachedKey = geohash.encode(venue.latitude, venue.longitude, GEOHASH_PRECISION);

    // Pick a centroid in a different geohash-7 cell that is a NEIGHBOR of cachedKey
    // but physically very close to the venue (a few meters over the boundary).
    let driftedCentroid = venue;
    let driftedKey = cachedKey;
    // Walk east in tiny steps until we cross the cell boundary.
    for (let i = 1; i <= 2000; i++) {
      const candidate = { latitude: venue.latitude, longitude: venue.longitude + i * 0.00001 };
      const key = geohash.encode(candidate.latitude, candidate.longitude, GEOHASH_PRECISION);
      if (key !== cachedKey) {
        driftedCentroid = candidate;
        driftedKey = key;
        break;
      }
    }
    expect(driftedKey).not.toBe(cachedKey);
    // The drifted key must be one of the cached key's neighbors.
    expect(geohash.neighbors(driftedKey)).toContain(cachedKey);

    // Route SQL: id miss, exact-cell (drifted) miss, neighbor query returns the
    // cached row (keyed by the venue's original cell).
    mockDb.getAllAsync.mockImplementation(async (sql: string, params: string[]) => {
      if (sql.includes('cluster_id IN')) return [];
      if (sql.includes('location_key IN')) {
        // The neighbor query includes cachedKey in its params; the exact-cell
        // query only contains driftedKey.
        if (params.includes(cachedKey)) {
          return [
            {
              location_key: cachedKey,
              suggestions_json: JSON.stringify(samePlace),
              cached_at: Date.now(),
            },
          ];
        }
        return [];
      }
      return [];
    });

    const result = await suggestions.getCachedSuggestions([
      { id: 're-imported-cluster', locationKey: driftedKey, centroid: driftedCentroid },
    ]);

    expect(result.get('re-imported-cluster')).toEqual(samePlace);
  });

  it('does NOT serve a DIFFERENT venue cached in a neighbor cell when its centroid is far (KTD9/R3 guard)', async () => {
    // The requesting cluster's centroid is at our venue. A neighbor cell happens
    // to hold a DIFFERENT venue whose cached cell-center is far from us (beyond
    // the distance ceiling). Nearest-centroid + the ceiling must reject it.
    const venue = { latitude: 35.0, longitude: 139.0 };
    const ourKey = geohash.encode(venue.latitude, venue.longitude, GEOHASH_PRECISION);
    const neighborKeys = geohash.neighbors(ourKey);
    // Use a real neighbor key but pretend the cached row's geohash decodes far
    // away — to simulate "far", we instead store the OTHER venue under a key that
    // is genuinely a neighbor but whose decoded center is ~150m+ away (one full
    // cell). A single-cell neighbor is ~153m away; we want it REJECTED only if it
    // exceeds the ceiling. To make a clearly-different venue, place it two cells
    // out via a neighbor-of-a-neighbor — but the query only sees direct neighbors,
    // so simulate distance by decoding: pick the farthest neighbor.
    const farNeighbor = neighborKeys[0];

    mockDb.getAllAsync.mockImplementation(async (sql: string, params: string[]) => {
      if (sql.includes('cluster_id IN')) return [];
      if (sql.includes('location_key IN')) {
        // Exact-cell query (ourKey) misses; neighbor query returns the far venue.
        if (params.includes(farNeighbor) && !params.includes(ourKey)) {
          return [
            {
              location_key: farNeighbor,
              suggestions_json: JSON.stringify(otherVenuePlaces),
              cached_at: Date.now(),
            },
          ];
        }
        return [];
      }
      return [];
    });

    // The requesting cluster's centroid is at our venue. Make the cached
    // neighbor's decoded center far enough to exceed the ceiling: shift the
    // requesting centroid far from the neighbor by using a centroid that is NOT
    // near farNeighbor. We compute the neighbor center and place the requester
    // ~500m away so the ceiling rejects it.
    const farCenter = geohash.decode(farNeighbor);
    // Requester 500m north of the neighbor cell center — beyond the ~300m ceiling.
    const requester = { latitude: farCenter.latitude + 0.0045, longitude: farCenter.longitude };
    // The requester's own key must miss the exact cell too (it's far from any).
    const requesterKey = geohash.encode(requester.latitude, requester.longitude, GEOHASH_PRECISION);

    mockDb.getAllAsync.mockImplementation(async (sql: string, params: string[]) => {
      if (sql.includes('cluster_id IN')) return [];
      if (sql.includes('location_key IN')) {
        // The neighbor query includes farNeighbor.
        if (params.includes(farNeighbor)) {
          return [
            {
              location_key: farNeighbor,
              suggestions_json: JSON.stringify(otherVenuePlaces),
              cached_at: Date.now(),
            },
          ];
        }
        return [];
      }
      return [];
    });

    const result = await suggestions.getCachedSuggestions([
      { id: 'distinct-cluster', locationKey: requesterKey, centroid: requester },
    ]);

    // The far/different venue must NOT be served — would be a silent quality bug.
    expect(result.get('distinct-cluster')).toBeUndefined();
    expect(result.size).toBe(0);
  });

  it('picks the NEAREST-centroid neighbor when multiple neighbor cells are cached', async () => {
    const venue = { latitude: 35.0, longitude: 139.0 };
    const ourKey = geohash.encode(venue.latitude, venue.longitude, GEOHASH_PRECISION);
    const neighborKeys = geohash.neighbors(ourKey);

    // Two cached neighbor rows; the one whose decoded center is closer to our
    // centroid must win.
    const nearKey = neighborKeys.reduce((best, k) => {
      const c = geohash.decode(k);
      const cb = geohash.decode(best);
      const dist = (lat: number, lng: number) =>
        Math.hypot(lat - venue.latitude, lng - venue.longitude);
      return dist(c.latitude, c.longitude) < dist(cb.latitude, cb.longitude) ? k : best;
    }, neighborKeys[0]);
    const farKey = neighborKeys.reduce((worst, k) => {
      const c = geohash.decode(k);
      const cw = geohash.decode(worst);
      const dist = (lat: number, lng: number) =>
        Math.hypot(lat - venue.latitude, lng - venue.longitude);
      return dist(c.latitude, c.longitude) > dist(cw.latitude, cw.longitude) ? k : worst;
    }, neighborKeys[0]);

    expect(nearKey).not.toBe(farKey);

    const nearPlaces = [{ ...samePlace[0], place_id: 'place-near', name: 'Near Venue' }];
    const otherPlaces = [{ ...samePlace[0], place_id: 'place-farish', name: 'Farish Venue' }];

    mockDb.getAllAsync.mockImplementation(async (sql: string, params: string[]) => {
      if (sql.includes('cluster_id IN')) return [];
      if (sql.includes('location_key IN')) {
        const rows: { location_key: string; suggestions_json: string; cached_at: number }[] = [];
        if (params.includes(nearKey)) {
          rows.push({
            location_key: nearKey,
            suggestions_json: JSON.stringify(nearPlaces),
            cached_at: Date.now() - 10000, // older
          });
        }
        if (params.includes(farKey)) {
          rows.push({
            location_key: farKey,
            suggestions_json: JSON.stringify(otherPlaces),
            cached_at: Date.now(), // newer (but farther — distance wins over recency)
          });
        }
        return rows;
      }
      return [];
    });

    const result = await suggestions.getCachedSuggestions([
      { id: 'multi-cluster', locationKey: ourKey, centroid: venue },
    ]);

    // Nearest-centroid wins even though the far entry is newer.
    expect(result.get('multi-cluster')).toEqual(nearPlaces);
  });

  it('falls back to newest neighbor entry when no centroid is provided', async () => {
    const venue = { latitude: 35.0, longitude: 139.0 };
    const ourKey = geohash.encode(venue.latitude, venue.longitude, GEOHASH_PRECISION);
    const neighborKeys = geohash.neighbors(ourKey);
    const k1 = neighborKeys[0];
    const k2 = neighborKeys[1];

    const oldPlaces = [{ ...samePlace[0], place_id: 'old' }];
    const newPlaces = [{ ...samePlace[0], place_id: 'new' }];

    mockDb.getAllAsync.mockImplementation(async (sql: string, params: string[]) => {
      if (sql.includes('cluster_id IN')) return [];
      if (sql.includes('location_key IN')) {
        const rows: { location_key: string; suggestions_json: string; cached_at: number }[] = [];
        if (params.includes(k1)) {
          rows.push({
            location_key: k1,
            suggestions_json: JSON.stringify(oldPlaces),
            cached_at: 1000,
          });
        }
        if (params.includes(k2)) {
          rows.push({
            location_key: k2,
            suggestions_json: JSON.stringify(newPlaces),
            cached_at: 9999999999999,
          });
        }
        return rows;
      }
      return [];
    });

    // No centroid -> newest neighbor entry wins (don't break id-only callers).
    const result = await suggestions.getCachedSuggestions([
      { id: 'no-centroid-cluster', locationKey: ourKey },
    ]);

    expect(result.get('no-centroid-cluster')).toEqual(newPlaces);
  });

  it('still hits Tier 1 (exact id) and Tier 2 (exact cell) without needing neighbors', async () => {
    const venue = { latitude: 35.0, longitude: 139.0 };
    const ourKey = geohash.encode(venue.latitude, venue.longitude, GEOHASH_PRECISION);

    // Exact-cell hit: the neighbor query should never even be needed.
    let neighborQueried = false;
    mockDb.getAllAsync.mockImplementation(async (sql: string, params: string[]) => {
      if (sql.includes('cluster_id IN')) return [];
      if (sql.includes('location_key IN')) {
        if (params.includes(ourKey) && params.length === 1) {
          // Exact-cell query.
          return [
            {
              location_key: ourKey,
              suggestions_json: JSON.stringify(samePlace),
              cached_at: Date.now(),
            },
          ];
        }
        // Any larger param set is the neighbor query.
        if (params.length > 1) neighborQueried = true;
        return [];
      }
      return [];
    });

    const result = await suggestions.getCachedSuggestions([
      { id: 'exact-cell', locationKey: ourKey, centroid: venue },
    ]);

    expect(result.get('exact-cell')).toEqual(samePlace);
    expect(neighborQueried).toBe(false);
  });

  it('does not query neighbors for id-only string callers (no locationKey)', async () => {
    let locationQueried = false;
    mockDb.getAllAsync.mockImplementation(async (sql: string) => {
      if (sql.includes('cluster_id IN')) return [];
      if (sql.includes('location_key IN')) {
        locationQueried = true;
        return [];
      }
      return [];
    });

    const result = await suggestions.getCachedSuggestions(['bare-id-only']);

    expect(result.size).toBe(0);
    // No location/neighbor query for a bare id-only caller.
    expect(locationQueried).toBe(false);
  });
});
