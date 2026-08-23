/**
 * rankTripSegmentPreviews - the auto-curation seam that rewrites trip segment
 * preview strips best-first (plan 2026-08-21-001, step 3c target 1).
 *
 * Contract under test: flags off or tag-read failure leave the candidates
 * untouched; with tags loaded the previews reorder best-first with screenshots
 * excluded (unless the whole pool is screenshots); previewAssetIds[i] must
 * stay the asset for previewUris[i] throughout.
 */

import { rankTripSegmentPreviews } from '@services/photoImport/photoClusteringCache';

import type { PhotoIntentTag, PhotoMlTag } from '@services/photoImport/photoTagDb';
import type { PhotoWithLocation, TripCandidateDisplay } from '@services/photoImport/types';

jest.mock('@config/features', () => ({
  features: {
    enableIntentSignals: true,
    enableQualityRanking: true,
  },
}));

const mockGetTagsForIds = jest.fn();
const mockGetIntentTagsForIds = jest.fn();
jest.mock('@services/photoImport/photoTagDb', () => ({
  getTagsForIds: (ids: string[]) => mockGetTagsForIds(ids),
  getIntentTagsForIds: (ids: string[]) => mockGetIntentTagsForIds(ids),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { features } = jest.requireMock('@config/features') as {
  features: Record<string, boolean>;
};

// An hour apart: distinct scenes, so the near-duplicate collapse stays out of
// the way and order changes are attributable to quality alone.
const HOUR = 3_600_000;

function photo(id: string, creationTime: number): PhotoWithLocation {
  return {
    id,
    uri: `file://${id}.jpg`,
    filename: `${id}.jpg`,
    creationTime: new Date(creationTime),
    location: { latitude: 41.9, longitude: 12.5 },
  };
}

function candidate(photos: PhotoWithLocation[]): TripCandidateDisplay {
  return {
    id: 'seg1',
    countryCode: 'IT',
    dateRange: {
      start: photos[0].creationTime,
      end: photos[photos.length - 1].creationTime,
    },
    photoIds: photos.map((p) => p.id),
    photoCount: photos.length,
    previewUris: photos.map((p) => p.uri),
    previewAssetIds: photos.map((p) => p.id),
    locationClusterIds: [],
  };
}

function lookup(photos: PhotoWithLocation[]): Map<string, PhotoWithLocation> {
  return new Map(photos.map((p) => [p.id, p]));
}

function mlTag(id: string, overrides: Partial<PhotoMlTag> = {}): PhotoMlTag {
  return {
    id,
    taggerVersion: 1,
    status: 'ok',
    isScreenshot: false,
    faceCount: 0,
    maxFaceArea: 0,
    totalFaceArea: 0,
    humanCount: 0,
    maxHumanArea: 0,
    totalHumanArea: 0,
    labels: [],
    aestheticScore: null,
    isUtility: null,
    computedAt: 0,
    ...overrides,
  };
}

/** Favorited AND edited: strong intent that outscores a top aesthetic rank. */
function favorite(id: string): PhotoIntentTag {
  return {
    id,
    metaVersion: 1,
    isFavorite: true,
    hasAdjustments: true,
    subtypes: [],
    burstId: null,
    burstIsRepresentative: false,
    sourceUserLibrary: true,
    inUserAlbum: false,
    altitude: null,
    gpsSpeed: null,
    refreshedAt: 0,
  };
}

describe('rankTripSegmentPreviews', () => {
  beforeEach(() => {
    features.enableIntentSignals = true;
    features.enableQualityRanking = true;
    mockGetTagsForIds.mockReset().mockResolvedValue(new Map());
    mockGetIntentTagsForIds.mockReset().mockResolvedValue(new Map());
  });

  it('returns candidates untouched when enableQualityRanking is off', async () => {
    features.enableQualityRanking = false;
    const photos = [photo('a', 0), photo('b', HOUR)];
    const input = [candidate(photos)];

    const result = await rankTripSegmentPreviews(input, lookup(photos));

    expect(result).toBe(input);
    expect(mockGetTagsForIds).not.toHaveBeenCalled();
    expect(mockGetIntentTagsForIds).not.toHaveBeenCalled();
  });

  it('returns candidates untouched when enableIntentSignals is off', async () => {
    features.enableIntentSignals = false;
    const photos = [photo('a', 0), photo('b', HOUR)];
    const input = [candidate(photos)];

    const result = await rankTripSegmentPreviews(input, lookup(photos));

    expect(result).toBe(input);
    expect(mockGetTagsForIds).not.toHaveBeenCalled();
  });

  it('reorders previews best-first when tags are present, keeping uri/id alignment', async () => {
    const photos = [photo('dull', 0), photo('great', HOUR), photo('loved', 2 * HOUR)];
    mockGetTagsForIds.mockResolvedValue(
      new Map([
        ['dull', mlTag('dull', { aestheticScore: -0.4 })],
        ['great', mlTag('great', { aestheticScore: 0.8 })],
      ])
    );
    mockGetIntentTagsForIds.mockResolvedValue(new Map([['loved', favorite('loved')]]));

    const [result] = await rankTripSegmentPreviews([candidate(photos)], lookup(photos));

    expect(result.previewAssetIds).toEqual(['loved', 'great', 'dull']);
    // previewAssetIds[i] must remain the asset for previewUris[i].
    result.previewAssetIds.forEach((id, i) => {
      expect(result.previewUris[i]).toBe(`file://${id}.jpg`);
    });
    // Ranking only rewrites the preview strip - the full photo list and count
    // keep their chronological identity.
    expect(result.photoIds).toEqual(['dull', 'great', 'loved']);
    expect(result.photoCount).toBe(3);
  });

  it('excludes a screenshot from the previews', async () => {
    const photos = [photo('shot', 0), photo('screen', HOUR)];
    mockGetTagsForIds.mockResolvedValue(
      new Map([['screen', mlTag('screen', { isScreenshot: true })]])
    );

    const [result] = await rankTripSegmentPreviews([candidate(photos)], lookup(photos));

    expect(result.previewAssetIds).toEqual(['shot']);
    expect(result.previewUris).toEqual(['file://shot.jpg']);
  });

  it('keeps previews for a pool that is entirely screenshots', async () => {
    const photos = [photo('s1', 0), photo('s2', HOUR)];
    mockGetTagsForIds.mockResolvedValue(
      new Map([
        ['s1', mlTag('s1', { isScreenshot: true })],
        ['s2', mlTag('s2', { isScreenshot: true })],
      ])
    );

    const [result] = await rankTripSegmentPreviews([candidate(photos)], lookup(photos));

    expect(result.previewAssetIds).toEqual(['s1', 's2']);
  });

  it('degrades to the input when neither tag table has a row', async () => {
    // Android, pre-tagger binaries, and installs whose sweep has not run yet
    // land here. Timestamps straddle the golden-hour band (sun 3.3 deg up at
    // 04:00Z at the fixture coordinates, 66.3 deg at 10:00Z), which is exactly
    // the tag-free context signal that used to reorder these previews.
    const photos = [
      photo('midday', Date.parse('2024-06-15T10:00:00Z')),
      photo('sunrise', Date.parse('2024-06-15T04:00:00Z')),
    ];
    const input = [candidate(photos)];

    const [result] = await rankTripSegmentPreviews(input, lookup(photos));

    expect(result.previewAssetIds).toEqual(['midday', 'sunrise']);
    expect(result.previewUris).toEqual(['file://midday.jpg', 'file://sunrise.jpg']);
  });

  it('degrades to the input when the tag read fails', async () => {
    mockGetTagsForIds.mockRejectedValue(new Error('db locked'));
    const photos = [photo('a', 0), photo('b', HOUR)];
    const input = [candidate(photos)];

    const result = await rankTripSegmentPreviews(input, lookup(photos));

    expect(result).toBe(input);
  });

  it('leaves a single-photo segment alone', async () => {
    const photos = [photo('only', 0)];
    const input = [candidate(photos)];

    const [result] = await rankTripSegmentPreviews(input, lookup(photos));

    expect(result).toBe(input[0]);
  });
});
