/**
 * Tests for photoScanService - the trip scan's job descriptor and public API.
 *
 * Covers the lock semantics, store state transitions, durable-flag writes,
 * cancel-during-segmentation, consumeResult, and `startScan`'s discriminated
 * outcomes. The lock, the flag and the generation guard live in `jobRuntime`
 * now, so these assertions are also the trip scan's contract WITH the runtime.
 */

import { SCAN_COPY } from '@constants/scanCopy';
import {
  __resetForTesting,
  cancelScan,
  consumeResult,
  getCancelInFlight,
  hasResult,
  isScanRunning,
  markFailed,
  startScan,
} from '@services/photoImport/photoScanService';
import { __resetRuntimeForTesting } from '@services/jobs/jobRuntime';
import { resetLibraryJobStore, useLibraryJobStore } from '@stores/libraryJobStore';

import type { PhotoWithLocation } from '@services/photoImport';

// --- Mocks ---

jest.mock('@rapideditor/country-coder', () => ({
  iso1A2Code: jest.fn(() => 'JP'),
}));

jest.mock('@utils/countries', () => ({
  getCountryName: jest.fn((code: string) => `Country ${code}`),
}));

jest.mock('@services/analytics', () => ({
  Analytics: {
    photoImportScanStarted: jest.fn(),
    photoImportScanCompleted: jest.fn(),
    photoImportScanFailed: jest.fn(),
    photoImportScanCancelled: jest.fn(),
  },
}));

jest.mock('@services/photoImport/photoBackgroundSync', () => ({
  abortBackgroundSync: jest.fn(),
}));

jest.mock('@services/photoImport/errors', () => {
  class HomeCountryNotSetError extends Error {
    constructor() {
      super('home country not set');
      this.name = 'HomeCountryNotSetError';
    }
  }
  class ScanCancelledError extends Error {
    constructor() {
      super('cancelled');
      this.name = 'ScanCancelledError';
    }
  }
  class PermissionDeniedError extends Error {
    constructor(permissionType = 'mediaLibrary') {
      super(`${permissionType} permission denied`);
      this.name = 'PermissionDeniedError';
    }
  }
  return { HomeCountryNotSetError, ScanCancelledError, PermissionDeniedError };
});

jest.mock('@services/photoImport/photoCacheDb', () => ({
  cachePhotos: jest.fn().mockResolvedValue(undefined),
  clearPhotoCache: jest.fn().mockResolvedValue(undefined),
  getAllCachedPhotos: jest.fn().mockResolvedValue([]),
  getLastImportTime: jest.fn().mockResolvedValue(null),
  getMetadata: jest.fn().mockResolvedValue(null),
  saveTripSegments: jest.fn().mockResolvedValue(undefined),
  setLastImportTime: jest.fn().mockResolvedValue(undefined),
  setMetadata: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@services/photoImport/photoClusteringCache', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  photoToCachedPhoto: jest.fn((photo: any, code: any) => ({
    id: photo.id,
    uri: photo.uri,
    filename: photo.filename,
    creationTime: photo.creationTime.getTime(),
    latitude: photo.location.latitude,
    longitude: photo.location.longitude,
    geohash: 'xn76urx',
    countryCode: code ?? null,
  })),
  segmentTripsFromCache: jest.fn(),
  // Pass-through: preview reranking is covered by photoClusteringCache.test.ts.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rankTripSegmentPreviews: jest.fn(async (candidates: any) => candidates),
}));

jest.mock('@services/photoImport/photoImportService', () => ({
  extractPhotosWithLocation: jest.fn(),
}));

const cacheDb = jest.requireMock('@services/photoImport/photoCacheDb');
const clusteringCache = jest.requireMock('@services/photoImport/photoClusteringCache');
const importService = jest.requireMock('@services/photoImport/photoImportService');
const bgSync = jest.requireMock('@services/photoImport/photoBackgroundSync');

// --- Helpers ---

function makePhoto(id: string): PhotoWithLocation {
  return {
    id,
    uri: `file://${id}.jpg`,
    filename: `${id}.jpg`,
    creationTime: new Date('2024-01-15T10:00:00Z'),
    location: { latitude: 35.0, longitude: 139.0 },
  };
}

/** The store slice every assertion below reads. */
function tripScan() {
  return useLibraryJobStore.getState().jobs['trip-scan'];
}

function makeCandidate(id = 'trip-1') {
  return {
    id,
    countryCode: 'JP',
    dateRange: { start: new Date('2024-01-15'), end: new Date('2024-01-20') },
    photoIds: ['p1'],
    photoCount: 1,
    previewUris: ['file://p1.jpg'],
    previewAssetIds: ['p1'],
    locationClusterIds: ['c1'],
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  __resetForTesting();
  __resetRuntimeForTesting();
  resetLibraryJobStore();
  cacheDb.cachePhotos.mockResolvedValue(undefined);
  cacheDb.clearPhotoCache.mockResolvedValue(undefined);
  cacheDb.getAllCachedPhotos.mockResolvedValue([]);
  cacheDb.getLastImportTime.mockResolvedValue(null);
  cacheDb.getMetadata.mockResolvedValue(null);
  cacheDb.saveTripSegments.mockResolvedValue(undefined);
  cacheDb.setLastImportTime.mockResolvedValue(undefined);
  cacheDb.setMetadata.mockResolvedValue(undefined);
});

describe('photoScanService.startScan return values', () => {
  it('returns rejected with no-home-country when homeCountry is null', async () => {
    const result = await startScan({ homeCountry: null });
    expect(result).toEqual({ status: 'rejected', reason: 'no-home-country' });
    expect(isScanRunning()).toBe(false);
    expect(cacheDb.setMetadata).not.toHaveBeenCalledWith('scan_in_progress', 'true');
  });

  it('returns started and acquires the lock on first call', async () => {
    importService.extractPhotosWithLocation.mockImplementation(
      () => new Promise(() => {}) // never resolves
    );

    const result = await startScan({ homeCountry: 'US' });
    expect(result).toEqual({ status: 'started' });
    expect(isScanRunning()).toBe(true);
  });

  it('returns already-running when a second start fires while one is in flight', async () => {
    importService.extractPhotosWithLocation.mockImplementation(() => new Promise(() => {}));

    await startScan({ homeCountry: 'US' });
    const second = await startScan({ homeCountry: 'US' });
    expect(second).toEqual({ status: 'already-running' });
    // Setting metadata to true should only happen once across both calls.
    const metadataCalls = cacheDb.setMetadata.mock.calls.filter(
      (c: unknown[]) => c[0] === 'scan_in_progress' && c[1] === 'true'
    );
    expect(metadataCalls).toHaveLength(1);
  });

  it('aborts any background sync before starting a new scan', async () => {
    importService.extractPhotosWithLocation.mockImplementation(() => new Promise(() => {}));
    await startScan({ homeCountry: 'US' });
    expect(bgSync.abortBackgroundSync).toHaveBeenCalled();
  });
});

describe('photoScanService happy path', () => {
  it('publishes a result, sets phase=completed, and writes scan_in_progress=false', async () => {
    importService.extractPhotosWithLocation.mockResolvedValue([makePhoto('p1')]);
    clusteringCache.segmentTripsFromCache.mockReturnValue({
      candidates: [makeCandidate()],
      photoLookup: new Map([['p1', makePhoto('p1')]]),
      clusterLookup: new Map([['c1', { id: 'c1' }]]),
      clusterDisplays: new Map([['c1', { id: 'c1' }]]),
    });

    await startScan({ homeCountry: 'US' });
    // Wait microtasks so the floating promise inside startScan resolves.
    await new Promise((r) => setImmediate(r));

    const state = tripScan();
    expect(state.phase).toBe('completed');
    expect(state.hasResult).toBe(true);

    // Atomic flag write happened after the result published
    expect(cacheDb.setMetadata).toHaveBeenCalledWith('scan_in_progress', 'false');

    expect(hasResult()).toBe(true);
    const result = consumeResult();
    expect(result).not.toBeNull();
    expect(result?.candidates).toHaveLength(1);
    // After consume, the service's ref is cleared
    expect(hasResult()).toBe(false);
    expect(tripScan().hasResult).toBe(false);
    expect(isScanRunning()).toBe(false);
  });

  it('runs incremental scan when getLastImportTime returns a value', async () => {
    cacheDb.getLastImportTime.mockResolvedValue(1000);
    cacheDb.getAllCachedPhotos.mockResolvedValue([
      {
        id: 'cached-1',
        uri: 'file://c.jpg',
        filename: 'c.jpg',
        creationTime: 500,
        latitude: 0,
        longitude: 0,
        geohash: 'g',
        countryCode: 'JP',
      },
    ]);
    importService.extractPhotosWithLocation.mockResolvedValue([]);
    clusteringCache.segmentTripsFromCache.mockReturnValue({
      candidates: [makeCandidate()],
      photoLookup: new Map(),
      clusterLookup: new Map(),
      clusterDisplays: new Map(),
    });

    await startScan({ homeCountry: 'US' });
    await new Promise((r) => setImmediate(r));

    expect(importService.extractPhotosWithLocation).toHaveBeenCalled();
    const callArgs = importService.extractPhotosWithLocation.mock.calls[0];
    expect(callArgs[2]).toEqual(new Date(1000)); // since
    expect(tripScan().detail.isIncremental).toBe(true);
  });
});

describe('photoScanService failure paths', () => {
  it('surfaces no-photos failure when both cache and extraction are empty', async () => {
    importService.extractPhotosWithLocation.mockResolvedValue([]);
    cacheDb.getAllCachedPhotos.mockResolvedValue([]);

    await startScan({ homeCountry: 'US' });
    await new Promise((r) => setImmediate(r));

    const state = tripScan();
    expect(state.phase).toBe('failed');
    expect(state.failure?.reason).toBe('no-photos');
    expect(hasResult()).toBe(false);
    expect(isScanRunning()).toBe(false);
  });

  it('surfaces no-trips failure when segmentation returns no candidates', async () => {
    importService.extractPhotosWithLocation.mockResolvedValue([makePhoto('p1')]);
    clusteringCache.segmentTripsFromCache.mockReturnValue({
      candidates: [],
      photoLookup: new Map(),
      clusterLookup: new Map(),
      clusterDisplays: new Map(),
    });

    await startScan({ homeCountry: 'US' });
    await new Promise((r) => setImmediate(r));

    const state = tripScan();
    expect(state.phase).toBe('failed');
    expect(state.failure?.reason).toBe('no-trips');
  });

  it('surfaces scan-error failure when extraction throws', async () => {
    importService.extractPhotosWithLocation.mockRejectedValue(new Error('boom'));

    await startScan({ homeCountry: 'US' });
    await new Promise((r) => setImmediate(r));

    const state = tripScan();
    expect(state.phase).toBe('failed');
    expect(state.failure?.reason).toBe('scan-error');
    expect(isScanRunning()).toBe(false);
  });

  it('surfaces no-permission failure when extraction throws PermissionDeniedError', async () => {
    const { PermissionDeniedError } = jest.requireMock('@services/photoImport/errors');
    importService.extractPhotosWithLocation.mockRejectedValue(
      new PermissionDeniedError('mediaLibrary')
    );

    await startScan({ homeCountry: 'US' });
    await new Promise((r) => setImmediate(r));

    const state = tripScan();
    expect(state.phase).toBe('failed');
    expect(state.failure?.reason).toBe('no-permission');
    expect(state.failure?.title).toBe(SCAN_COPY.permission.recoveryTitleDenied);
    expect(state.failure?.message).toBe(SCAN_COPY.permission.recoveryBodyDenied);
    expect(isScanRunning()).toBe(false);
  });
});

describe('photoScanService cancel', () => {
  it('cancelScan aborts the controller, resets the store, and clears metadata', async () => {
    importService.extractPhotosWithLocation.mockImplementation(() => new Promise(() => {}));

    await startScan({ homeCountry: 'US' });
    expect(isScanRunning()).toBe(true);

    cancelScan();
    expect(isScanRunning()).toBe(false);
    expect(tripScan().phase).toBe('idle');
    // The breadcrumb clear is kicked off without being awaited so cancel stays
    // synchronous for the UI. `getCancelInFlight` is the handle resume uses to
    // avoid reading a stale record, and it is what this assertion waits on.
    await getCancelInFlight();
    expect(cacheDb.setMetadata).toHaveBeenCalledWith('scan_in_progress', 'false');
  });

  it('honors cancel between extraction and segmentation', async () => {
    importService.extractPhotosWithLocation.mockResolvedValue([makePhoto('p1')]);
    // Make segmentation a sentinel that only runs if not aborted; we call cancel
    // after extraction promise resolves but before microtasks drain.
    let segmentationCalled = false;
    clusteringCache.segmentTripsFromCache.mockImplementation(() => {
      segmentationCalled = true;
      return {
        candidates: [],
        photoLookup: new Map(),
        clusterLookup: new Map(),
        clusterDisplays: new Map(),
      };
    });

    await startScan({ homeCountry: 'US' });
    cancelScan();
    await new Promise((r) => setImmediate(r));

    // Either segmentation was skipped via the abort check, OR it ran but its
    // result was never published. Either is acceptable; key invariants are
    // store=idle and no result published.
    expect(tripScan().phase).toBe('idle');
    expect(hasResult()).toBe(false);
    // Avoid an unused-variable lint complaint while documenting the invariant.
    void segmentationCalled;
  });
});

describe('photoScanService consumeResult', () => {
  it('returns null and is idempotent when no result exists', () => {
    expect(consumeResult()).toBeNull();
    expect(consumeResult()).toBeNull();
  });
});

describe('photoScanService markFailed', () => {
  it('transitions to failed with the supplied failure and clears running state', async () => {
    importService.extractPhotosWithLocation.mockImplementation(() => new Promise(() => {}));
    await startScan({ homeCountry: 'US' });

    markFailed({ reason: 'stuck', title: 'Scan stopped', message: 'Tap to retry' });
    expect(isScanRunning()).toBe(false);
    expect(tripScan().phase).toBe('failed');
    expect(tripScan().failure?.reason).toBe('stuck');
  });
});
