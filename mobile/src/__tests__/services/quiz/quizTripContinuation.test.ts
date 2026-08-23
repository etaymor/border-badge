/**
 * The trips half of the "one scan" promise.
 *
 * Both entry points tell the user the same scan builds their trips. Before
 * this ran, that was true of the CACHE and false of anything they could see:
 * the quiz path extracted the whole library and never segmented it. These
 * tests pin the three things that make the continuation safe to run after
 * every build — it never re-extracts, it never fabricates trips without a home
 * country, and it can never turn a finished challenge into a failure.
 */

jest.mock('@services/countriesDb', () => ({
  getHomeCountry: jest.fn(),
}));

jest.mock('@services/photoImport/photoCacheDb', () => ({
  getAllCachedPhotos: jest.fn(),
  getLastImportTime: jest.fn(),
  getMetadata: jest.fn(),
  getTripSegments: jest.fn(),
  saveTripSegments: jest.fn(),
  setMetadata: jest.fn(),
}));

jest.mock('@services/photoImport/photoCacheDbSuggestions', () => ({
  getAllSavedPhotoIds: jest.fn(),
  getClusterSplitsForParents: jest.fn(),
}));

jest.mock('@services/photoImport/photoClusteringCache', () => ({
  rankTripSegmentPreviews: jest.fn(),
  segmentTripsFromCache: jest.fn(),
}));

jest.mock('@services/photoImport/photoClusteringDisplay', () => ({
  applyPersistedSplits: jest.fn(),
  applySavedPhotoFilter: jest.fn(),
}));

jest.mock('@services/photoImport/photoTaggingService', () => ({
  maybeRunTaggingPass: jest.fn().mockResolvedValue(undefined),
}));

// The extractor the trip scan uses. Importing it here would be a false
// positive on its own, so the assertion below is that the continuation never
// reaches for it at all.
jest.mock('@services/photoImport/photoImportService', () => ({
  extractPhotosWithLocation: jest.fn(),
}));

import { getHomeCountry } from '@services/countriesDb';
import {
  getAllCachedPhotos,
  getLastImportTime,
  getMetadata,
  getTripSegments,
  saveTripSegments,
  setMetadata,
} from '@services/photoImport/photoCacheDb';
import {
  getAllSavedPhotoIds,
  getClusterSplitsForParents,
} from '@services/photoImport/photoCacheDbSuggestions';
import {
  rankTripSegmentPreviews,
  segmentTripsFromCache,
} from '@services/photoImport/photoClusteringCache';
import {
  applyPersistedSplits,
  applySavedPhotoFilter,
} from '@services/photoImport/photoClusteringDisplay';
import { extractPhotosWithLocation } from '@services/photoImport/photoImportService';
import { maybeRunTaggingPass } from '@services/photoImport/photoTaggingService';
import { runQuizTripContinuation } from '@services/quiz/quizTripContinuation';

const mockGetHomeCountry = getHomeCountry as jest.Mock;
const mockGetAllCachedPhotos = getAllCachedPhotos as jest.Mock;
const mockGetLastImportTime = getLastImportTime as jest.Mock;
const mockGetMetadata = getMetadata as jest.Mock;
const mockGetTripSegments = getTripSegments as jest.Mock;
const mockSaveTripSegments = saveTripSegments as jest.Mock;
const mockSetMetadata = setMetadata as jest.Mock;
const mockGetAllSavedPhotoIds = getAllSavedPhotoIds as jest.Mock;
const mockGetClusterSplits = getClusterSplitsForParents as jest.Mock;
const mockRankPreviews = rankTripSegmentPreviews as jest.Mock;
const mockSegment = segmentTripsFromCache as jest.Mock;
const mockApplySplits = applyPersistedSplits as jest.Mock;
const mockApplySavedFilter = applySavedPhotoFilter as jest.Mock;
const mockExtract = extractPhotosWithLocation as jest.Mock;
const mockTaggingPass = maybeRunTaggingPass as jest.Mock;

function candidate(id: string) {
  return {
    id,
    countryCode: 'FR',
    dateRange: { start: new Date('2024-05-01'), end: new Date('2024-05-08') },
    photoCount: 40,
    locationClusterIds: [`${id}-cluster`],
    previewUris: ['file:///a.jpg'],
    previewAssetIds: ['a'],
    photoIds: ['a', 'b'],
  };
}

beforeEach(() => {
  jest.clearAllMocks();

  mockGetHomeCountry.mockResolvedValue('US');
  mockGetAllCachedPhotos.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
  mockGetLastImportTime.mockResolvedValue(2_000);
  mockGetMetadata.mockResolvedValue(null);
  mockGetTripSegments.mockResolvedValue([]);
  mockSaveTripSegments.mockResolvedValue(undefined);
  mockSetMetadata.mockResolvedValue(undefined);
  mockGetAllSavedPhotoIds.mockResolvedValue(new Set());
  mockGetClusterSplits.mockResolvedValue(new Map());
  mockSegment.mockReturnValue({ clusterLookup: new Map([['c1', {}]]) });
  mockApplySplits.mockImplementation((segmented) => segmented);
  mockApplySavedFilter.mockReturnValue({
    data: { candidates: [candidate('t1'), candidate('t2')], photoLookup: new Map() },
    autoDismissed: new Set(),
  });
  mockRankPreviews.mockImplementation(async (candidates) => candidates);
});

describe('runQuizTripContinuation', () => {
  it('segments the photos the build already extracted, without re-extracting', async () => {
    const result = await runQuizTripContinuation();

    expect(result).toEqual({ status: 'segmented', segmentCount: 2 });
    expect(mockSegment).toHaveBeenCalledWith([{ id: 'a' }, { id: 'b' }], 'US');
    // The whole point: the expensive half of a trip scan never runs again.
    expect(mockExtract).not.toHaveBeenCalled();
    expect(mockSaveTripSegments).toHaveBeenCalledTimes(1);
    expect(mockSaveTripSegments.mock.calls[0][0]).toHaveLength(2);
    expect(mockTaggingPass).toHaveBeenCalled();
  });

  it('re-applies the user’s manual splits so a split does not vanish', async () => {
    await runQuizTripContinuation();
    expect(mockApplySplits).toHaveBeenCalled();
    expect(mockGetClusterSplits).toHaveBeenCalledWith(['c1']);
  });

  it('builds nothing without a home country', async () => {
    mockGetHomeCountry.mockResolvedValue(null);

    const result = await runQuizTripContinuation();

    // Segmenting without one produces "trips" made of the user's own town.
    expect(result).toEqual({ status: 'skipped', reason: 'no-home-country' });
    expect(mockSegment).not.toHaveBeenCalled();
  });

  it('skips a library that has not changed since the last continuation', async () => {
    mockGetTripSegments.mockResolvedValue([{ id: 't1' }]);
    mockGetMetadata.mockResolvedValue('2000');
    mockGetLastImportTime.mockResolvedValue(2_000);

    const result = await runQuizTripContinuation();

    expect(result).toEqual({ status: 'skipped', reason: 'unchanged' });
    expect(mockSegment).not.toHaveBeenCalled();
  });

  it('re-segments once new photos have been imported', async () => {
    mockGetTripSegments.mockResolvedValue([{ id: 't1' }]);
    mockGetMetadata.mockResolvedValue('2000');
    mockGetLastImportTime.mockResolvedValue(9_000);

    const result = await runQuizTripContinuation();

    expect(result.status).toBe('segmented');
    expect(mockSetMetadata).toHaveBeenCalledWith('quiz_trip_continuation_import_time', '9000');
  });

  it('reports a failure instead of throwing into the finished build', async () => {
    mockSegment.mockImplementation(() => {
      throw new Error('segmentation blew up');
    });

    await expect(runQuizTripContinuation()).resolves.toEqual({ status: 'failed' });
  });

  it('stops when the job was cancelled', async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await runQuizTripContinuation(controller.signal);

    expect(result).toEqual({ status: 'skipped', reason: 'cancelled' });
    expect(mockSaveTripSegments).not.toHaveBeenCalled();
  });
});
