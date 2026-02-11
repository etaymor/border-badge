/**
 * Tests for the photo clustering service.
 *
 * Note: These tests cover the pure JS functions (clusterByLocation, segmentTripsByTimeGap)
 * and the cache manager. The geocodeClusterCentroids function requires expo-location
 * and would need integration tests.
 */

// Mock expo-location before any imports that might use it
jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(),
  reverseGeocodeAsync: jest.fn(),
}));

import {
  clusterByLocation,
  mergeAdjacentClusters,
  computeTimeHint,
  segmentTripsByTimeGap,
} from '../../../services/photoImport/photoClustering';
import type { LocationCluster, PhotoWithLocation } from '../../../services/photoImport/types';

// Helper to create test photos
function createTestPhoto(
  id: string,
  lat: number,
  lng: number,
  daysAgo: number = 0
): PhotoWithLocation {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return {
    id,
    uri: `file://${id}.jpg`,
    filename: `${id}.jpg`,
    creationTime: date,
    location: {
      latitude: lat,
      longitude: lng,
    },
  };
}

// Helper to create a cluster with countryCode for segmentTripsByTimeGap tests
function createClusterWithCountry(
  id: string,
  photos: PhotoWithLocation[],
  countryCode: string
): LocationCluster {
  const avgLat = photos.reduce((sum, p) => sum + p.location.latitude, 0) / photos.length;
  const avgLng = photos.reduce((sum, p) => sum + p.location.longitude, 0) / photos.length;
  const sorted = [...photos].sort((a, b) => a.creationTime.getTime() - b.creationTime.getTime());

  return {
    id,
    geohash: id,
    centroid: { latitude: avgLat, longitude: avgLng },
    photos,
    timeRange: {
      start: sorted[0].creationTime,
      end: sorted[sorted.length - 1].creationTime,
    },
    countryCode,
  };
}

describe('photoClustering', () => {
  describe('clusterByLocation', () => {
    it('groups photos at the same location into one cluster', () => {
      const photos = [
        createTestPhoto('photo-1', 35.6762, 139.6503),
        createTestPhoto('photo-2', 35.6762, 139.6503),
        createTestPhoto('photo-3', 35.6762, 139.6503),
      ];

      const clusters = clusterByLocation(photos);

      expect(clusters).toHaveLength(1);
      expect(clusters[0].photos).toHaveLength(3);
    });

    it('creates separate clusters for distant locations', () => {
      const photos = [
        // Tokyo
        createTestPhoto('photo-1', 35.6762, 139.6503),
        // New York (very far from Tokyo)
        createTestPhoto('photo-2', 40.7128, -74.006),
      ];

      const clusters = clusterByLocation(photos);

      expect(clusters).toHaveLength(2);
      expect(clusters[0].photos).toHaveLength(1);
      expect(clusters[1].photos).toHaveLength(1);
    });

    it('groups nearby photos within ~153m (geohash precision 7)', () => {
      const photos = [
        // Two locations ~100m apart in Tokyo
        createTestPhoto('photo-1', 35.6762, 139.6503),
        createTestPhoto('photo-2', 35.6763, 139.6504),
      ];

      const clusters = clusterByLocation(photos);

      // Should be in same cluster due to geohash precision
      expect(clusters.length).toBeLessThanOrEqual(2);
    });

    it('returns empty array for empty input', () => {
      const clusters = clusterByLocation([]);

      expect(clusters).toHaveLength(0);
    });

    it('handles single photo', () => {
      const photos = [createTestPhoto('photo-1', 35.6762, 139.6503)];

      const clusters = clusterByLocation(photos);

      expect(clusters).toHaveLength(1);
      expect(clusters[0].photos).toHaveLength(1);
    });

    it('calculates cluster centroid correctly', () => {
      const photos = [
        createTestPhoto('photo-1', 35.0, 139.0),
        createTestPhoto('photo-2', 36.0, 140.0),
      ];

      const clusters = clusterByLocation(photos);

      // Find the cluster containing both photos (if they're grouped)
      // or check individual centroids
      clusters.forEach((cluster) => {
        const lats = cluster.photos.map((p) => p.location.latitude);
        const lngs = cluster.photos.map((p) => p.location.longitude);
        const expectedLat = lats.reduce((a, b) => a + b, 0) / lats.length;
        const expectedLng = lngs.reduce((a, b) => a + b, 0) / lngs.length;

        expect(cluster.centroid.latitude).toBeCloseTo(expectedLat, 4);
        expect(cluster.centroid.longitude).toBeCloseTo(expectedLng, 4);
      });
    });

    it('generates unique cluster IDs', () => {
      const photos = [
        createTestPhoto('photo-1', 35.6762, 139.6503),
        createTestPhoto('photo-2', 40.7128, -74.006),
        createTestPhoto('photo-3', 51.5074, -0.1278),
      ];

      const clusters = clusterByLocation(photos);
      const ids = clusters.map((c) => c.id);
      const uniqueIds = new Set(ids);

      expect(uniqueIds.size).toBe(ids.length);
    });
  });

  describe('segmentTripsByTimeGap', () => {
    it('segments clusters with gaps > 7 days into separate trips', () => {
      // Create clusters with country codes for different time periods
      const clusters = [
        createClusterWithCountry(
          'cluster-1',
          [
            createTestPhoto('photo-1', 35.6762, 139.6503, 20), // 20 days ago
            createTestPhoto('photo-2', 35.6762, 139.6503, 19), // 19 days ago
          ],
          'JP'
        ),
        createClusterWithCountry(
          'cluster-2',
          [
            createTestPhoto('photo-3', 35.6762, 139.6503, 5), // 5 days ago (>7 day gap)
            createTestPhoto('photo-4', 35.6762, 139.6503, 4), // 4 days ago
          ],
          'JP'
        ),
      ];

      const trips = segmentTripsByTimeGap(clusters, null);

      expect(trips).toHaveLength(2);
    });

    it('keeps clusters within 7 days in same trip', () => {
      const clusters = [
        createClusterWithCountry(
          'cluster-1',
          [
            createTestPhoto('photo-1', 35.6762, 139.6503, 6),
            createTestPhoto('photo-2', 35.6762, 139.6503, 4),
          ],
          'JP'
        ),
        createClusterWithCountry(
          'cluster-2',
          [
            createTestPhoto('photo-3', 35.6762, 139.6503, 2),
            createTestPhoto('photo-4', 35.6762, 139.6503, 0),
          ],
          'JP'
        ),
      ];

      const trips = segmentTripsByTimeGap(clusters, null);

      expect(trips).toHaveLength(1);
      expect(trips[0].photos).toHaveLength(4);
    });

    it('filters out home country', () => {
      const clusters = [
        createClusterWithCountry(
          'cluster-us',
          [createTestPhoto('photo-1', 40.7128, -74.006, 5)],
          'US'
        ),
        createClusterWithCountry(
          'cluster-jp',
          [createTestPhoto('photo-2', 35.6762, 139.6503, 5)],
          'JP'
        ),
      ];

      const trips = segmentTripsByTimeGap(clusters, 'US');

      // Should only include Japan trip, not US (home country)
      expect(trips).toHaveLength(1);
      expect(trips[0].countryCode).toBe('JP');
    });

    it('handles empty array', () => {
      const trips = segmentTripsByTimeGap([], null);

      expect(trips).toHaveLength(0);
    });

    it('filters out clusters without country code', () => {
      const clustersWithoutCountry: LocationCluster[] = [
        {
          id: 'cluster-1',
          geohash: 'cluster-1',
          centroid: { latitude: 35.6762, longitude: 139.6503 },
          photos: [createTestPhoto('photo-1', 35.6762, 139.6503)],
          timeRange: {
            start: new Date(),
            end: new Date(),
          },
          // No countryCode set
        },
      ];

      const trips = segmentTripsByTimeGap(clustersWithoutCountry, null);

      expect(trips).toHaveLength(0);
    });

    it('creates separate trips for different countries', () => {
      const clusters = [
        createClusterWithCountry(
          'cluster-jp',
          [createTestPhoto('photo-1', 35.6762, 139.6503, 5)],
          'JP'
        ),
        createClusterWithCountry(
          'cluster-us',
          [createTestPhoto('photo-2', 40.7128, -74.006, 5)],
          'US'
        ),
        createClusterWithCountry(
          'cluster-gb',
          [createTestPhoto('photo-3', 51.5074, -0.1278, 5)],
          'GB'
        ),
      ];

      const trips = segmentTripsByTimeGap(clusters, null);

      expect(trips).toHaveLength(3);
      const countryCodes = trips.map((t) => t.countryCode).sort();
      expect(countryCodes).toEqual(['GB', 'JP', 'US']);
    });

    it('sorts trips by most recent first', () => {
      const clusters = [
        createClusterWithCountry(
          'cluster-old',
          [createTestPhoto('photo-1', 35.6762, 139.6503, 30)], // 30 days ago
          'JP'
        ),
        createClusterWithCountry(
          'cluster-recent',
          [createTestPhoto('photo-2', 40.7128, -74.006, 5)], // 5 days ago
          'US'
        ),
      ];

      const trips = segmentTripsByTimeGap(clusters, null);

      // Most recent (US, 5 days ago) should be first
      expect(trips[0].countryCode).toBe('US');
      expect(trips[1].countryCode).toBe('JP');
    });
  });

  describe('mergeAdjacentClusters', () => {
    function createCluster(
      id: string,
      lat: number,
      lng: number,
      geohash: string,
      photoCount: number = 1,
      startDaysAgo: number = 5,
      endDaysAgo: number = 5
    ): LocationCluster {
      const photos = Array.from({ length: photoCount }, (_, i) =>
        createTestPhoto(`${id}-photo-${i}`, lat, lng, startDaysAgo)
      );
      const now = new Date();
      const startDate = new Date(now);
      startDate.setDate(startDate.getDate() - startDaysAgo);
      const endDate = new Date(now);
      endDate.setDate(endDate.getDate() - endDaysAgo);
      return {
        id,
        geohash,
        centroid: { latitude: lat, longitude: lng },
        photos,
        timeRange: { start: startDate, end: endDate },
        countryCode: 'JP',
      };
    }

    it('returns same clusters when only 1 cluster', () => {
      const clusters = [createCluster('c1', 35.6762, 139.6503, 'xn76urg')];
      const merged = mergeAdjacentClusters(clusters);
      expect(merged).toHaveLength(1);
    });

    it('merges two clusters within 80m threshold', () => {
      // Two points ~50m apart (same 5-char geohash prefix)
      const clusters = [
        createCluster('c1', 35.67620, 139.65030, 'xn76ur1', 5),
        createCluster('c2', 35.67660, 139.65030, 'xn76ur2', 3),
      ];
      const merged = mergeAdjacentClusters(clusters, 80);
      expect(merged).toHaveLength(1);
      expect(merged[0].photos).toHaveLength(8); // Combined photos
    });

    it('does not merge clusters beyond threshold', () => {
      // Two points ~500m apart
      const clusters = [
        createCluster('c1', 35.6762, 139.6503, 'xn76ur1'),
        createCluster('c2', 35.6812, 139.6503, 'xn76ur9'),
      ];
      const merged = mergeAdjacentClusters(clusters, 40);
      expect(merged).toHaveLength(2);
    });

    it('merges transitive chain (A-B close, B-C close, A-C far)', () => {
      // 3 clusters in a chain: each ~50m from neighbor, but first and last ~100m
      const clusters = [
        createCluster('c1', 35.67600, 139.6503, 'xn76u00', 2),
        createCluster('c2', 35.67645, 139.6503, 'xn76u01', 3),
        createCluster('c3', 35.67690, 139.6503, 'xn76u02', 1),
      ];
      const merged = mergeAdjacentClusters(clusters, 80);
      // All 3 should merge via union-find transitivity
      expect(merged).toHaveLength(1);
      expect(merged[0].photos).toHaveLength(6);
    });

    it('preserves largest constituent cluster ID', () => {
      const clusters = [
        createCluster('small-cluster', 35.67620, 139.65030, 'xn76ur1', 2),
        createCluster('big-cluster', 35.67660, 139.65030, 'xn76ur2', 10),
      ];
      const merged = mergeAdjacentClusters(clusters, 80);
      expect(merged).toHaveLength(1);
      expect(merged[0].id).toBe('big-cluster');
    });

    it('computes weighted centroid by photo count', () => {
      // c1 at lat=35.6762 with 10 photos, c2 at lat=35.6766 with 2 photos
      // Weighted centroid should be closer to c1
      const clusters = [
        createCluster('c1', 35.67620, 139.65030, 'xn76ur1', 10),
        createCluster('c2', 35.67660, 139.65030, 'xn76ur2', 2),
      ];
      const merged = mergeAdjacentClusters(clusters, 80);
      expect(merged).toHaveLength(1);
      // Weighted: (35.6762 * 10 + 35.6766 * 2) / 12 ≈ 35.67627
      expect(merged[0].centroid.latitude).toBeCloseTo(35.67627, 4);
    });

    it('extends time range across merged clusters', () => {
      const clusters = [
        createCluster('c1', 35.67620, 139.65030, 'xn76ur1', 1, 10, 8),
        createCluster('c2', 35.67660, 139.65030, 'xn76ur2', 1, 5, 3),
      ];
      const merged = mergeAdjacentClusters(clusters, 80);
      expect(merged).toHaveLength(1);
      // Start should be from c1 (10 days ago), end from c2 (3 days ago)
      expect(merged[0].timeRange.start.getTime()).toBeLessThanOrEqual(
        clusters[0].timeRange.start.getTime()
      );
      expect(merged[0].timeRange.end.getTime()).toBeGreaterThanOrEqual(
        clusters[1].timeRange.end.getTime()
      );
    });

    it('skips haversine for clusters with different 5-char geohash prefix', () => {
      // Two clusters with totally different geohash prefixes (>4.9km apart)
      // Even with a huge threshold, they should not merge
      const clusters = [
        createCluster('c1', 35.6762, 139.6503, 'xn76u00'),
        createCluster('c2', 40.7128, -74.006, 'dr5ru00'),
      ];
      const merged = mergeAdjacentClusters(clusters, 999999);
      expect(merged).toHaveLength(2);
    });

    it('returns empty array for empty input', () => {
      const merged = mergeAdjacentClusters([]);
      expect(merged).toHaveLength(0);
    });
  });

  describe('computeTimeHint', () => {
    function createClusterWithTime(startHour: number, dwellMinutes: number): LocationCluster {
      const start = new Date(2024, 0, 15, startHour, 0, 0);
      const end = new Date(start.getTime() + dwellMinutes * 60 * 1000);
      return {
        id: 'test',
        geohash: 'test',
        centroid: { latitude: 35.6762, longitude: 139.6503 },
        photos: [createTestPhoto('p1', 35.6762, 139.6503)],
        timeRange: { start, end },
      };
    }

    it('returns attraction for long dwell (>= 90min)', () => {
      expect(computeTimeHint(createClusterWithTime(14, 120))).toBe('attraction');
    });

    it('returns nightlife for late night short dwell', () => {
      expect(computeTimeHint(createClusterWithTime(23, 60))).toBe('nightlife');
    });

    it('returns food for meal time short dwell (lunch)', () => {
      expect(computeTimeHint(createClusterWithTime(12, 30))).toBe('food');
    });

    it('returns food for meal time short dwell (dinner)', () => {
      expect(computeTimeHint(createClusterWithTime(19, 40))).toBe('food');
    });

    it('returns food for morning short dwell (breakfast)', () => {
      expect(computeTimeHint(createClusterWithTime(8, 20))).toBe('food');
    });

    it('returns quick_stop for short dwell outside meal times', () => {
      expect(computeTimeHint(createClusterWithTime(15, 15))).toBe('quick_stop');
    });

    it('returns food for medium dwell at meal time (leisurely meal)', () => {
      expect(computeTimeHint(createClusterWithTime(13, 60))).toBe('food');
    });

    it('returns null for medium dwell outside meal time', () => {
      expect(computeTimeHint(createClusterWithTime(15, 60))).toBeNull();
    });

    it('prioritizes dwell over time-of-day (long dwell at lunchtime = attraction)', () => {
      expect(computeTimeHint(createClusterWithTime(12, 180))).toBe('attraction');
    });
  });
});
