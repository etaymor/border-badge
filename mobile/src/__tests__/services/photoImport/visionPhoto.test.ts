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

// Empty maps = no signals cached, so the quality-aware wiring degrades to the
// legacy selection and every pre-signals test in this file stays valid as-is.
jest.mock('../../../services/photoImport/photoTagDb', () => ({
  getTagsForIds: jest.fn().mockResolvedValue(new Map()),
  getIntentTagsForIds: jest.fn().mockResolvedValue(new Map()),
}));

import * as ImageManipulator from 'expo-image-manipulator';
import { Image } from 'react-native';
import {
  selectRepresentativePhoto,
  selectRepresentativePhotos,
  prepareVisionImage,
  VISION_IMAGE_TIMEOUT_MS,
  getVisionImagesForCluster,
  isPhotoLocallyAvailable,
} from '../../../services/photoImport/visionPhoto';
import { createVisionPrepBreaker } from '../../../services/photoImport/visionPrepBreaker';
import { getIntentTagsForIds, getTagsForIds } from '../../../services/photoImport/photoTagDb';
import type { PhotoIntentTag, PhotoMlTag } from '../../../services/photoImport/photoTagDb';
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

/** Photo with an exact timestamp — quality tests need seconds-level control. */
function createPhotoAt(id: string, lat: number, lng: number, timeMs: number): PhotoWithLocation {
  return {
    id,
    uri: `file://${id}.jpg`,
    filename: `${id}.jpg`,
    creationTime: new Date(timeMs),
    location: { latitude: lat, longitude: lng },
  };
}

describe('selectRepresentativePhotos with quality signals', () => {
  const BASE_TIME = Date.UTC(2025, 5, 10, 3, 0, 0);

  it('regression lock: absent/empty quality map is byte-identical to legacy selection', () => {
    const p1 = createPhoto('p1', 35.6762, 139.6503, 5); // earliest
    const p2 = createPhoto('p2', 35.67621, 139.6503, 4); // closest
    const p3 = createPhoto('p3', 35.6772, 139.6503, 1); // latest
    const p4 = createPhoto('p4', 35.6782, 139.6503, 2);
    const cluster = createCluster([p1, p2, p3, p4], 35.67621, 139.6503);

    const legacy = selectRepresentativePhotos(cluster, 3);

    // Anchor, then earliest, then latest — the exact pre-signals strategy.
    expect(legacy.map((p) => p.id)).toEqual(['p2', 'p1', 'p3']);
    expect(selectRepresentativePhotos(cluster, 3, undefined)).toEqual(legacy);
    expect(selectRepresentativePhotos(cluster, 3, new Map())).toEqual(legacy);
  });

  it('collapses a burst to its best-quality frame — never both', () => {
    const anchor = createPhotoAt('anchor', 35.6762, 139.6503, BASE_TIME);
    // Burst pair: 20s and ~33m apart (inside the near-duplicate window), but
    // 10 minutes after the anchor so the anchor is not part of the group.
    const burstA = createPhotoAt('burst-a', 35.6765, 139.6503, BASE_TIME + 600_000);
    const burstB = createPhotoAt('burst-b', 35.6765, 139.6503, BASE_TIME + 620_000);
    const cluster = createCluster([anchor, burstA, burstB], 35.6762, 139.6503);
    cluster.countryCode = 'JP'; // near-duplicate detection requires a country match

    const quality = new Map([
      ['anchor', 0.5],
      ['burst-a', 0.2],
      ['burst-b', 0.9],
    ]);

    const selected = selectRepresentativePhotos(cluster, 3, quality);

    expect(selected.map((p) => p.id)).toEqual(['anchor', 'burst-b']);
  });

  it('always keeps the closest-to-centroid anchor, even when it scores lowest', () => {
    const anchor = createPhotoAt('anchor', 35.6762, 139.6503, BASE_TIME);
    // Non-duplicates: each pair is separated by more than the 90s window.
    const far1 = createPhotoAt('far1', 35.6772, 139.6503, BASE_TIME + 600_000);
    const far2 = createPhotoAt('far2', 35.6782, 139.6503, BASE_TIME + 1_200_000);
    const cluster = createCluster([anchor, far1, far2], 35.6762, 139.6503);
    cluster.countryCode = 'JP';

    const quality = new Map([
      ['anchor', -5],
      ['far1', 1],
      ['far2', 2],
    ]);

    const selected = selectRepresentativePhotos(cluster, 2, quality);

    expect(selected[0].id).toBe('anchor');
    // The remaining slot goes to the highest quality, not the next closest.
    expect(selected.map((p) => p.id)).toEqual(['anchor', 'far2']);
  });

  it('fills scored photos by descending quality, then unscored in distance order', () => {
    const anchor = createPhotoAt('anchor', 35.6762, 139.6503, BASE_TIME);
    const near = createPhotoAt('near', 35.6767, 139.6503, BASE_TIME + 600_000);
    const mid = createPhotoAt('mid', 35.6772, 139.6503, BASE_TIME + 1_200_000);
    const far = createPhotoAt('far', 35.6782, 139.6503, BASE_TIME + 1_800_000);
    const cluster = createCluster([anchor, near, mid, far], 35.6762, 139.6503);
    cluster.countryCode = 'JP';

    // Only the farthest photo is scored; the unscored rest keep distance order.
    const quality = new Map([['far', 2]]);

    const selected = selectRepresentativePhotos(cluster, 4, quality);

    expect(selected.map((p) => p.id)).toEqual(['anchor', 'far', 'near', 'mid']);
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

  // ── Stalled native calls (iCloud-evicted assets) ─────────────────────────
  //
  // `Image.getSize` and `manipulateAsync` over a `ph://` asset whose pixels
  // live only in iCloud can never call back at all — not a rejection, no
  // callback of either kind. A silent stall here is what freezes the whole
  // import: preparation never settles, so no suggestion request is ever posted
  // and every location sits on "Checking this location…" with nothing to retry.
  describe('stalled native calls', () => {
    it('gives up on a dimension probe that never calls back', async () => {
      jest.useFakeTimers();
      mockGetSize.mockImplementation(() => {});

      const pending = prepareVisionImage('file://evicted.jpg');
      jest.advanceTimersByTime(VISION_IMAGE_TIMEOUT_MS);
      const result = await pending;

      expect(result).toBeNull();
      expect(mockManipulate).not.toHaveBeenCalled();
      jest.useRealTimers();
    });

    it('gives up on an encode that never settles', async () => {
      jest.useFakeTimers();
      mockManipulate.mockImplementation(() => new Promise(() => {}));

      const pending = prepareVisionImage('file://evicted.jpg', { width: 1600, height: 900 });
      jest.advanceTimersByTime(VISION_IMAGE_TIMEOUT_MS);

      await expect(pending).resolves.toBeNull();
      jest.useRealTimers();
    });
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

  it('loads signals and collapses a burst to the intent-favored frame', async () => {
    const BASE_TIME = Date.UTC(2025, 5, 10, 3, 0, 0);
    const anchor = createPhotoAt('anchor', 35.6762, 139.6503, BASE_TIME);
    const burstA = createPhotoAt('burst-a', 35.6765, 139.6503, BASE_TIME + 600_000);
    const burstB = createPhotoAt('burst-b', 35.6765, 139.6503, BASE_TIME + 620_000);
    const cluster = createCluster([anchor, burstA, burstB], 35.6762, 139.6503);
    cluster.countryCode = 'JP';

    // A favorite on burst-b outscores its sibling; anchor stays unconditional.
    const favoriteIntent: PhotoIntentTag = {
      id: 'burst-b',
      metaVersion: 1,
      isFavorite: true,
      hasAdjustments: false,
      subtypes: [],
      burstId: null,
      burstIsRepresentative: false,
      sourceUserLibrary: true,
      inUserAlbum: false,
      altitude: null,
      gpsSpeed: null,
      refreshedAt: 0,
    };
    (getIntentTagsForIds as jest.Mock).mockResolvedValueOnce(
      new Map([['burst-b', favoriteIntent]])
    );

    mockManipulate.mockImplementation((uri: string) => Promise.resolve({ uri, base64: uri }));

    const images = await getVisionImagesForCluster(cluster, 3);

    expect(images).toEqual(['file://anchor.jpg', 'file://burst-b.jpg']);
  });

  it('degrades to the legacy selection when the signal load throws', async () => {
    const BASE_TIME = Date.UTC(2025, 5, 10, 3, 0, 0);
    const p1 = createPhotoAt('p1', 35.6762, 139.6503, BASE_TIME);
    const p2 = createPhotoAt('p2', 35.6763, 139.6503, BASE_TIME + 600_000);
    const cluster = createCluster([p1, p2], 35.6762, 139.6503);

    (getIntentTagsForIds as jest.Mock).mockRejectedValueOnce(new Error('sqlite closed'));
    mockManipulate.mockImplementation((uri: string) => Promise.resolve({ uri, base64: uri }));

    const images = await getVisionImagesForCluster(cluster, 3);

    expect(images).toEqual(['file://p1.jpg', 'file://p2.jpg']);
  });
});

// ── U1/U2: iCloud-offloaded photos never reach native preparation (R1/R2) ──
//
// A `ph://` cached URI means the scan found no `localUri`: the pixels live only
// in iCloud, and `manipulateAsync` on it downloads the full original — which on
// the Sept 2026 Paris import hit the 10s bound every time and returned nothing.
// A `no-local-image` tag row is the native tagger reporting the same thing for a
// photo whose `file://` path no longer has pixels behind it. Either way the
// cluster must go to the matcher on its coordinates with no added delay.
describe('getVisionImagesForCluster over offloaded photos (U1)', () => {
  const mockManipulate = ImageManipulator.manipulateAsync as jest.Mock;
  const mockGetSize = Image.getSize as jest.Mock;
  const mockGetTags = getTagsForIds as jest.Mock;

  /** Dimensions are cached, so the probe is skipped and only the encode runs. */
  const photoWithUri = (id: string, lat: number, uri: string, daysAgo: number) => ({
    ...createPhoto(id, lat, 139.6503, daysAgo),
    uri,
    width: 1600,
    height: 900,
  });

  const offloadedTag = (id: string): PhotoMlTag => ({
    id,
    taggerVersion: 1,
    status: 'no-local-image',
    isScreenshot: false,
    faceCount: null,
    maxFaceArea: null,
    totalFaceArea: null,
    humanCount: null,
    maxHumanArea: null,
    totalHumanArea: null,
    labels: [],
    aestheticScore: null,
    isUtility: null,
    computedAt: 0,
  });

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    mockManipulate.mockReset();
    mockGetSize.mockReset();
    mockGetSize.mockImplementation((_uri, success) => success(1600, 900));
    // An iCloud-only asset: the encode waits on a network download that, on
    // the reported import, never finished inside the bound.
    mockManipulate.mockImplementation((uri: string) =>
      uri.startsWith('ph://') ? new Promise(() => {}) : Promise.resolve({ uri, base64: uri })
    );
  });

  afterEach(() => {
    jest.useRealTimers();
    mockGetTags.mockResolvedValue(new Map());
  });

  /** Start preparation and report whether it settled within `ms` of fake time. */
  async function settleWithin(cluster: LocationCluster, ms: number) {
    let images: string[] | undefined;
    const pending = getVisionImagesForCluster(cluster, 3).then((result) => {
      images = result;
      return result;
    });
    await jest.advanceTimersByTimeAsync(ms);
    const settledInTime = images !== undefined;
    // Drain whatever the implementation left running so no timer leaks.
    await jest.advanceTimersByTimeAsync(VISION_IMAGE_TIMEOUT_MS * 2);
    await pending;
    return { settledInTime, images: images as string[] };
  }

  it('never hands an all-ph:// cluster to the manipulator and settles at once', async () => {
    const cluster = createCluster(
      [
        photoWithUri('p1', 35.6762, 'ph://p1', 2),
        photoWithUri('p2', 35.6763, 'ph://p2', 1),
        photoWithUri('p3', 35.6764, 'ph://p3', 0),
      ],
      35.6762,
      139.6503
    );

    const { settledInTime, images } = await settleWithin(cluster, 50);

    expect(mockManipulate).not.toHaveBeenCalled();
    expect(settledInTime).toBe(true);
    expect(images).toEqual([]);
  });

  it('selects only local photos from a mixed cluster, anchored on the closest LOCAL one', async () => {
    // The two photos nearest the centroid are offloaded; the local anchor is
    // the closest of the remaining file:// photos.
    const cluster = createCluster(
      [
        photoWithUri('icloud-a', 35.6762, 'ph://icloud-a', 3),
        photoWithUri('icloud-b', 35.67625, 'ph://icloud-b', 2),
        photoWithUri('local-near', 35.6764, 'file://local-near.jpg', 1),
        photoWithUri('local-far', 35.6772, 'file://local-far.jpg', 0),
      ],
      35.6762,
      139.6503
    );

    const { settledInTime, images } = await settleWithin(cluster, 50);

    const encodedUris = mockManipulate.mock.calls.map((call) => call[0]);
    expect(encodedUris.every((uri: string) => uri.startsWith('file://'))).toBe(true);
    expect(settledInTime).toBe(true);
    expect(images).toEqual(['file://local-near.jpg', 'file://local-far.jpg']);
  });

  it('skips file:// photos whose tag row says no-local-image', async () => {
    const photos = [
      photoWithUri('t1', 35.6762, 'file://t1.jpg', 2),
      photoWithUri('t2', 35.6763, 'file://t2.jpg', 1),
      photoWithUri('t3', 35.6764, 'file://t3.jpg', 0),
    ];
    mockGetTags.mockResolvedValue(new Map(photos.map((p) => [p.id, offloadedTag(p.id)])));
    // Those files have no pixels behind them: the encode would stall.
    mockManipulate.mockImplementation(() => new Promise(() => {}));
    const cluster = createCluster(photos, 35.6762, 139.6503);

    const { settledInTime, images } = await settleWithin(cluster, 50);

    expect(mockManipulate).not.toHaveBeenCalled();
    expect(settledInTime).toBe(true);
    expect(images).toEqual([]);
  });
});

describe('getVisionImagesForCluster with the dispatch breaker (U2/KTD2)', () => {
  const mockManipulate = ImageManipulator.manipulateAsync as jest.Mock;
  let warnSpy: jest.SpyInstance;

  const localPhoto = (id: string, lat: number, daysAgo: number) => ({
    ...createPhoto(id, lat, 139.6503, daysAgo),
    width: 1600,
    height: 900,
  });

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    mockManipulate.mockReset();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    warnSpy.mockRestore();
  });

  it('records each photo timeout and opens after a cluster of three', async () => {
    mockManipulate.mockImplementation(() => new Promise(() => {}));
    const breaker = createVisionPrepBreaker();
    const cluster = createCluster(
      [localPhoto('s1', 35.6762, 2), localPhoto('s2', 35.6763, 1), localPhoto('s3', 35.6764, 0)],
      35.6762,
      139.6503
    );

    const pending = getVisionImagesForCluster(cluster, 3, { breaker });
    await jest.advanceTimersByTimeAsync(VISION_IMAGE_TIMEOUT_MS);

    await expect(pending).resolves.toEqual([]);
    expect(breaker.isOpen()).toBe(true);
  });

  it('a successful encode resets the streak', async () => {
    mockManipulate.mockImplementation((uri: string) =>
      uri.includes('ok') ? Promise.resolve({ uri, base64: uri }) : new Promise(() => {})
    );
    const breaker = createVisionPrepBreaker();
    breaker.recordTimeout();
    breaker.recordTimeout();
    const cluster = createCluster([localPhoto('ok', 35.6762, 0)], 35.6762, 139.6503);

    await expect(getVisionImagesForCluster(cluster, 3, { breaker })).resolves.toEqual([
      'file://ok.jpg',
    ]);
    expect(breaker.consecutiveTimeouts()).toBe(0);
    expect(breaker.isOpen()).toBe(false);
  });

  it('prepares nothing once the breaker is open', async () => {
    const breaker = createVisionPrepBreaker();
    for (let i = 0; i < 3; i++) breaker.recordTimeout();
    const cluster = createCluster([localPhoto('p1', 35.6762, 0)], 35.6762, 139.6503);

    await expect(getVisionImagesForCluster(cluster, 3, { breaker })).resolves.toEqual([]);
    expect(mockManipulate).not.toHaveBeenCalled();
  });

  it('a decode failure is not a timeout', async () => {
    mockManipulate.mockRejectedValue(new Error('decode failed'));
    const breaker = createVisionPrepBreaker();
    const cluster = createCluster(
      [localPhoto('d1', 35.6762, 2), localPhoto('d2', 35.6763, 1), localPhoto('d3', 35.6764, 0)],
      35.6762,
      139.6503
    );

    await expect(getVisionImagesForCluster(cluster, 3, { breaker })).resolves.toEqual([]);
    expect(breaker.consecutiveTimeouts()).toBe(0);
  });

  it('edge: a cluster with zero photos returns an empty list without throwing', async () => {
    const cluster = createCluster([localPhoto('p1', 35.6762, 0)], 35.6762, 139.6503);
    cluster.photos = [];

    await expect(
      getVisionImagesForCluster(cluster, 3, { breaker: createVisionPrepBreaker() })
    ).resolves.toEqual([]);
    expect(mockManipulate).not.toHaveBeenCalled();
  });
});

describe('isPhotoLocallyAvailable (KTD1)', () => {
  it('treats a cached ph:// URI as offloaded', () => {
    expect(isPhotoLocallyAvailable({ ...createPhoto('a', 0, 0), uri: 'ph://a' })).toBe(false);
  });

  it('treats a no-local-image tag row as offloaded even with a file:// URI', () => {
    expect(isPhotoLocallyAvailable(createPhoto('a', 0, 0), { status: 'no-local-image' })).toBe(
      false
    );
  });

  it('treats a file:// URI with no row, or any other status, as local', () => {
    expect(isPhotoLocallyAvailable(createPhoto('a', 0, 0))).toBe(true);
    expect(isPhotoLocallyAvailable(createPhoto('a', 0, 0), { status: 'ok' })).toBe(true);
    expect(isPhotoLocallyAvailable(createPhoto('a', 0, 0), { status: 'error' })).toBe(true);
  });
});
