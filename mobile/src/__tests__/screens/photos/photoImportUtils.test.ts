/**
 * Tests for photoImportUtils - payload construction for the suggest-places API.
 */

// Mock expo-location before any imports
jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(),
  reverseGeocodeAsync: jest.fn(),
}));

import {
  mapClusterToApiPayload,
  truncateCoordinate,
} from '../../../screens/photos/photoImportUtils';
import type { LocationCluster, PhotoWithLocation } from '../../../services/photoImport/types';

function createPhoto(
  id: string,
  lat: number,
  lng: number,
  date: Date = new Date('2024-03-15T12:00:00Z')
): PhotoWithLocation {
  return {
    id,
    uri: `file://${id}.jpg`,
    filename: `${id}.jpg`,
    creationTime: date,
    location: { latitude: lat, longitude: lng },
  };
}

function createCluster(overrides: Partial<LocationCluster> = {}): LocationCluster {
  const start = new Date('2024-03-15T12:00:00Z');
  const end = new Date('2024-03-15T13:30:00Z');
  return {
    id: 'test-cluster-1',
    geohash: 'xn76urh',
    centroid: { latitude: 35.676234567, longitude: 139.650345678 },
    photos: [createPhoto('photo-1', 35.676234567, 139.650345678, start)],
    timeRange: { start, end },
    countryCode: 'JP',
    ...overrides,
  };
}

describe('mapClusterToApiPayload', () => {
  it('includes time_hint computed from cluster time range', () => {
    // 90-min dwell => "attraction" (long dwell takes priority over meal time)
    const cluster = createCluster();
    const payload = mapClusterToApiPayload(cluster, []);

    expect(payload.time_hint).toBe('attraction');
    expect(payload.start_time).toBe('2024-03-15T12:00:00.000Z');
    expect(payload.end_time).toBe('2024-03-15T13:30:00.000Z');
  });

  it('includes vision_images_base64 when images are available', () => {
    const cluster = createCluster();
    const visionImages = ['base64img1', 'base64img2'];

    const payload = mapClusterToApiPayload(cluster, visionImages);

    expect(payload.vision_images_base64).toEqual(['base64img1', 'base64img2']);
  });

  it('omits vision_images_base64 when no images available', () => {
    const cluster = createCluster();

    const payload = mapClusterToApiPayload(cluster, []);

    expect(payload.vision_images_base64).toBeUndefined();
  });

  it('truncates coordinates to 5 decimal places', () => {
    const cluster = createCluster({
      centroid: { latitude: 35.676234567, longitude: 139.650345678 },
    });

    const payload = mapClusterToApiPayload(cluster, []);

    expect(payload.centroid.latitude).toBe(35.67623);
    expect(payload.centroid.longitude).toBe(139.65035);
  });

  it('maps photo metadata correctly', () => {
    const date = new Date('2024-03-15T14:30:00Z');
    const cluster = createCluster({
      photos: [createPhoto('p1', 35.676234567, 139.650345678, date)],
    });

    const payload = mapClusterToApiPayload(cluster, []);

    expect(payload.photos).toHaveLength(1);
    expect(payload.photos[0].asset_id).toBe('p1');
    expect(payload.photos[0].timestamp).toBe('2024-03-15T14:30:00.000Z');
    expect(payload.photos[0].latitude).toBe(35.67623);
    expect(payload.photos[0].longitude).toBe(139.65035);
  });

  it('preserves cluster id', () => {
    const cluster = createCluster({ id: 'my-cluster-id' });
    const payload = mapClusterToApiPayload(cluster, []);
    expect(payload.id).toBe('my-cluster-id');
  });
});

describe('truncateCoordinate', () => {
  it('truncates to 5 decimal places', () => {
    expect(truncateCoordinate(35.676234567)).toBe(35.67623);
    expect(truncateCoordinate(139.650345678)).toBe(139.65035);
  });

  it('handles values with fewer decimals', () => {
    expect(truncateCoordinate(35.6)).toBe(35.6);
    expect(truncateCoordinate(35)).toBe(35);
  });
});
