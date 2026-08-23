import { rankBestPhotos } from '@services/photoSignals/bestPhotos';

import type { PhotoIntentTag, PhotoMlTag } from '@services/photoImport/photoTagDb';
import type { CaptureContextPhoto } from '@services/photoSignals/captureContext';

function photo(id: string, creationTime: number): CaptureContextPhoto {
  return { id, creationTime, latitude: 41.9, longitude: 12.5, countryCode: 'IT' };
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

function favorite(id: string): PhotoIntentTag {
  return {
    id,
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
}

// An hour apart: distinct scenes, no duplicate collapse in play.
const HOUR = 3_600_000;

// Two moments at the Rome fixture coordinates that straddle the golden-hour
// band: sun 3.3 deg up at 04:00Z (inside), 66.3 deg at 10:00Z (outside).
const GOLDEN_HOUR_MS = Date.parse('2024-06-15T04:00:00Z');
const MIDDAY_MS = Date.parse('2024-06-15T10:00:00Z');

describe('rankBestPhotos', () => {
  // Capture context needs no tag row, so "no tags" is NOT "no ranking". Callers
  // that must preserve input order on an untagged library have to skip the
  // call; this pair pins which half of that is true.
  it('still reorders an untagged pool across a golden-hour boundary', () => {
    const photos = [photo('midday', MIDDAY_MS), photo('sunrise', GOLDEN_HOUR_MS)];
    expect(rankBestPhotos(photos).map((p) => p.id)).toEqual(['sunrise', 'midday']);
  });

  it('keeps input order for an untagged pool with no context to separate it', () => {
    // All three are night shots at the same spot: identical contexts, so the
    // stable sort has nothing to act on.
    const photos = [photo('a', 0), photo('b', HOUR), photo('c', 2 * HOUR)];
    expect(rankBestPhotos(photos).map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });

  it('sorts by aesthetic rank when measured', () => {
    const photos = [photo('dull', 0), photo('great', HOUR)];
    const mlTags = new Map([
      ['dull', mlTag('dull', { aestheticScore: -0.4 })],
      ['great', mlTag('great', { aestheticScore: 0.8 })],
    ]);
    expect(rankBestPhotos(photos, { mlTags }).map((p) => p.id)).toEqual(['great', 'dull']);
  });

  it('puts a favorite first even against a prettier photo', () => {
    const photos = [photo('pretty', 0), photo('loved', HOUR)];
    const mlTags = new Map([['pretty', mlTag('pretty', { aestheticScore: 0.9 })]]);
    const intentTags = new Map([['loved', favorite('loved')]]);
    expect(rankBestPhotos(photos, { mlTags, intentTags })[0].id).toBe('loved');
  });

  it('excludes screenshots and utility images', () => {
    const photos = [photo('shot', 0), photo('screen', HOUR), photo('receipt', 2 * HOUR)];
    const mlTags = new Map([
      ['screen', mlTag('screen', { isScreenshot: true })],
      ['receipt', mlTag('receipt', { isUtility: true })],
    ]);
    expect(rankBestPhotos(photos, { mlTags }).map((p) => p.id)).toEqual(['shot']);
  });

  it('still returns something when the whole pool is screenshots', () => {
    const photos = [photo('s1', 0), photo('s2', HOUR)];
    const mlTags = new Map([
      ['s1', mlTag('s1', { isScreenshot: true })],
      ['s2', mlTag('s2', { isScreenshot: true })],
    ]);
    expect(rankBestPhotos(photos, { mlTags })).toHaveLength(2);
  });

  it('collapses a burst to its best frame', () => {
    const photos = [photo('frame1', 0), photo('frame2', 1_000), photo('other', HOUR)];
    const mlTags = new Map([
      ['frame1', mlTag('frame1', { aestheticScore: 0.9 })],
      ['frame2', mlTag('frame2', { aestheticScore: -0.9 })],
    ]);
    const ids = rankBestPhotos(photos, { mlTags }).map((p) => p.id);
    expect(ids).toContain('frame1');
    expect(ids).not.toContain('frame2');
  });

  it('applies the limit after ranking', () => {
    const photos = [photo('a', 0), photo('b', HOUR)];
    const mlTags = new Map([
      ['a', mlTag('a', { aestheticScore: -0.5 })],
      ['b', mlTag('b', { aestheticScore: 0.9 })],
    ]);
    expect(rankBestPhotos(photos, { mlTags, limit: 1 }).map((p) => p.id)).toEqual(['b']);
  });
});
