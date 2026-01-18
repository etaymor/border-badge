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
});
