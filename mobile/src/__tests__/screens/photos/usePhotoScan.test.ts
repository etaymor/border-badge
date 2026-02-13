/**
 * Tests for usePhotoScan abort signal handling during cache writes.
 *
 * Reproduces the issue where aborting a scan during incremental cache writes
 * still waits for all pending writes to finish before acknowledging cancellation.
 */

import { renderHook, act } from '@testing-library/react-native';

import { usePhotoScan } from '../../../screens/photos/usePhotoScan';
import type { PhotoWithLocation } from '../../../services/photoImport';

// --- Mocks ---

// Variables prefixed with "mock" are allowed inside jest.mock factories
const mockPendingCacheWrites: Array<() => void> = [];

jest.mock('react-native', () => ({
  Alert: { alert: jest.fn() },
}));

jest.mock('@rapideditor/country-coder', () => ({
  iso1A2Code: jest.fn(() => 'FR'),
}));

jest.mock('@services/photoImport/errors', () => ({
  HomeCountryNotSetError: class extends Error {
    constructor() {
      super('Home country not set');
      this.name = 'HomeCountryNotSetError';
    }
  },
}));

jest.mock('@services/photoImport', () => ({
  extractPhotosWithLocation: jest.fn(),
  segmentTripsFromCache: jest.fn(() => ({
    candidates: [],
    photoLookup: new Map(),
    clusterLookup: new Map(),
    clusterDisplays: new Map(),
  })),
  photoToCachedPhoto: jest.fn((p: { id: string }) => ({
    id: p.id,
    uri: 'file://test.jpg',
    filename: 'test.jpg',
    creationTime: Date.now(),
    latitude: 48.8566,
    longitude: 2.3522,
    geohash: 'abc1234',
    countryCode: 'FR',
  })),
  getLastImportTime: jest.fn().mockResolvedValue(null),
  setLastImportTime: jest.fn().mockResolvedValue(undefined),
  getAllCachedPhotos: jest.fn().mockResolvedValue([]),
  cachePhotos: jest.fn(
    () =>
      new Promise<void>((resolve) => {
        mockPendingCacheWrites.push(resolve);
      })
  ),
  clearPhotoCache: jest.fn().mockResolvedValue(undefined),
  abortBackgroundSync: jest.fn(),
}));

jest.mock('@services/analytics', () => ({
  Analytics: {
    photoImportScanStarted: jest.fn(),
    photoImportScanCompleted: jest.fn(),
    photoImportScanFailed: jest.fn(),
    photoImportScanCancelled: jest.fn(),
  },
}));

jest.mock('@utils/countries', () => ({
  getCountryName: jest.fn((code: string) => `Country ${code}`),
}));

/** Create N fake photos for testing batch behavior */
function createFakePhotos(count: number): PhotoWithLocation[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `photo-${i}`,
    uri: `file://photo-${i}.jpg`,
    filename: `photo-${i}.jpg`,
    creationTime: new Date(2024, 0, 1 + i),
    location: { latitude: 48.8566, longitude: 2.3522 },
  }));
}

describe('usePhotoScan - abort during cache writes', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockPendingCacheWrites.length = 0;

    // Re-setup the cachePhotos mock after resetAllMocks
    const photoImport = jest.requireMock('@services/photoImport');
    photoImport.cachePhotos.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          mockPendingCacheWrites.push(resolve);
        })
    );
    photoImport.getLastImportTime.mockResolvedValue(null);
    photoImport.setLastImportTime.mockResolvedValue(undefined);
    photoImport.getAllCachedPhotos.mockResolvedValue([]);
    photoImport.clearPhotoCache.mockResolvedValue(undefined);
  });

  it('should stop pending cache writes when abort signal fires', async () => {
    // Generate 1500 photos → triggers 3 cache write batches (500 each)
    const photos = createFakePhotos(1500);

    const { extractPhotosWithLocation } = jest.requireMock('@services/photoImport');

    // Simulate extractPhotosWithLocation calling the batch callback with all photos,
    // then returning the full array
    extractPhotosWithLocation.mockImplementation(
      async (
        _progress: unknown,
        _signal: AbortSignal,
        _since: Date | undefined,
        onBatch: (batch: PhotoWithLocation[]) => void
      ) => {
        // Deliver photos in batches of 500 to trigger cache writes
        for (let i = 0; i < photos.length; i += 500) {
          onBatch(photos.slice(i, i + 500));
        }
        return photos;
      }
    );

    const onScanComplete = jest.fn();
    const onScanError = jest.fn();
    const onScanProgress = jest.fn();

    const { result } = renderHook(() =>
      usePhotoScan({
        homeCountry: 'US',
        onScanProgress,
        onScanComplete,
        onScanError,
      })
    );

    // Start the scan
    let scanPromise: Promise<unknown>;
    act(() => {
      scanPromise = result.current.startScan();
    });

    // Wait a tick for the scan to begin and fire off cache writes
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // At this point, 3 cache write promises should be pending
    expect(mockPendingCacheWrites.length).toBe(3);

    // Cancel the scan after the first batch completes
    mockPendingCacheWrites[0]();

    act(() => {
      result.current.cancelScan();
    });

    // Resolve remaining writes to unblock the promise
    mockPendingCacheWrites.forEach((resolve) => resolve());

    await act(async () => {
      await scanPromise!;
    });

    // The scan should have been cancelled
    expect(onScanComplete).not.toHaveBeenCalled();
  });
});
