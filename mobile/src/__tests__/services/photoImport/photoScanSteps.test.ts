/**
 * Focused tests for scan-step country naming from the countries reference.
 */

import { runScanPass } from '@services/photoImport/photoScanSteps';

import type { JobRunContext } from '@services/jobs/jobTypes';
import type { PhotoWithLocation } from '@services/photoImport';
import type { TripScanDetail } from '@stores/libraryJobStore';

jest.mock('@rapideditor/country-coder', () => ({
  iso1A2Code: jest.fn(() => 'CA'),
}));

jest.mock('@utils/countries', () => ({
  // Simulate Hermes without Intl.DisplayNames: fall back to the ISO code.
  getCountryName: jest.fn((code: string) => code),
}));

jest.mock('@services/countriesDb', () => ({
  getAllCountries: jest.fn(),
}));

jest.mock('@services/analytics', () => ({
  Analytics: {
    photoImportScanStarted: jest.fn(),
    photoImportScanCompleted: jest.fn(),
    photoImportScanFailed: jest.fn(),
    photoImportScanCancelled: jest.fn(),
  },
}));

jest.mock('@services/photoImport/photoTaggingService', () => ({
  maybeRunTaggingPass: jest.fn(),
}));

jest.mock('@services/photoImport/errors', () => {
  class HomeCountryNotSetError extends Error {
    constructor() {
      super('home country not set');
      this.name = 'HomeCountryNotSetError';
    }
  }
  class PermissionDeniedError extends Error {
    constructor(permissionType = 'mediaLibrary') {
      super(`${permissionType} permission denied`);
      this.name = 'PermissionDeniedError';
    }
  }
  return { HomeCountryNotSetError, PermissionDeniedError };
});

jest.mock('@services/photoImport/photoCacheDb', () => ({
  cachePhotos: jest.fn().mockResolvedValue(undefined),
  clearPhotoCache: jest.fn().mockResolvedValue(undefined),
  getAllCachedPhotos: jest.fn().mockResolvedValue([]),
  getLastImportTime: jest.fn().mockResolvedValue(null),
  saveTripSegments: jest.fn().mockResolvedValue(undefined),
  setLastImportTime: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@services/photoImport/photoCacheDbSuggestions', () => ({
  getAllSavedPhotoIds: jest.fn().mockResolvedValue(new Set()),
  getClusterSplitsForParents: jest.fn().mockResolvedValue(new Map()),
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
  segmentTripsFromCache: jest.fn().mockReturnValue({
    candidates: [
      {
        id: 'trip-1',
        countryCode: 'CA',
        dateRange: { start: new Date('2024-01-15'), end: new Date('2024-01-20') },
        photoIds: ['ca-1'],
        photoCount: 1,
        previewUris: ['file://ca-1.jpg'],
        previewAssetIds: ['ca-1'],
        locationClusterIds: ['c1'],
      },
    ],
    photoLookup: new Map(),
    clusterLookup: new Map([['c1', { id: 'c1' }]]),
    clusterDisplays: new Map(),
  }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rankTripSegmentPreviews: jest.fn(async (candidates: any) => candidates),
}));

jest.mock('@services/photoImport/photoClusteringDisplay', () => ({
  applyPersistedSplits: jest.fn((segmented: unknown) => segmented),
  applySavedPhotoFilter: jest.fn((data: unknown) => ({ data, autoDismissed: [] })),
}));

jest.mock('@services/photoImport/photoImportService', () => ({
  extractPhotosWithLocation: jest.fn(),
}));

const countriesDb = jest.requireMock('@services/countriesDb');
const importService = jest.requireMock('@services/photoImport/photoImportService');

function makeContext(detailEmits: TripScanDetail[]): JobRunContext {
  return {
    signal: new AbortController().signal,
    heartbeat: jest.fn(),
    emit: (_progress, detail) => {
      if (detail !== undefined) detailEmits.push(detail as TripScanDetail);
    },
    shouldYield: () => false,
    saveCheckpoint: jest.fn().mockResolvedValue(undefined),
  };
}

function makeCaPhoto(id: string): PhotoWithLocation {
  return {
    id,
    uri: `file://${id}.jpg`,
    filename: `${id}.jpg`,
    creationTime: new Date('2024-01-15T10:00:00Z'),
    location: { latitude: 45.5, longitude: -73.5 },
    width: 1000,
    height: 800,
  };
}

describe('runScanPass country naming', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    countriesDb.getAllCountries.mockResolvedValue([
      {
        code: 'CA',
        name: 'Canada',
        region: 'Americas',
        subregion: 'Northern America',
        recognition: null,
      },
    ]);
  });

  it('names preview rows from the countries reference (Canada for CA)', async () => {
    const batch = [makeCaPhoto('ca-1')];
    importService.extractPhotosWithLocation.mockImplementation(
      (
        _onProgress: unknown,
        _signal: unknown,
        _since: unknown,
        onBatch?: (photos: PhotoWithLocation[]) => void
      ) => {
        onBatch?.(batch);
        return Promise.resolve(batch);
      }
    );
    const detailEmits: TripScanDetail[] = [];

    await runScanPass(makeContext(detailEmits), { homeCountry: 'US' });

    const published = detailEmits.at(-1)!;
    expect(published.countryPreviews).toEqual([
      expect.objectContaining({ code: 'CA', name: 'Canada' }),
    ]);
  });
});
