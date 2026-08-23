/**
 * U1 - what the trip matching gallery is allowed to hide.
 *
 * The asymmetry under test: a mis-RANKED photo costs nothing, a mis-HIDDEN
 * photo is invisible. So these tests pin the two rules that fire and, just as
 * importantly, the floors that stop them.
 */

import { lowSignalPhotoIds } from '@services/photoSignals/lowSignalPhotos';

import type { PhotoIntentTag, PhotoMlTag } from '@services/photoImport/photoTagDb';
import type { CaptureContextPhoto } from '@services/photoSignals/captureContext';

const ROME = { latitude: 41.9, longitude: 12.5 };
const HOUR = 3_600_000;
const BASE_MS = Date.parse('2024-06-15T10:00:00Z');

function photo(
  id: string,
  creationTime: number,
  coords: { latitude: number; longitude: number } = ROME
): CaptureContextPhoto {
  return { id, creationTime, ...coords, countryCode: 'IT' };
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

function intentTag(id: string, overrides: Partial<PhotoIntentTag> = {}): PhotoIntentTag {
  return {
    id,
    metaVersion: 1,
    isFavorite: false,
    hasAdjustments: false,
    subtypes: [],
    burstId: null,
    burstIsRepresentative: false,
    sourceUserLibrary: true,
    inUserAlbum: false,
    altitude: null,
    gpsSpeed: null,
    refreshedAt: 0,
    ...overrides,
  };
}

describe('lowSignalPhotoIds - rule 1, utility images', () => {
  it('hides a screenshot flagged by the ML tagger', () => {
    const photos = [photo('shot', BASE_MS), photo('keep', BASE_MS + HOUR)];
    const hidden = lowSignalPhotoIds(photos, {
      mlTags: new Map([['shot', mlTag('shot', { isScreenshot: true })]]),
    });
    expect([...hidden]).toEqual(['shot']);
  });

  it('hides an iOS 18 utility image (receipt, document scan)', () => {
    const photos = [photo('receipt', BASE_MS), photo('keep', BASE_MS + HOUR)];
    const hidden = lowSignalPhotoIds(photos, {
      mlTags: new Map([['receipt', mlTag('receipt', { isUtility: true })]]),
    });
    expect([...hidden]).toEqual(['receipt']);
  });

  it('hides a photo whose PhotoKit intent subtype is screenshot', () => {
    const photos = [photo('shot', BASE_MS), photo('keep', BASE_MS + HOUR)];
    const hidden = lowSignalPhotoIds(photos, {
      intentTags: new Map([['shot', intentTag('shot', { subtypes: ['screenshot'] })]]),
    });
    expect([...hidden]).toEqual(['shot']);
  });
});

describe('lowSignalPhotoIds - rule 2, near-duplicate runs', () => {
  // Three frames 10s apart at one coordinate: one burst. Two must go.
  const burst = [
    photo('burst-1', BASE_MS),
    photo('burst-2', BASE_MS + 10_000),
    photo('burst-3', BASE_MS + 20_000),
  ];

  it('hides every frame of a burst except its best', () => {
    const photos = [...burst, photo('other', BASE_MS + HOUR)];
    const hidden = lowSignalPhotoIds(photos, {
      // A favorite is the strongest keeper prior, so frame 1 survives even
      // though the collapse default keeps the newest.
      intentTags: new Map([['burst-1', intentTag('burst-1', { isFavorite: true })]]),
    });
    expect([...hidden].sort()).toEqual(['burst-2', 'burst-3']);
  });

  it('leaves distinct scenes alone', () => {
    const photos = [
      photo('a', BASE_MS),
      photo('b', BASE_MS + HOUR),
      photo('c', BASE_MS + 2 * HOUR),
    ];
    const hidden = lowSignalPhotoIds(photos, {
      mlTags: new Map([['a', mlTag('a')]]),
    });
    expect(hidden.size).toBe(0);
  });

  it('does not use the composite quality score as a drop rule', () => {
    // Two distinct scenes, one plainly better (favorited + edited). The worse
    // one is still not a screenshot and not a duplicate, so it stays.
    const photos = [photo('great', BASE_MS), photo('plain', BASE_MS + HOUR)];
    const hidden = lowSignalPhotoIds(photos, {
      intentTags: new Map([
        [
          'great',
          intentTag('great', { isFavorite: true, hasAdjustments: true, inUserAlbum: true }),
        ],
      ]),
    });
    expect(hidden.size).toBe(0);
  });
});

describe('lowSignalPhotoIds - floors', () => {
  it('hides nothing when every photo is a screenshot', () => {
    const photos = [photo('a', BASE_MS), photo('b', BASE_MS + HOUR)];
    const hidden = lowSignalPhotoIds(photos, {
      mlTags: new Map([
        ['a', mlTag('a', { isScreenshot: true })],
        ['b', mlTag('b', { isScreenshot: true })],
      ]),
    });
    expect(hidden.size).toBe(0);
  });

  it('hides nothing when the whole cluster is one burst', () => {
    // Collapse would leave one frame, so this is not the all-excluded floor -
    // the survivor proves the run collapsed rather than the floor firing.
    const photos = [
      photo('a', BASE_MS),
      photo('b', BASE_MS + 10_000),
      photo('c', BASE_MS + 20_000),
    ];
    const hidden = lowSignalPhotoIds(photos, { mlTags: new Map([['a', mlTag('a')]]) });
    expect(hidden.size).toBe(photos.length - 1);
  });

  it('never hides the anchor photo, even when it is a screenshot', () => {
    // 'anchor' sits on the centroid; the other is ~1.5km away.
    const photos = [
      photo('anchor', BASE_MS, ROME),
      photo('far', BASE_MS + HOUR, { latitude: 41.9135, longitude: 12.5 }),
    ];
    const hidden = lowSignalPhotoIds(photos, {
      mlTags: new Map([
        ['anchor', mlTag('anchor', { isScreenshot: true })],
        ['far', mlTag('far', { isScreenshot: true })],
      ]),
      anchor: ROME,
    });
    expect([...hidden]).toEqual(['far']);
  });

  it('spends the anchor exemption on a real photo when coordinates tie', () => {
    // Every photo in a cluster commonly shares one coordinate, so the anchor is
    // a tie. It must not resolve to the screenshot and keep it on screen.
    const photos = [photo('shot', BASE_MS), photo('real', BASE_MS + HOUR)];
    const hidden = lowSignalPhotoIds(photos, {
      mlTags: new Map([['shot', mlTag('shot', { isScreenshot: true })]]),
      anchor: ROME,
    });
    expect([...hidden]).toEqual(['shot']);
  });

  it('hides nothing in a single-photo cluster', () => {
    const hidden = lowSignalPhotoIds([photo('only', BASE_MS)], {
      mlTags: new Map([['only', mlTag('only', { isScreenshot: true })]]),
    });
    expect(hidden.size).toBe(0);
  });

  it('hides nothing in an untagged pool of distinct scenes', () => {
    // Android, a pre-tagger binary, an install whose sweep has not run. The
    // caller also bails on an empty tag map (U2); this pins that the function
    // itself invents no evidence.
    const photos = [
      photo('a', BASE_MS),
      photo('b', BASE_MS + HOUR),
      photo('c', BASE_MS + 2 * HOUR),
    ];
    expect(lowSignalPhotoIds(photos).size).toBe(0);
  });
});
