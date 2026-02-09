import { renderHook, act } from '@testing-library/react-native';

import { usePhotoScan } from '../../../screens/photos/usePhotoScan';
import * as photoImportService from '../../../services/photoImport';

// Mock dependencies
jest.mock('../../../services/photoImport', () => ({
  extractPhotosWithLocation: jest.fn(),
  segmentTripsFromCache: jest.fn(),
  photoToCachedPhoto: jest.fn((photo, countryCode) => ({
    id: photo.id,
    uri: photo.uri,
    filename: photo.filename,
    creationTime: photo.creationTime.getTime(),
    latitude: photo.location.latitude,
    longitude: photo.location.longitude,
    geohash: 'xn76urx',
    countryCode: countryCode ?? null,
  })),
  HomeCountryNotSetError: class HomeCountryNotSetError extends Error {
    constructor() {
      super('Home country not set');
      this.name = 'HomeCountryNotSetError';
    }
  },
  getLastImportTime: jest.fn(),
  setLastImportTime: jest.fn(),
  getAllCachedPhotos: jest.fn(),
  cachePhotos: jest.fn(),
  clearPhotoCache: jest.fn(),
  abortBackgroundSync: jest.fn(),
}));

jest.mock('@rapideditor/country-coder', () => ({
  iso1A2Code: jest.fn(() => 'JP'),
}));

jest.mock('../../../utils/countries', () => ({
  getCountryName: jest.fn((code: string) => (code === 'JP' ? 'Japan' : code)),
}));

jest.mock('../../../services/analytics', () => ({
  Analytics: {
    photoImportScanStarted: jest.fn(),
    photoImportScanCompleted: jest.fn(),
    photoImportScanFailed: jest.fn(),
    photoImportScanCancelled: jest.fn(),
  },
}));

const mockedPhotoImport = photoImportService as jest.Mocked<typeof photoImportService>;

function createMockPhoto(id: string) {
  return {
    id,
    uri: `file://photo-${id}.jpg`,
    filename: `photo-${id}.jpg`,
    creationTime: new Date('2024-01-15T10:00:00Z'),
    location: { latitude: 35.6762, longitude: 139.6503 },
  };
}

function createMockCachedPhoto(id: string, countryCode = 'JP') {
  return {
    id,
    uri: `file://photo-${id}.jpg`,
    filename: `photo-${id}.jpg`,
    creationTime: new Date('2024-01-15T10:00:00Z').getTime(),
    latitude: 35.6762,
    longitude: 139.6503,
    geohash: 'xn76urx',
    countryCode,
  };
}

const mockTripCandidate = {
  id: 'trip-1',
  countryCode: 'JP',
  dateRange: { start: new Date('2024-01-15'), end: new Date('2024-01-20') },
  photoIds: ['photo-1'],
  photoCount: 1,
  previewUris: ['file://photo-1.jpg'],
  locationClusterIds: ['cluster-1'],
};

describe('usePhotoScan', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPhotoImport.setLastImportTime.mockResolvedValue(undefined);
    mockedPhotoImport.cachePhotos.mockResolvedValue(undefined);
    mockedPhotoImport.clearPhotoCache.mockResolvedValue(undefined);
  });

  describe('incremental scan avoids unnecessary SQLite reload', () => {
    it('does not call getAllCachedPhotos a second time when new photos exist', async () => {
      const cachedPhotos = [createMockCachedPhoto('old-1'), createMockCachedPhoto('old-2')];
      const newPhotos = [createMockPhoto('new-1')];

      // Set up incremental scan: last import time exists
      mockedPhotoImport.getLastImportTime.mockResolvedValue(Date.now() - 60000);

      // First call: load existing cached photos
      mockedPhotoImport.getAllCachedPhotos.mockResolvedValue(cachedPhotos);

      // extractPhotosWithLocation returns new photos
      mockedPhotoImport.extractPhotosWithLocation.mockResolvedValue(newPhotos);

      // segmentTripsFromCache returns candidates
      mockedPhotoImport.segmentTripsFromCache.mockReturnValue({
        candidates: [mockTripCandidate],
        photoLookup: new Map(),
        clusterLookup: new Map(),
        clusterDisplays: new Map(),
      });

      const onScanProgress = jest.fn();
      const onScanComplete = jest.fn();
      const onScanError = jest.fn();

      const { result } = renderHook(() =>
        usePhotoScan({
          homeCountry: 'US',
          onScanProgress,
          onScanComplete,
          onScanError,
        })
      );

      await act(async () => {
        await result.current.startScan();
      });

      // getAllCachedPhotos should be called exactly ONCE (initial load for incremental scan).
      // It should NOT be called a second time to reload after caching.
      expect(mockedPhotoImport.getAllCachedPhotos).toHaveBeenCalledTimes(1);

      // segmentTripsFromCache should receive the combined set (old cached + new converted)
      expect(mockedPhotoImport.segmentTripsFromCache).toHaveBeenCalledTimes(1);
      const passedPhotos = mockedPhotoImport.segmentTripsFromCache.mock.calls[0][0];
      expect(passedPhotos).toHaveLength(3); // 2 old + 1 new
      expect(passedPhotos.map((p: { id: string }) => p.id).sort()).toEqual([
        'new-1',
        'old-1',
        'old-2',
      ]);
    });

    it('skips concat when no new photos found during incremental scan', async () => {
      const cachedPhotos = [createMockCachedPhoto('old-1')];

      mockedPhotoImport.getLastImportTime.mockResolvedValue(Date.now() - 60000);
      mockedPhotoImport.getAllCachedPhotos.mockResolvedValue(cachedPhotos);
      mockedPhotoImport.extractPhotosWithLocation.mockResolvedValue([]);
      mockedPhotoImport.segmentTripsFromCache.mockReturnValue({
        candidates: [mockTripCandidate],
        photoLookup: new Map(),
        clusterLookup: new Map(),
        clusterDisplays: new Map(),
      });

      const { result } = renderHook(() =>
        usePhotoScan({
          homeCountry: 'US',
          onScanProgress: jest.fn(),
          onScanComplete: jest.fn(),
          onScanError: jest.fn(),
        })
      );

      await act(async () => {
        await result.current.startScan();
      });

      // Only one call - initial load, no reload needed
      expect(mockedPhotoImport.getAllCachedPhotos).toHaveBeenCalledTimes(1);

      // segmentTripsFromCache receives just the cached photos
      const passedPhotos = mockedPhotoImport.segmentTripsFromCache.mock.calls[0][0];
      expect(passedPhotos).toHaveLength(1);
    });

    it('uses getAllCachedPhotos for full scan since no prior cache exists', async () => {
      const newPhotos = [createMockPhoto('new-1'), createMockPhoto('new-2')];

      // Full scan: no last import time
      mockedPhotoImport.getLastImportTime.mockResolvedValue(null);
      mockedPhotoImport.extractPhotosWithLocation.mockResolvedValue(newPhotos);

      // getAllCachedPhotos is NOT called during extraction (full scan path),
      // but photos are cached and we need the full set for segmentation.
      // After the fix, full scan still builds the array from newPhotos in memory.
      mockedPhotoImport.getAllCachedPhotos.mockResolvedValue([]);

      mockedPhotoImport.segmentTripsFromCache.mockReturnValue({
        candidates: [mockTripCandidate],
        photoLookup: new Map(),
        clusterLookup: new Map(),
        clusterDisplays: new Map(),
      });

      const { result } = renderHook(() =>
        usePhotoScan({
          homeCountry: 'US',
          onScanProgress: jest.fn(),
          onScanComplete: jest.fn(),
          onScanError: jest.fn(),
        })
      );

      await act(async () => {
        await result.current.startScan();
      });

      // Full scan path: getAllCachedPhotos should NOT be called at all
      // (we build the array in memory from newPhotos)
      expect(mockedPhotoImport.getAllCachedPhotos).not.toHaveBeenCalled();

      // segmentTripsFromCache should receive the converted new photos
      const passedPhotos = mockedPhotoImport.segmentTripsFromCache.mock.calls[0][0];
      expect(passedPhotos).toHaveLength(2);
    });
  });
});
