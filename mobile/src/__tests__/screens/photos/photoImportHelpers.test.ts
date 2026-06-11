/**
 * Tests for photoImportHelpers — focused on B4 (merged-suggestion null path).
 *
 * B4: `createMergedSuggestion` returns null when the primary cluster
 * (clusterIds[0]) is missing from the suggestion map — a race where one cluster
 * in a merge group is dismissed mid-merge. The pre-fix `useClusterItems` merged
 * push then emits NOTHING, so the WHOLE merged card (and every cluster in it)
 * silently vanishes with only a dev `console.error`.
 *
 * The fix DEGRADES to individual `suggestion` cards for the clusters that still
 * have their own entry in `clusterSuggestionMap`, so no cluster disappears.
 */

import { renderHook } from '@testing-library/react-native';

import type { ClusterDisplayItem } from '../../../screens/photos/photoImportHelpers';
// Import the real module so we can both call createMergedSuggestion directly AND
// spy on it for the useClusterItems degrade path.
import * as photoImportHelpers from '../../../screens/photos/photoImportHelpers';
import { useClusterItems } from '../../../screens/photos/useClusterItems';
import type { useSuggestPlacesChunked } from '../../../hooks/usePhotoImport';
import type { FailedClusterIds } from '../../../hooks/usePhotoImport';
import type {
  ClusterSuggestion,
  LocationClusterDisplay,
  PlaceSuggestion,
  TripCandidateDisplay,
} from '../../../services/photoImport';

// ---- Builders --------------------------------------------------------------

const buildCluster = (id: string): LocationClusterDisplay => ({
  id,
  geohash: 'ghxxxxx',
  centroid: { latitude: 35.0, longitude: 139.0 },
  photoIds: [`${id}-p1`, `${id}-p2`],
  photoCount: 2,
  previewUris: [`https://example.com/${id}-1.jpg`, `https://example.com/${id}-2.jpg`],
  timeRange: { start: new Date('2026-01-01T10:00:00Z'), end: new Date('2026-01-01T12:00:00Z') },
  countryCode: 'JP',
});

const buildPlace = (overrides: Partial<PlaceSuggestion> = {}): PlaceSuggestion => ({
  place_id: 'ChIJ_shared',
  name: 'Shared Place',
  address: '1 Shared St',
  location: { latitude: 35.0, longitude: 139.0 },
  category: 'place',
  distance_m: 10,
  types: ['point_of_interest'],
  ...overrides,
});

const buildSuggestion = (clusterId: string, places: PlaceSuggestion[]): ClusterSuggestion => ({
  cluster_id: clusterId,
  photo_ids: [`${clusterId}-p1`],
  places,
});

const buildCandidate = (clusterIds: string[]): TripCandidateDisplay => ({
  id: 'candidate-1',
  countryCode: 'JP',
  dateRange: { start: new Date('2026-01-01T00:00:00Z'), end: new Date('2026-01-02T00:00:00Z') },
  photoIds: [],
  photoCount: 10,
  previewUris: [],
  locationClusterIds: clusterIds,
});

const buildMutation = (opts: {
  isPending?: boolean;
  partialResults?: ClusterSuggestion[];
  suggestions?: ClusterSuggestion[];
  failedClusterIds?: FailedClusterIds;
}): ReturnType<typeof useSuggestPlacesChunked> => {
  const { isPending = false, partialResults = [], suggestions, failedClusterIds } = opts;
  return {
    isPending,
    partialResults,
    data: suggestions ? { suggestions } : undefined,
    failedClusterIds: failedClusterIds ?? new Map(),
  } as unknown as ReturnType<typeof useSuggestPlacesChunked>;
};

const renderItems = (params: {
  clusterIds: string[];
  clusters: LocationClusterDisplay[];
  mutation: ReturnType<typeof useSuggestPlacesChunked>;
  cachedSuggestions?: ClusterSuggestion[];
  dismissed?: Set<string>;
  fetching?: boolean;
}): ClusterDisplayItem[] => {
  const clusterDisplays = new Map<string, LocationClusterDisplay>();
  for (const c of params.clusters) clusterDisplays.set(c.id, c);

  const { result } = renderHook(() =>
    useClusterItems({
      selectedCandidate: buildCandidate(params.clusterIds),
      clusterDisplays,
      suggestPlacesMutation: params.mutation,
      cachedSuggestions: params.cachedSuggestions ?? [],
      dismissedClusterIdsInternal: params.dismissed ?? new Set(),
      fetchingSuggestions: params.fetching ?? false,
    })
  );
  return result.current;
};

// ---- createMergedSuggestion (unit) -----------------------------------------

describe('createMergedSuggestion', () => {
  it('returns null and logs when the primary cluster is missing from the suggestion map (B4 race)', () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const clusterDisplays = new Map<string, LocationClusterDisplay>([
      ['c-primary', buildCluster('c-primary')],
      ['c-secondary', buildCluster('c-secondary')],
    ]);
    // Suggestion map has ONLY the secondary — primary was dismissed mid-merge.
    const clusterSuggestionMap = new Map([
      [
        'c-secondary',
        {
          suggestion: buildSuggestion('c-secondary', [buildPlace()]),
          cluster: buildCluster('c-secondary'),
        },
      ],
    ]);

    const merged = photoImportHelpers.createMergedSuggestion(
      ['c-primary', 'c-secondary'],
      clusterSuggestionMap,
      clusterDisplays
    );

    expect(merged).toBeNull();
    // The dev console.error is preserved for diagnosis (plan requirement).
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('builds a merged suggestion when the primary cluster IS present', () => {
    const clusterDisplays = new Map<string, LocationClusterDisplay>([
      ['c-primary', buildCluster('c-primary')],
      ['c-secondary', buildCluster('c-secondary')],
    ]);
    const clusterSuggestionMap = new Map([
      [
        'c-primary',
        {
          suggestion: buildSuggestion('c-primary', [buildPlace()]),
          cluster: buildCluster('c-primary'),
        },
      ],
      [
        'c-secondary',
        {
          suggestion: buildSuggestion('c-secondary', [buildPlace()]),
          cluster: buildCluster('c-secondary'),
        },
      ],
    ]);

    const merged = photoImportHelpers.createMergedSuggestion(
      ['c-primary', 'c-secondary'],
      clusterSuggestionMap,
      clusterDisplays
    );

    expect(merged).not.toBeNull();
    expect(merged!.primaryClusterId).toBe('c-primary');
    expect(merged!.clusterIds).toEqual(['c-primary', 'c-secondary']);
  });
});

// ---- useClusterItems merged-null degrade (B4 integration) ------------------

describe('useClusterItems merged-suggestion degrade (B4)', () => {
  it('happy path: two clusters sharing a place merge into one card', () => {
    const cA = buildCluster('group-a');
    const cB = buildCluster('group-b');
    const sharedPlace = buildPlace({ place_id: 'ChIJ_group' });
    const suggestions = [
      buildSuggestion('group-a', [sharedPlace]),
      buildSuggestion('group-b', [sharedPlace]),
    ];

    const items = renderItems({
      clusterIds: ['group-a', 'group-b'],
      clusters: [cA, cB],
      mutation: buildMutation({ suggestions }),
    });

    const merged = items.find((i) => i.type === 'merged-suggestion');
    expect(merged).toBeDefined();
    if (merged && merged.type === 'merged-suggestion') {
      expect(new Set(merged.data.clusterIds)).toEqual(new Set(['group-a', 'group-b']));
    }
  });

  it('B4 repro + fix: when createMergedSuggestion returns null, degrades to individual cards (no vanish)', () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    // Force the merged-build null path deterministically. The pre-fix code pushes
    // NOTHING on null, so BOTH clusters of the group vanish. The fix must fall
    // back to individual `suggestion` cards for the clusters that still have a
    // suggestion entry.
    const mergedSpy = jest
      .spyOn(photoImportHelpers, 'createMergedSuggestion')
      .mockReturnValue(null);

    const cA = buildCluster('group-a');
    const cB = buildCluster('group-b');
    const sharedPlace = buildPlace({ place_id: 'ChIJ_group' });
    const suggestions = [
      buildSuggestion('group-a', [sharedPlace]),
      buildSuggestion('group-b', [sharedPlace]),
    ];

    const items = renderItems({
      clusterIds: ['group-a', 'group-b'],
      clusters: [cA, cB],
      mutation: buildMutation({ suggestions }),
    });

    expect(mergedSpy).toHaveBeenCalled();

    // No cluster silently disappears: both still render as `suggestion` cards.
    const renderedClusterIds = new Set<string>();
    for (const item of items) {
      if (item.type === 'suggestion') renderedClusterIds.add(item.data.cluster_id);
      else if (item.type === 'merged-suggestion') {
        for (const id of item.data.clusterIds) renderedClusterIds.add(id);
      }
    }
    expect(renderedClusterIds.has('group-a')).toBe(true);
    expect(renderedClusterIds.has('group-b')).toBe(true);
    // The degrade path must NOT emit a merged card (it failed to build).
    expect(items.some((i) => i.type === 'merged-suggestion')).toBe(false);

    mergedSpy.mockRestore();
    consoleError.mockRestore();
  });

  it('B4 fix: a group member missing its own suggestion entry routes through normal state (not double-emitted)', () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const mergedSpy = jest
      .spyOn(photoImportHelpers, 'createMergedSuggestion')
      .mockReturnValue(null);

    // group-a + group-b share a place (grouped together). group-c is a separate
    // matched cluster that should be unaffected. Even on the degrade, every
    // member of the group must appear exactly once.
    const cA = buildCluster('group-a');
    const cB = buildCluster('group-b');
    const cC = buildCluster('solo-c');
    const sharedPlace = buildPlace({ place_id: 'ChIJ_group' });
    const suggestions = [
      buildSuggestion('group-a', [sharedPlace]),
      buildSuggestion('group-b', [sharedPlace]),
      buildSuggestion('solo-c', [buildPlace({ place_id: 'ChIJ_solo' })]),
    ];

    const items = renderItems({
      clusterIds: ['group-a', 'group-b', 'solo-c'],
      clusters: [cA, cB, cC],
      mutation: buildMutation({ suggestions }),
    });

    // Each cluster rendered exactly once — no duplicates from the degrade.
    const suggestionIds = items
      .filter((i) => i.type === 'suggestion')
      .map((i) => (i.type === 'suggestion' ? i.data.cluster_id : ''));
    expect(suggestionIds.sort()).toEqual(['group-a', 'group-b', 'solo-c']);

    mergedSpy.mockRestore();
    consoleError.mockRestore();
  });
});
