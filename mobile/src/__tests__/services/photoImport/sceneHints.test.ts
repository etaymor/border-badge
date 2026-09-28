/**
 * Scene hints (venue-rollup plan U9, KTD6): free per-cluster hints derived from
 * the Apple Vision labels already stored in `photo_ml_tags`.
 */

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(),
  reverseGeocodeAsync: jest.fn(),
}));

jest.mock('../../../services/photoImport/photoTagDb', () => ({
  getTagsForIds: jest.fn().mockResolvedValue(new Map()),
}));

import { mapClusterToApiPayload } from '../../../screens/photos/photoImportUtils';
import { getTagsForIds } from '../../../services/photoImport/photoTagDb';
import type { PhotoMlTag, PhotoTagStatus } from '../../../services/photoImport/photoTagDb';
import {
  SCENE_HINT_IDENTIFIERS,
  SCENE_HINT_LABEL_FLOOR,
  SCENE_HINT_MIN_SHARE,
  deriveSceneHints,
  loadSceneHintsForClusters,
  withSceneHints,
} from '../../../services/photoImport/sceneHints';
import type { LocationCluster, PhotoWithLocation } from '../../../services/photoImport/types';

const mockGetTags = getTagsForIds as jest.Mock;

function tag(
  id: string,
  labels: Array<[string, number]>,
  status: PhotoTagStatus = 'ok'
): PhotoMlTag {
  return {
    id,
    taggerVersion: 1,
    status,
    isScreenshot: false,
    faceCount: 0,
    maxFaceArea: 0,
    totalFaceArea: 0,
    humanCount: 0,
    maxHumanArea: 0,
    totalHumanArea: 0,
    labels: labels.map(([identifier, confidence]) => ({ identifier, confidence })),
    aestheticScore: null,
    isUtility: null,
    computedAt: 0,
  };
}

/** `n` tagged photos with the same labels, ids prefixed to stay unique. */
function many(prefix: string, n: number, labels: Array<[string, number]>): PhotoMlTag[] {
  return Array.from({ length: n }, (_, i) => tag(`${prefix}-${i}`, labels));
}

function photo(id: string): PhotoWithLocation {
  return {
    id,
    uri: `file://${id}.jpg`,
    filename: `${id}.jpg`,
    creationTime: new Date('2024-03-15T12:00:00Z'),
    location: { latitude: 48.86103, longitude: 2.33583 },
  };
}

function cluster(id: string, photoIds: string[]): LocationCluster {
  const start = new Date('2024-03-15T12:00:00Z');
  return {
    id,
    geohash: 'u09tvw',
    centroid: { latitude: 48.86103, longitude: 2.33583 },
    photos: photoIds.map(photo),
    timeRange: { start, end: new Date('2024-03-15T13:00:00Z') },
    countryCode: 'FR',
  };
}

describe('deriveSceneHints', () => {
  it('emits artwork for a cluster whose tagged photos are 70% painting and art labels', () => {
    const tags = [
      ...many('paint', 4, [
        ['painting', 0.82],
        ['art', 0.9],
      ]),
      ...many('art', 3, [['art', 0.74]]),
      ...many('people', 3, [['people', 0.8]]),
    ];

    expect(deriveSceneHints(tags)).toEqual([{ label: 'artwork', weight: 0.7 }]);
  });

  it('emits nothing when there are no tags', () => {
    expect(deriveSceneHints([])).toEqual([]);
    expect(deriveSceneHints([undefined, undefined])).toEqual([]);
  });

  it('ignores rows without measured labels (no-local-image, error)', () => {
    const tags = [
      tag('a', [], 'no-local-image'),
      tag('b', [['painting', 0.9]], 'error'),
      tag('c', [], 'ok'),
    ];
    expect(deriveSceneHints(tags)).toEqual([]);
  });

  it('counts an offloaded photo whose tag row was measured while it was local', () => {
    // Offload does not rewrite the row: an `ok` row with labels is evidence
    // whether or not the pixels are on the device today.
    const tags = [tag('offloaded', [['museum', 0.8]])];
    expect(deriveSceneHints(tags)).toEqual([{ label: 'museum_interior', weight: 1 }]);
  });

  it('does not let untagged photos dilute the share', () => {
    const tags = [...many('food', 2, [['food', 0.9]]), undefined, undefined, undefined];
    expect(deriveSceneHints(tags)).toEqual([{ label: 'food', weight: 1 }]);
  });

  it('ignores labels below the per-photo confidence floor', () => {
    const below = SCENE_HINT_LABEL_FLOOR - 0.01;
    expect(deriveSceneHints(many('p', 5, [['painting', below]]))).toEqual([]);
    expect(deriveSceneHints(many('p', 5, [['painting', SCENE_HINT_LABEL_FLOOR]]))).toEqual([
      { label: 'artwork', weight: 1 },
    ]);
  });

  it('drops a hint whose share is under its threshold, keeps it at the threshold', () => {
    const share = SCENE_HINT_MIN_SHARE.food;
    const total = 20;
    const at = Math.round(share * total);
    const atThreshold = [
      ...many('f', at, [['dessert', 0.8]]),
      ...many('x', total - at, [['sky', 0.8]]),
    ];
    const below = [
      ...many('f', at - 1, [['dessert', 0.8]]),
      ...many('x', total - at + 1, [['sky', 0.8]]),
    ];
    expect(deriveSceneHints(atThreshold).map((h) => h.label)).toEqual(['food']);
    expect(deriveSceneHints(below)).toEqual([]);
  });

  it('counts a photo once per hint even when several of its labels map to it', () => {
    const tags = [
      tag('a', [
        ['food', 0.9],
        ['dessert', 0.8],
        ['cake', 0.7],
      ]),
      tag('b', [['sky', 0.9]]),
    ];
    expect(deriveSceneHints(tags)).toEqual([{ label: 'food', weight: 0.5 }]);
  });

  it('emits several hints sorted by weight, with rounded weights', () => {
    const tags = [
      ...many('m', 2, [
        ['museum', 0.7],
        ['painting', 0.6],
      ]),
      tag('p', [['painting', 0.6]]),
    ];
    expect(deriveSceneHints(tags)).toEqual([
      { label: 'artwork', weight: 1 },
      { label: 'museum_interior', weight: 0.67 },
    ]);
  });

  it('maps outdoor landmark identifiers', () => {
    expect(deriveSceneHints(many('t', 3, [['tower', 0.8]]))).toEqual([
      { label: 'outdoor_landmark', weight: 1 },
    ]);
  });

  it('ignores identifiers outside the mapping', () => {
    // "church" and "gallery" are not in Apple's classifier taxonomy; "people"
    // is, but maps to no hint.
    const tags = many('x', 4, [
      ['church', 0.9],
      ['gallery', 0.9],
      ['people', 0.9],
    ]);
    expect(deriveSceneHints(tags)).toEqual([]);
  });

  it('assigns every identifier to exactly one hint', () => {
    const seen = new Set<string>();
    for (const identifiers of Object.values(SCENE_HINT_IDENTIFIERS)) {
      for (const identifier of identifiers) {
        expect(seen.has(identifier)).toBe(false);
        seen.add(identifier);
      }
    }
  });
});

describe('loadSceneHintsForClusters', () => {
  beforeEach(() => mockGetTags.mockReset());

  it('reads every photo in the batch once and returns hints per cluster', async () => {
    mockGetTags.mockResolvedValue(
      new Map([
        ['a1', tag('a1', [['painting', 0.9]])],
        ['a2', tag('a2', [['art', 0.8]])],
        ['b1', tag('b1', [['sky', 0.9]])],
      ])
    );

    const hints = await loadSceneHintsForClusters([
      cluster('a', ['a1', 'a2']),
      cluster('b', ['b1', 'b2']),
    ]);

    expect(mockGetTags).toHaveBeenCalledTimes(1);
    expect(mockGetTags).toHaveBeenCalledWith(['a1', 'a2', 'b1', 'b2']);
    expect(hints.get('a')).toEqual([{ label: 'artwork', weight: 1 }]);
    expect(hints.has('b')).toBe(false);
  });

  it('degrades to no hints when the tag read fails', async () => {
    mockGetTags.mockRejectedValue(new Error('db locked'));
    const hints = await loadSceneHintsForClusters([cluster('a', ['a1'])]);
    expect(hints.size).toBe(0);
  });

  it('makes no read for an empty batch', async () => {
    const hints = await loadSceneHintsForClusters([]);
    expect(hints.size).toBe(0);
    expect(mockGetTags).not.toHaveBeenCalled();
  });
});

describe('scene_hints on the request payload', () => {
  const base = cluster('c', ['p1']);

  it('omits the key entirely when there are no hints', () => {
    expect('scene_hints' in mapClusterToApiPayload(base, [])).toBe(false);
    expect('scene_hints' in mapClusterToApiPayload(base, [], [])).toBe(false);
    expect('scene_hints' in withSceneHints(mapClusterToApiPayload(base, []), undefined)).toBe(
      false
    );
    expect('scene_hints' in withSceneHints(mapClusterToApiPayload(base, []), [])).toBe(false);
  });

  it('carries the hints as {label, weight} when present', () => {
    const hints = [{ label: 'artwork' as const, weight: 0.7 }];
    expect(mapClusterToApiPayload(base, [], hints).scene_hints).toEqual(hints);
    expect(withSceneHints(mapClusterToApiPayload(base, []), hints).scene_hints).toEqual(hints);
  });
});
