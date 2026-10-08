/**
 * Tests for the per-dispatch vision preparation telemetry (U3/R4).
 */

jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(),
  SaveFormat: { JPEG: 'jpeg' },
}));

jest.mock('react-native', () => ({
  Image: { getSize: jest.fn() },
}));

jest.mock('../../../services/photoImport/photoTagDb', () => ({
  getTagsForIds: jest.fn().mockResolvedValue(new Map()),
  getIntentTagsForIds: jest.fn().mockResolvedValue(new Map()),
}));

import * as ImageManipulator from 'expo-image-manipulator';
import {
  beginPrepTelemetryRun,
  createPrepTelemetry,
  currentPrepTelemetry,
  getPrepTelemetry,
  measurePrepare,
} from '../../../services/photoImport/prepTelemetry';
import {
  getVisionImagesForCluster,
  VISION_IMAGE_TIMEOUT_MS,
} from '../../../services/photoImport/visionPhoto';
import { createVisionPrepBreaker } from '../../../services/photoImport/visionPrepBreaker';
import type { LocationCluster, PhotoWithLocation } from '../../../services/photoImport/types';

function photo(id: string, lat: number, uri: string, minute: number): PhotoWithLocation {
  return {
    id,
    uri,
    filename: `${id}.jpg`,
    creationTime: new Date(Date.UTC(2026, 8, 20, 12, minute)),
    location: { latitude: lat, longitude: 2.3376 },
    width: 1600,
    height: 900,
  };
}

function cluster(id: string, photos: PhotoWithLocation[]): LocationCluster {
  return {
    id,
    geohash: 'u09tvqr',
    centroid: { latitude: photos[0]?.location.latitude ?? 48.86, longitude: 2.3376 },
    photos,
    timeRange: {
      start: photos[0]?.creationTime ?? new Date(0),
      end: photos[photos.length - 1]?.creationTime ?? new Date(0),
    },
  };
}

describe('createPrepTelemetry', () => {
  it('starts at zero', () => {
    expect(createPrepTelemetry().snapshot()).toEqual({
      prepareMsTotal: 0,
      prepareMsMax: 0,
      visionImagesAttempted: 0,
      visionImagesProduced: 0,
      visionImagesTimedOut: 0,
      visionPhotosSkippedOffloaded: 0,
      breakerOpened: false,
    });
  });

  it('sums preparation time and keeps the slowest single preparation', () => {
    const telemetry = createPrepTelemetry();
    telemetry.recordPrepareMs(120);
    telemetry.recordPrepareMs(900);
    telemetry.recordPrepareMs(40);

    expect(telemetry.snapshot()).toMatchObject({ prepareMsTotal: 1060, prepareMsMax: 900 });
  });

  it('counts each attempted photo once, by outcome', () => {
    const telemetry = createPrepTelemetry();
    telemetry.recordPhotoOutcome({ produced: true, timedOut: false });
    telemetry.recordPhotoOutcome({ produced: false, timedOut: true });
    // A decode failure: attempted, neither produced nor a timeout.
    telemetry.recordPhotoOutcome({ produced: false, timedOut: false });
    telemetry.recordSkippedOffloaded(4);
    telemetry.recordBreakerOpened();

    expect(telemetry.snapshot()).toMatchObject({
      visionImagesAttempted: 3,
      visionImagesProduced: 1,
      visionImagesTimedOut: 1,
      visionPhotosSkippedOffloaded: 4,
      breakerOpened: true,
    });
  });

  it('hands out snapshots that later recording does not mutate', () => {
    const telemetry = createPrepTelemetry();
    const before = telemetry.snapshot();
    telemetry.recordSkippedOffloaded(2);
    expect(before.visionPhotosSkippedOffloaded).toBe(0);
  });
});

describe('prep telemetry run scope', () => {
  it('a fresh run starts at zero; the current run is what the events read', () => {
    beginPrepTelemetryRun().recordSkippedOffloaded(3);
    expect(getPrepTelemetry().visionPhotosSkippedOffloaded).toBe(3);

    // A retry folds into the same run.
    currentPrepTelemetry().recordSkippedOffloaded(1);
    expect(getPrepTelemetry().visionPhotosSkippedOffloaded).toBe(4);

    beginPrepTelemetryRun();
    expect(getPrepTelemetry().visionPhotosSkippedOffloaded).toBe(0);
  });

  it('measurePrepare records the elapsed time of the wrapped work and returns its result', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    try {
      const telemetry = createPrepTelemetry();
      const pending = measurePrepare(
        telemetry,
        () => new Promise<string>((resolve) => setTimeout(() => resolve('done'), 250))
      );
      await jest.advanceTimersByTimeAsync(250);
      await expect(pending).resolves.toBe('done');
      expect(telemetry.snapshot()).toMatchObject({ prepareMsTotal: 250, prepareMsMax: 250 });
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('getVisionImagesForCluster feeding the telemetry sink (U3/R4)', () => {
  const mockManipulate = ImageManipulator.manipulateAsync as jest.Mock;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    mockManipulate.mockReset();
    mockManipulate.mockImplementation((uri: string) =>
      uri.includes('stall') ? new Promise(() => {}) : Promise.resolve({ uri, base64: uri })
    );
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    warnSpy.mockRestore();
  });

  it('a dispatch with 2 produced images, 1 timeout and 4 offloaded skips reports exactly that', async () => {
    const telemetry = createPrepTelemetry();
    const breaker = createVisionPrepBreaker();
    const local = cluster('local', [
      photo('a', 48.8606, 'file://ok-a.jpg', 0),
      photo('b', 48.8607, 'file://ok-b.jpg', 1),
      photo('c', 48.8608, 'file://stall-c.jpg', 2),
    ]);
    const offloaded = cluster(
      'icloud',
      [0, 1, 2, 3].map((i) => photo(`i${i}`, 48.87 + i * 0.0001, `ph://i${i}`, i))
    );

    const pending = Promise.all([
      getVisionImagesForCluster(local, 3, { breaker, telemetry }),
      getVisionImagesForCluster(offloaded, 3, { breaker, telemetry }),
    ]);
    await jest.advanceTimersByTimeAsync(VISION_IMAGE_TIMEOUT_MS);
    const [localImages, offloadedImages] = await pending;

    expect(localImages).toHaveLength(2);
    expect(offloadedImages).toEqual([]);
    expect(telemetry.snapshot()).toMatchObject({
      visionImagesAttempted: 3,
      visionImagesProduced: 2,
      visionImagesTimedOut: 1,
      visionPhotosSkippedOffloaded: 4,
      breakerOpened: false,
    });
  });

  it('counts the offloaded photos of a mixed cluster without counting them as attempts', async () => {
    const telemetry = createPrepTelemetry();
    const mixed = cluster('mixed', [
      photo('l1', 48.8606, 'file://ok-l1.jpg', 0),
      photo('o1', 48.8607, 'ph://o1', 1),
      photo('o2', 48.8608, 'ph://o2', 2),
    ]);

    await expect(getVisionImagesForCluster(mixed, 3, { telemetry })).resolves.toHaveLength(1);
    expect(telemetry.snapshot()).toMatchObject({
      visionImagesAttempted: 1,
      visionImagesProduced: 1,
      visionPhotosSkippedOffloaded: 2,
    });
  });

  it('photos skipped because the breaker is already open are not attempts', async () => {
    const telemetry = createPrepTelemetry();
    const breaker = createVisionPrepBreaker();
    for (let i = 0; i < 3; i++) breaker.recordTimeout();

    await getVisionImagesForCluster(cluster('x', [photo('a', 48.86, 'file://ok-a.jpg', 0)]), 3, {
      breaker,
      telemetry,
    });

    expect(telemetry.snapshot().visionImagesAttempted).toBe(0);
    expect(mockManipulate).not.toHaveBeenCalled();
  });
});
