/**
 * Tests for the photo clustering display helpers — specifically the load-time
 * passes that make manual splits and entry-level photo dismissal survive
 * across sessions.
 */

import {
  applyPersistedSplits,
  applySavedPhotoFilter,
  createPhotoLookupMap,
  toLocationClusterDisplay,
  toTripCandidateDisplay,
} from '../../../services/photoImport/photoClusteringDisplay';
import type {
  LocationCluster,
  PhotoWithLocation,
  TripCandidate,
  TripCandidateDisplay,
} from '../../../services/photoImport/types';
import type { OptimizedTripData } from '../../../services/photoImport/photoClusteringDisplay';

function makePhoto(id: string, minutesOffset = 0): PhotoWithLocation {
  return {
    id,
    uri: `file://${id}.jpg`,
    filename: `${id}.jpg`,
    creationTime: new Date(new Date('2024-06-01T10:00:00Z').getTime() + minutesOffset * 60 * 1000),
    location: { latitude: 35.6762, longitude: 139.6503 },
  };
}

function makeCluster(id: string, photos: PhotoWithLocation[]): LocationCluster {
  const sorted = [...photos].sort((a, b) => a.creationTime.getTime() - b.creationTime.getTime());
  return {
    id,
    geohash: id,
    centroid: { latitude: 35.6762, longitude: 139.6503 },
    photos,
    timeRange: {
      start: sorted[0].creationTime,
      end: sorted[sorted.length - 1].creationTime,
    },
    countryCode: 'JP',
  };
}

function makeData(clusters: LocationCluster[]): OptimizedTripData {
  const allPhotos = clusters.flatMap((c) => c.photos);
  const clusterLookup = new Map(clusters.map((c) => [c.id, c]));
  const clusterDisplays = new Map(clusters.map((c) => [c.id, toLocationClusterDisplay(c)]));

  const candidate: TripCandidateDisplay = {
    id: 'trip-1',
    countryCode: 'JP',
    dateRange: {
      start: new Date('2024-06-01T10:00:00Z'),
      end: new Date('2024-06-01T20:00:00Z'),
    },
    photoIds: allPhotos.map((p) => p.id),
    photoCount: allPhotos.length,
    previewUris: allPhotos.map((p) => p.uri),
    previewAssetIds: allPhotos.map((p) => p.id),
    locationClusterIds: clusters.map((c) => c.id),
  };

  return {
    candidates: [candidate],
    photoLookup: createPhotoLookupMap(allPhotos),
    clusterLookup,
    clusterDisplays,
  };
}

describe('applyPersistedSplits', () => {
  it('replaces parent IDs with persisted sub-cluster IDs in candidate lists', () => {
    const photos = [makePhoto('p1'), makePhoto('p2', 1), makePhoto('p3', 2), makePhoto('p4', 3)];
    const data = makeData([makeCluster('parent-1', photos)]);

    const splitsByParent = new Map([
      [
        'parent-1',
        [
          {
            subClusterId: 'parent-1__split_a',
            parentClusterId: 'parent-1',
            photoIds: ['p1', 'p2'],
          },
          {
            subClusterId: 'parent-1__split_b',
            parentClusterId: 'parent-1',
            photoIds: ['p3', 'p4'],
          },
        ],
      ],
    ]);

    const result = applyPersistedSplits(data, splitsByParent);

    expect(result.candidates[0].locationClusterIds).toEqual([
      'parent-1__split_a',
      'parent-1__split_b',
    ]);
    expect(result.clusterLookup.get('parent-1__split_a')!.photos.map((p) => p.id)).toEqual([
      'p1',
      'p2',
    ]);
    expect(result.clusterLookup.get('parent-1__split_b')!.photos.map((p) => p.id)).toEqual([
      'p3',
      'p4',
    ]);
    expect(result.clusterDisplays.has('parent-1__split_a')).toBe(true);
    expect(result.clusterDisplays.has('parent-1__split_b')).toBe(true);
  });

  it('is idempotent — applying twice produces the same candidate IDs', () => {
    const photos = [makePhoto('p1'), makePhoto('p2', 1)];
    const data = makeData([makeCluster('parent-1', photos)]);

    const splitsByParent = new Map([
      [
        'parent-1',
        [
          {
            subClusterId: 'parent-1__split_a',
            parentClusterId: 'parent-1',
            photoIds: ['p1'],
          },
          {
            subClusterId: 'parent-1__split_b',
            parentClusterId: 'parent-1',
            photoIds: ['p2'],
          },
        ],
      ],
    ]);

    const first = applyPersistedSplits(data, splitsByParent);
    // After the first pass `parent-1` is no longer in candidate IDs, so the
    // second pass has nothing to rewrite — idempotent by construction.
    const second = applyPersistedSplits(first, splitsByParent);

    expect(second.candidates[0].locationClusterIds).toEqual([
      'parent-1__split_a',
      'parent-1__split_b',
    ]);
  });

  it('skips parents whose split rows reference photos that no longer exist', () => {
    const data = makeData([makeCluster('parent-1', [makePhoto('p1')])]);

    const splitsByParent = new Map([
      [
        'parent-1',
        [
          {
            subClusterId: 'parent-1__split_a',
            parentClusterId: 'parent-1',
            photoIds: ['gone-1', 'gone-2'],
          },
          {
            subClusterId: 'parent-1__split_b',
            parentClusterId: 'parent-1',
            photoIds: ['gone-3'],
          },
        ],
      ],
    ]);

    const result = applyPersistedSplits(data, splitsByParent);
    // No sub-cluster materialized → parent stays in the candidate list.
    expect(result.candidates[0].locationClusterIds).toEqual(['parent-1']);
    expect(result.clusterLookup.has('parent-1__split_a')).toBe(false);
    expect(result.clusterLookup.has('parent-1__split_b')).toBe(false);
  });

  it('is a no-op when there are no persisted splits', () => {
    const data = makeData([makeCluster('parent-1', [makePhoto('p1')])]);
    const result = applyPersistedSplits(data, new Map());
    expect(result).toBe(data);
  });
});

describe('applySavedPhotoFilter', () => {
  it('auto-dismisses clusters whose photos are entirely saved', () => {
    const data = makeData([
      makeCluster('cluster-1', [makePhoto('p1'), makePhoto('p2', 1)]),
      makeCluster('cluster-2', [makePhoto('p3', 2)]),
    ]);

    const { autoDismissed, data: filtered } = applySavedPhotoFilter(data, new Set(['p1', 'p2']));

    expect(autoDismissed).toEqual(new Set(['cluster-1']));
    expect(filtered.clusterLookup.get('cluster-2')!.photos.map((p) => p.id)).toEqual(['p3']);
  });

  it('trims saved photos out of partially-saved clusters', () => {
    const data = makeData([
      makeCluster('cluster-1', [makePhoto('p1'), makePhoto('p2', 1), makePhoto('p3', 2)]),
    ]);

    const { autoDismissed, data: filtered } = applySavedPhotoFilter(data, new Set(['p1']));

    expect(autoDismissed.size).toBe(0);
    expect(filtered.clusterLookup.get('cluster-1')!.photos.map((p) => p.id)).toEqual(['p2', 'p3']);
    expect(filtered.clusterDisplays.get('cluster-1')!.photoIds).toEqual(['p2', 'p3']);
  });

  it('returns the input unchanged when the saved set is empty', () => {
    const data = makeData([makeCluster('cluster-1', [makePhoto('p1')])]);
    const { autoDismissed, data: out } = applySavedPhotoFilter(data, new Set());
    expect(autoDismissed.size).toBe(0);
    expect(out).toBe(data);
  });
});

describe('previewAssetIds alignment', () => {
  it('toLocationClusterDisplay emits previewAssetIds positionally aligned with previewUris', () => {
    // More photos than the preview cap so both arrays get sliced identically.
    const photos = Array.from({ length: 35 }, (_, i) => makePhoto(`p${i}`, i));
    const display = toLocationClusterDisplay(makeCluster('c1', photos));

    // Same length (both capped at the preview limit) and each id maps to its uri.
    expect(display.previewAssetIds).toHaveLength(display.previewUris.length);
    display.previewAssetIds.forEach((id, i) => {
      expect(display.previewUris[i]).toBe(`file://${id}.jpg`);
    });
  });

  it('toTripCandidateDisplay emits previewAssetIds aligned with previewUris', () => {
    const photos = Array.from({ length: 35 }, (_, i) => makePhoto(`p${i}`, i));
    const candidate: TripCandidate = {
      id: 'trip-1',
      countryCode: 'JP',
      dateRange: { start: photos[0].creationTime, end: photos[photos.length - 1].creationTime },
      photos,
      locationClusters: [makeCluster('c1', photos)],
    };

    const display = toTripCandidateDisplay(candidate);

    expect(display.previewAssetIds).toHaveLength(display.previewUris.length);
    display.previewAssetIds.forEach((id, i) => {
      expect(display.previewUris[i]).toBe(`file://${id}.jpg`);
    });
  });
});
