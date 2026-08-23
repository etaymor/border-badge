/**
 * U2 - the once-per-cluster invariant.
 *
 * The only way auto-hiding is bad is if the app can undo a user's restore. The
 * seeding ref is the whole mitigation, so it gets its own test: after the user
 * brings a hidden photo back, no re-render, no re-fetch, and no return to the
 * screen may hide it again.
 *
 * Hosts the hook directly (`useLowSignalSeeding`) rather than the whole screen:
 * the screen render drags in navigation, safe-area, FlashList and a dozen
 * providers, none of which participate in this behavior.
 */

import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useState } from 'react';

import { useLowSignalSeeding } from '../../../screens/photos/PhotoImportScreen';
import { getCachedPhotosByCountry } from '@services/photoImport/photoCacheDb';
import { getIntentTagsForIds, getTagsForIds } from '@services/photoImport/photoTagDb';

import type { LocationClusterDisplay } from '@services/photoImport';
import type { PhotoMlTag } from '@services/photoImport/photoTagDb';

jest.mock('@services/photoImport/photoCacheDb', () => ({
  getCachedPhotosByCountry: jest.fn(),
}));

jest.mock('@services/photoImport/photoTagDb', () => ({
  getTagsForIds: jest.fn(),
  getIntentTagsForIds: jest.fn(),
}));

const mockedGetCachedPhotosByCountry = getCachedPhotosByCountry as jest.MockedFunction<
  typeof getCachedPhotosByCountry
>;
const mockedGetTagsForIds = getTagsForIds as jest.MockedFunction<typeof getTagsForIds>;
const mockedGetIntentTagsForIds = getIntentTagsForIds as jest.MockedFunction<
  typeof getIntentTagsForIds
>;

const ROME = { latitude: 41.9, longitude: 12.5 };
const BASE_MS = Date.parse('2024-06-15T10:00:00Z');
const HOUR = 3_600_000;

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

function cachedPhoto(id: string, creationTime: number) {
  return {
    id,
    uri: `file://${id}.jpg`,
    filename: `${id}.jpg`,
    creationTime,
    latitude: ROME.latitude,
    longitude: ROME.longitude,
    geohash: 'sr2yk',
    countryCode: 'IT',
  };
}

function cluster(id: string, photoIds: string[]): LocationClusterDisplay {
  return {
    id,
    geohash: 'sr2yk',
    centroid: ROME,
    photoIds,
    photoCount: photoIds.length,
    previewUris: photoIds.map((p) => `file://${p}.jpg`),
    previewAssetIds: photoIds,
    timeRange: { start: new Date(BASE_MS), end: new Date(BASE_MS + HOUR) },
    countryCode: 'IT',
  };
}

/**
 * The screen's own composition in miniature: exclusion state owned by the
 * host, the hook seeding into it, and the restore action the gallery calls.
 */
function useHost(clusterDisplays: Map<string, LocationClusterDisplay>) {
  const [excludedPhotoIds, setExcludedPhotoIds] = useState<Map<string, Set<string>>>(new Map());
  const [, forceRender] = useState(0);
  const seededPhotoIds = useLowSignalSeeding({
    countryCode: 'IT',
    clusterDisplays,
    setExcludedPhotoIds,
  });
  return {
    excludedPhotoIds,
    seededPhotoIds,
    restoreAll: (clusterId: string) =>
      setExcludedPhotoIds((prev) => {
        const next = new Map(prev);
        next.set(clusterId, new Set());
        return next;
      }),
    rerenderSelf: () => forceRender((n) => n + 1),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedGetCachedPhotosByCountry.mockResolvedValue([
    cachedPhoto('shot', BASE_MS),
    cachedPhoto('keep-a', BASE_MS + HOUR),
    cachedPhoto('keep-b', BASE_MS + 2 * HOUR),
  ]);
  mockedGetTagsForIds.mockResolvedValue(new Map([['shot', mlTag('shot', { isScreenshot: true })]]));
  mockedGetIntentTagsForIds.mockResolvedValue(new Map());
});

const displays = () => new Map([['c1', cluster('c1', ['shot', 'keep-a', 'keep-b'])]]);

describe('useLowSignalSeeding', () => {
  it('seeds the cluster exclusion set with its low-signal photos', async () => {
    const { result } = renderHook(() => useHost(displays()));

    await waitFor(() => {
      expect([...(result.current.excludedPhotoIds.get('c1') ?? [])]).toEqual(['shot']);
    });
    expect([...(result.current.seededPhotoIds.get('c1') ?? [])]).toEqual(['shot']);
  });

  it('never re-seeds a cluster after the user restored it', async () => {
    const { result, rerender } = renderHook(
      (clusters: Map<string, LocationClusterDisplay>) => useHost(clusters),
      { initialProps: displays() }
    );

    await waitFor(() => {
      expect(result.current.excludedPhotoIds.get('c1')?.size).toBe(1);
    });

    // The user taps "Show all".
    act(() => result.current.restoreAll('c1'));
    expect(result.current.excludedPhotoIds.get('c1')?.size).toBe(0);

    // A re-render...
    act(() => result.current.rerenderSelf());
    // ...and a re-fetch handing back a fresh, equal cluster map.
    rerender(displays());
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.excludedPhotoIds.get('c1')?.size).toBe(0);
    // Exactly one tag read: the second pass never even looked.
    expect(mockedGetTagsForIds).toHaveBeenCalledTimes(1);
  });

  it('seeds nothing when the library has no tag rows at all', async () => {
    mockedGetTagsForIds.mockResolvedValue(new Map());
    mockedGetIntentTagsForIds.mockResolvedValue(new Map());

    const { result } = renderHook(() => useHost(displays()));
    await waitFor(() => {
      expect(mockedGetTagsForIds).toHaveBeenCalled();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.excludedPhotoIds.size).toBe(0);
    // Bailed before the photo cache read.
    expect(mockedGetCachedPhotosByCountry).not.toHaveBeenCalled();
  });

  it('reads the tag maps once for every pending cluster, not once per cluster', async () => {
    const many = new Map([
      ['c1', cluster('c1', ['shot', 'keep-a'])],
      ['c2', cluster('c2', ['keep-b'])],
    ]);
    const { result } = renderHook(() => useHost(many));

    await waitFor(() => {
      expect(result.current.excludedPhotoIds.get('c1')?.size).toBe(1);
    });
    expect(mockedGetTagsForIds).toHaveBeenCalledTimes(1);
    expect(mockedGetIntentTagsForIds).toHaveBeenCalledTimes(1);
    expect(mockedGetCachedPhotosByCountry).toHaveBeenCalledTimes(1);
  });
});
