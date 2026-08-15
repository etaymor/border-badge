/**
 * Tests for vision photo selection and preparation.
 */

jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(),
  SaveFormat: { JPEG: 'jpeg' },
}));

jest.mock('react-native', () => ({
  Image: { getSize: jest.fn() },
}));

import * as ImageManipulator from 'expo-image-manipulator';
import { Image } from 'react-native';
import {
  selectRepresentativePhoto,
  selectRepresentativePhotos,
  prepareVisionImage,
  getVisionImagesForCluster,
} from '../../../services/photoImport/visionPhoto';
import type { LocationCluster, PhotoWithLocation } from '../../../services/photoImport/types';

function createPhoto(id: string, lat: number, lng: number, daysAgo: number = 0): PhotoWithLocation {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return {
    id,
    uri: `file://${id}.jpg`,
    filename: `${id}.jpg`,
    creationTime: date,
    location: { latitude: lat, longitude: lng },
  };
}

function createCluster(
  photos: PhotoWithLocation[],
  centroidLat: number,
  centroidLng: number
): LocationCluster {
  const sorted = [...photos].sort((a, b) => a.creationTime.getTime() - b.creationTime.getTime());
  return {
    id: 'cluster-1',
    geohash: 'xn76urh',
    centroid: { latitude: centroidLat, longitude: centroidLng },
    photos,
    timeRange: {
      start: sorted[0].creationTime,
      end: sorted[sorted.length - 1].creationTime,
    },
  };
}

describe('selectRepresentativePhoto', () => {
  it('returns null for empty cluster', () => {
    const cluster = createCluster([createPhoto('p1', 35.6762, 139.6503)], 35.6762, 139.6503);
    cluster.photos = [];
    expect(selectRepresentativePhoto(cluster)).toBeNull();
  });

  it('returns the only photo for single-photo cluster', () => {
    const photo = createPhoto('p1', 35.6762, 139.6503);
    const cluster = createCluster([photo], 35.6762, 139.6503);

    const result = selectRepresentativePhoto(cluster);
    expect(result?.id).toBe('p1');
  });

  it('returns the photo closest to centroid', () => {
    // Centroid is at 35.6762, 139.6503
    // Photo p1 is at the centroid (0m away)
    // Photo p2 is ~100m away
    // Photo p3 is ~200m away
    const p1 = createPhoto('p1', 35.6762, 139.6503);
    const p2 = createPhoto('p2', 35.6772, 139.6503); // ~111m north
    const p3 = createPhoto('p3', 35.6782, 139.6503); // ~222m north

    const cluster = createCluster([p3, p2, p1], 35.6762, 139.6503);

    const result = selectRepresentativePhoto(cluster);
    expect(result?.id).toBe('p1');
  });

  it('picks closest even when not first in array', () => {
    // Centroid near p3
    const p1 = createPhoto('p1', 35.6762, 139.6503);
    const p2 = createPhoto('p2', 35.6772, 139.6503);
    const p3 = createPhoto('p3', 35.6782, 139.6503);

    // Centroid near p3
    const cluster = createCluster([p1, p2, p3], 35.6782, 139.6503);

    const result = selectRepresentativePhoto(cluster);
    expect(result?.id).toBe('p3');
  });
});

describe('selectRepresentativePhotos', () => {
  it('returns up to 3 unique photos with diversity', () => {
    const p1 = createPhoto('p1', 35.6762, 139.6503, 5); // earliest
    const p2 = createPhoto('p2', 35.67621, 139.6503, 4); // closest
    const p3 = createPhoto('p3', 35.6772, 139.6503, 1); // latest
    const p4 = createPhoto('p4', 35.6782, 139.6503, 2);
    const cluster = createCluster([p1, p2, p3, p4], 35.67621, 139.6503);

    const selected = selectRepresentativePhotos(cluster, 3);

    expect(selected).toHaveLength(3);
    expect(new Set(selected.map((p) => p.id)).size).toBe(3);
    expect(selected[0].id).toBe('p2');
    expect(selected.map((p) => p.id)).toEqual(expect.arrayContaining(['p1', 'p3']));
  });

  it('returns fewer photos when cluster has less than max', () => {
    const p1 = createPhoto('p1', 35.6762, 139.6503, 1);
    const p2 = createPhoto('p2', 35.6763, 139.6503, 0);
    const cluster = createCluster([p1, p2], 35.6762, 139.6503);

    const selected = selectRepresentativePhotos(cluster, 3);

    expect(selected).toHaveLength(2);
  });
});

describe('prepareVisionImage', () => {
  const mockManipulate = ImageManipulator.manipulateAsync as jest.Mock;
  const mockGetSize = Image.getSize as jest.Mock;

  beforeEach(() => {
    mockManipulate.mockReset();
    mockGetSize.mockReset();
    mockGetSize.mockImplementation((_uri, success) => success(1600, 900));
  });

  it('resizes landscape images by width', async () => {
    mockManipulate.mockResolvedValue({ uri: 'resized.jpg', base64: 'abc123' });

    const result = await prepareVisionImage('file://photo.jpg');

    expect(result).toBe('abc123');
    expect(mockManipulate).toHaveBeenCalledWith('file://photo.jpg', [{ resize: { width: 768 } }], {
      format: 'jpeg',
      compress: 0.8,
      base64: true,
    });
  });

  it('resizes portrait images by height', async () => {
    mockGetSize.mockImplementation((_uri, success) => success(900, 1600));
    mockManipulate.mockResolvedValue({ uri: 'resized.jpg', base64: 'abc123' });

    await prepareVisionImage('file://portrait.jpg');

    expect(mockManipulate).toHaveBeenCalledWith(
      'file://portrait.jpg',
      [{ resize: { height: 768 } }],
      { format: 'jpeg', compress: 0.8, base64: true }
    );
  });

  it('skips resize when image is already within max dimension', async () => {
    mockGetSize.mockImplementation((_uri, success) => success(640, 480));
    mockManipulate.mockResolvedValue({ uri: 'same.jpg', base64: 'abc123' });

    await prepareVisionImage('file://small.jpg');

    expect(mockManipulate).toHaveBeenCalledWith('file://small.jpg', [], {
      format: 'jpeg',
      compress: 0.8,
      base64: true,
    });
  });

  it('returns null when manipulateAsync fails', async () => {
    mockManipulate.mockRejectedValue(new Error('File not found'));

    const result = await prepareVisionImage('file://missing.jpg');

    expect(result).toBeNull();
  });

  it('returns null when base64 is undefined', async () => {
    mockManipulate.mockResolvedValue({ uri: 'resized.jpg' });

    const result = await prepareVisionImage('file://photo.jpg');

    expect(result).toBeNull();
  });

  it('returns null when base64 exceeds size limit', async () => {
    const oversizedBase64 = 'x'.repeat(200_001);
    mockManipulate.mockResolvedValue({ uri: 'resized.jpg', base64: oversizedBase64 });

    const result = await prepareVisionImage('file://photo.jpg');

    expect(result).toBeNull();
  });

  it('returns base64 when exactly at size limit', async () => {
    const maxBase64 = 'x'.repeat(200_000);
    mockManipulate.mockResolvedValue({ uri: 'resized.jpg', base64: maxBase64 });

    const result = await prepareVisionImage('file://photo.jpg');

    expect(result).toBe(maxBase64);
  });

  it('returns null when image dimensions cannot be read', async () => {
    mockGetSize.mockImplementation((_uri, _success, failure) => failure?.());

    const result = await prepareVisionImage('file://broken.jpg');

    expect(result).toBeNull();
    expect(mockManipulate).not.toHaveBeenCalled();
  });

  // ── U5/R7: cached dimensions replace the probe decode ────────────────────
  describe('cached dimensions (U5/R7)', () => {
    it('does NOT probe when the dimensions are already known', async () => {
      mockManipulate.mockResolvedValue({ uri: 'resized.jpg', base64: 'abc123' });

      const result = await prepareVisionImage('file://photo.jpg', { width: 1600, height: 900 });

      expect(result).toBe('abc123');
      expect(mockGetSize).not.toHaveBeenCalled();
      expect(mockManipulate).toHaveBeenCalledWith(
        'file://photo.jpg',
        [{ resize: { width: 768 } }],
        {
          format: 'jpeg',
          compress: 0.8,
          base64: true,
        }
      );
    });

    it('does NOT upscale a cached photo that is already under the cap', async () => {
      mockManipulate.mockResolvedValue({ uri: 'same.jpg', base64: 'abc123' });

      await prepareVisionImage('file://small.jpg', { width: 640, height: 480 });

      // An unconditional resize action would UPSCALE this to 768px and inflate
      // the payload toward the reject threshold.
      expect(mockManipulate).toHaveBeenCalledWith('file://small.jpg', [], {
        format: 'jpeg',
        compress: 0.8,
        base64: true,
      });
      expect(mockGetSize).not.toHaveBeenCalled();
    });

    it('falls back to the probe for a row predating the migration', async () => {
      mockGetSize.mockImplementation((_uri, success) => success(1600, 900));
      mockManipulate.mockResolvedValue({ uri: 'resized.jpg', base64: 'abc123' });

      // width/height are undefined on rows written before the migration.
      const result = await prepareVisionImage('file://legacy.jpg', {
        width: undefined,
        height: undefined,
      });

      expect(mockGetSize).toHaveBeenCalledTimes(1);
      expect(result).toBe('abc123');
      expect(mockManipulate).toHaveBeenCalledWith(
        'file://legacy.jpg',
        [{ resize: { width: 768 } }],
        { format: 'jpeg', compress: 0.8, base64: true }
      );
    });

    it('falls back to the probe when a stored dimension is zero or partial', async () => {
      mockGetSize.mockImplementation((_uri, success) => success(900, 1600));
      mockManipulate.mockResolvedValue({ uri: 'resized.jpg', base64: 'abc123' });

      await prepareVisionImage('file://zero.jpg', { width: 0, height: 1600 });

      expect(mockGetSize).toHaveBeenCalledTimes(1);
      expect(mockManipulate).toHaveBeenCalledWith(
        'file://zero.jpg',
        [{ resize: { height: 768 } }],
        {
          format: 'jpeg',
          compress: 0.8,
          base64: true,
        }
      );
    });
  });
});

describe('getVisionImagesForCluster', () => {
  const mockManipulate = ImageManipulator.manipulateAsync as jest.Mock;
  const mockGetSize = Image.getSize as jest.Mock;

  beforeEach(() => {
    mockManipulate.mockReset();
    mockGetSize.mockReset();
    mockGetSize.mockImplementation((_uri, success) => success(1600, 900));
  });

  it('returns prepared images for selected representative photos', async () => {
    const p1 = createPhoto('p1', 35.6762, 139.6503, 2);
    const p2 = createPhoto('p2', 35.6763, 139.6503, 1);
    const p3 = createPhoto('p3', 35.6764, 139.6503, 0);
    const cluster = createCluster([p1, p2, p3], 35.6762, 139.6503);

    mockManipulate
      .mockResolvedValueOnce({ uri: '1.jpg', base64: 'a1' })
      .mockResolvedValueOnce({ uri: '2.jpg', base64: 'a2' })
      .mockResolvedValueOnce({ uri: '3.jpg', base64: 'a3' });

    const images = await getVisionImagesForCluster(cluster, 3);

    expect(images).toEqual(['a1', 'a2', 'a3']);
  });

  it('U5/R7: uses each photo cached dimensions instead of decoding again', async () => {
    const p1 = { ...createPhoto('p1', 35.6762, 139.6503, 1), width: 1600, height: 900 };
    const p2 = { ...createPhoto('p2', 35.6763, 139.6503, 0), width: 900, height: 1600 };
    const cluster = createCluster([p1, p2], 35.6762, 139.6503);

    mockManipulate.mockResolvedValue({ uri: '1.jpg', base64: 'a1' });

    const images = await getVisionImagesForCluster(cluster, 3);

    expect(images).toEqual(['a1', 'a1']);
    expect(mockGetSize).not.toHaveBeenCalled();
    const resizeActions = mockManipulate.mock.calls.map((call) => call[1]);
    expect(resizeActions).toContainEqual([{ resize: { width: 768 } }]);
    expect(resizeActions).toContainEqual([{ resize: { height: 768 } }]);
  });

  it('U5/R7: still probes photos cached before the dimensions migration', async () => {
    const p1 = createPhoto('p1', 35.6762, 139.6503, 0);
    const cluster = createCluster([p1], 35.6762, 139.6503);

    mockManipulate.mockResolvedValue({ uri: '1.jpg', base64: 'a1' });

    const images = await getVisionImagesForCluster(cluster, 3);

    expect(images).toEqual(['a1']);
    expect(mockGetSize).toHaveBeenCalledTimes(1);
  });

  it('filters failed/empty image preparations', async () => {
    const p1 = createPhoto('p1', 35.6762, 139.6503, 1);
    const p2 = createPhoto('p2', 35.6763, 139.6503, 0);
    const cluster = createCluster([p1, p2], 35.6762, 139.6503);

    mockManipulate
      .mockResolvedValueOnce({ uri: '1.jpg', base64: 'a1' })
      .mockRejectedValueOnce(new Error('failed'));

    const images = await getVisionImagesForCluster(cluster, 3);

    expect(images).toEqual(['a1']);
  });
});
