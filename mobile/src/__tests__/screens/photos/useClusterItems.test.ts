/**
 * Tests for useClusterItems three-state cluster model (U9 / KTD6 / KTD10).
 *
 * The hook turns a candidate's clusters + the chunked mutation's results into a
 * list of display items. U9 introduces a `lookup-failed` terminal state, driven
 * by the mutation's `failedClusterIds`, distinct from `no-place-found`
 * (photos-only). Covers:
 *  - a failed cluster renders as `lookup-failed`, NOT photos-only (B1 repro)
 *  - the two empty-looking states diverge (real empty -> no-place-found;
 *    failed -> lookup-failed)
 *  - dismiss precedence (I6): auto-dismissed-and-failed -> not rendered
 *  - 429/503 carries retryDisabled (KTD10)
 *  - ADV-5 reconciliation: a never-enumerated cluster -> lookup-failed
 *    (retry-enabled), never a confident no-place-found; rendered set ==
 *    (input - dismissed)
 *  - KTD3/R3: an empty response renders no-place-found IMMEDIATELY; the loading
 *    flag never withholds an already-answered cluster
 */

import { renderHook } from '@testing-library/react-native';

import { useClusterItems } from '../../../screens/photos/useClusterItems';
import type { FailedClusterIds, SuggestionDispatchState } from '../../../hooks/usePhotoImport';
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
  previewAssetIds: [`${id}-p1`, `${id}-p2`],
  timeRange: { start: new Date('2026-01-01T10:00:00Z'), end: new Date('2026-01-01T12:00:00Z') },
  countryCode: 'JP',
});

const buildPlace = (overrides: Partial<PlaceSuggestion> = {}): PlaceSuggestion => ({
  place_id: 'ChIJ_default',
  name: 'A Place',
  address: '1 Default St',
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
  previewAssetIds: [],
  locationClusterIds: clusterIds,
});

/**
 * Build a fake `suggestionDispatch` snapshot exposing only the fields
 * useClusterItems reads: isDispatching, partialResults, data, and (U8/U9)
 * failedClusterIds.
 */
const buildMutation = (opts: {
  isPending?: boolean;
  partialResults?: ClusterSuggestion[];
  suggestions?: ClusterSuggestion[];
  failedClusterIds?: FailedClusterIds;
}): SuggestionDispatchState => {
  const { isPending = false, partialResults = [], suggestions, failedClusterIds } = opts;
  return {
    isDispatching: isPending,
    partialResults,
    data: suggestions ? { suggestions } : undefined,
    failedClusterIds: failedClusterIds ?? new Map(),
    // Remaining snapshot fields are not read by the hook; cast through unknown.
  } as unknown as SuggestionDispatchState;
};

const renderItems = (params: {
  clusterIds: string[];
  clusters: LocationClusterDisplay[];
  mutation: SuggestionDispatchState;
  cachedSuggestions?: ClusterSuggestion[];
  dismissed?: Set<string>;
  fetching?: boolean;
  retryingClusterIds?: Set<string>;
}) => {
  const clusterDisplays = new Map<string, LocationClusterDisplay>();
  for (const c of params.clusters) clusterDisplays.set(c.id, c);

  const { result } = renderHook(() =>
    useClusterItems({
      selectedCandidate: buildCandidate(params.clusterIds),
      clusterDisplays,
      suggestionDispatch: params.mutation,
      cachedSuggestions: params.cachedSuggestions ?? [],
      dismissedClusterIdsInternal: params.dismissed ?? new Set(),
      fetchingSuggestions: params.fetching ?? false,
      retryingClusterIds: params.retryingClusterIds,
    })
  );
  return result.current;
};

// ---- Tests -----------------------------------------------------------------

describe('useClusterItems three-state model', () => {
  it('renders a failed cluster as lookup-failed, not photos-only (B1 repro)', () => {
    // Cluster failed in its chunk; it has no matched suggestion. The pre-U9
    // behavior would render it as photos-only "No place found" — a confident
    // empty indistinguishable from a real empty. It must be lookup-failed.
    const cluster = buildCluster('c-failed');
    const failedClusterIds: FailedClusterIds = new Map([['c-failed', { retryDisabled: false }]]);

    const items = renderItems({
      clusterIds: ['c-failed'],
      clusters: [cluster],
      mutation: buildMutation({ failedClusterIds }),
    });

    expect(items).toHaveLength(1);
    expect(items[0].type).toBe('lookup-failed');
    expect(items.some((i) => i.type === 'photos-only')).toBe(false);
  });

  it('diverges the two empty-looking states: real empty -> no-place-found; failed -> lookup-failed', () => {
    const emptyCluster = buildCluster('c-empty');
    const failedCluster = buildCluster('c-failed');
    // c-empty got a real (empty) response; c-failed is in failedClusterIds.
    const suggestions = [buildSuggestion('c-empty', [])];
    const failedClusterIds: FailedClusterIds = new Map([['c-failed', { retryDisabled: false }]]);

    const items = renderItems({
      clusterIds: ['c-empty', 'c-failed'],
      clusters: [emptyCluster, failedCluster],
      mutation: buildMutation({ suggestions, failedClusterIds }),
    });

    const byCluster = (id: string) =>
      items.find((i) =>
        i.type === 'photos-only' || i.type === 'lookup-failed' ? i.cluster.id === id : false
      );

    expect(byCluster('c-empty')?.type).toBe('photos-only');
    expect(byCluster('c-failed')?.type).toBe('lookup-failed');
  });

  it('renders matched clusters as suggestion (failedClusterIds does not override a match)', () => {
    const cluster = buildCluster('c-matched');
    const suggestions = [buildSuggestion('c-matched', [buildPlace({ place_id: 'ChIJ_matched' })])];
    // Even if (defensively) the same id were in failedClusterIds, matched wins.
    const failedClusterIds: FailedClusterIds = new Map([['c-matched', { retryDisabled: false }]]);

    const items = renderItems({
      clusterIds: ['c-matched'],
      clusters: [cluster],
      mutation: buildMutation({ suggestions, failedClusterIds }),
    });

    expect(items).toHaveLength(1);
    expect(items[0].type).toBe('suggestion');
  });

  it('does not render an auto-dismissed cluster even when it failed (precedence I6)', () => {
    const cluster = buildCluster('c-dismissed');
    const failedClusterIds: FailedClusterIds = new Map([['c-dismissed', { retryDisabled: false }]]);

    const items = renderItems({
      clusterIds: ['c-dismissed'],
      clusters: [cluster],
      mutation: buildMutation({ failedClusterIds }),
      dismissed: new Set(['c-dismissed']),
    });

    expect(items).toHaveLength(0);
  });

  it('threads isRetrying onto the lookup-failed item from retryingClusterIds (U10)', () => {
    const cluster = buildCluster('c-retrying');
    const failedClusterIds: FailedClusterIds = new Map([['c-retrying', { retryDisabled: false }]]);

    const items = renderItems({
      clusterIds: ['c-retrying'],
      clusters: [cluster],
      mutation: buildMutation({ failedClusterIds }),
      retryingClusterIds: new Set(['c-retrying']),
    });

    expect(items).toHaveLength(1);
    const item = items[0];
    expect(item.type).toBe('lookup-failed');
    if (item.type === 'lookup-failed') {
      expect(item.isRetrying).toBe(true);
    }
  });

  it('lookup-failed isRetrying is false when the cluster is not in retryingClusterIds', () => {
    const cluster = buildCluster('c-idle');
    const failedClusterIds: FailedClusterIds = new Map([['c-idle', { retryDisabled: false }]]);

    const items = renderItems({
      clusterIds: ['c-idle'],
      clusters: [cluster],
      mutation: buildMutation({ failedClusterIds }),
      retryingClusterIds: new Set(),
    });

    const item = items[0];
    expect(item.type).toBe('lookup-failed');
    if (item.type === 'lookup-failed') {
      expect(item.isRetrying).toBe(false);
    }
  });

  it('carries retryDisabled=true for a 429/503 failure (KTD10)', () => {
    const cluster = buildCluster('c-quota');
    const failedClusterIds: FailedClusterIds = new Map([['c-quota', { retryDisabled: true }]]);

    const items = renderItems({
      clusterIds: ['c-quota'],
      clusters: [cluster],
      mutation: buildMutation({ failedClusterIds }),
    });

    expect(items).toHaveLength(1);
    const item = items[0];
    expect(item.type).toBe('lookup-failed');
    if (item.type === 'lookup-failed') {
      expect(item.retryDisabled).toBe(true);
    }
  });

  it('routes a never-enumerated cluster to lookup-failed (retry-enabled), never no-place-found (ADV-5)', () => {
    // c-ghost is in the candidate's input but absent from BOTH the response and
    // failedClusterIds — the mutation never enumerated it. It must NOT be
    // confidently labeled no-place-found (no empty response ever arrived).
    const matched = buildCluster('c-matched');
    const ghost = buildCluster('c-ghost');
    const suggestions = [buildSuggestion('c-matched', [buildPlace()])];

    const items = renderItems({
      clusterIds: ['c-matched', 'c-ghost'],
      clusters: [matched, ghost],
      // fetch is DONE (not pending), yet c-ghost has no response and no failure
      mutation: buildMutation({ suggestions }),
      fetching: false,
    });

    const ghostItem = items.find((i) =>
      i.type === 'lookup-failed' || i.type === 'photos-only' ? i.cluster.id === 'c-ghost' : false
    );
    expect(ghostItem?.type).toBe('lookup-failed');
    if (ghostItem?.type === 'lookup-failed') {
      // never-enumerated -> retry ENABLED (it was never actually attempted)
      expect(ghostItem.retryDisabled).toBe(false);
    }
    expect(items.some((i) => i.type === 'photos-only')).toBe(false);
  });

  it('rendered cluster set equals (input - dismissed)', () => {
    const matched = buildCluster('c-matched');
    const empty = buildCluster('c-empty');
    const failed = buildCluster('c-failed');
    const ghost = buildCluster('c-ghost');
    const dismissed = buildCluster('c-dismissed');

    const suggestions = [
      buildSuggestion('c-matched', [buildPlace()]),
      buildSuggestion('c-empty', []),
    ];
    const failedClusterIds: FailedClusterIds = new Map([['c-failed', { retryDisabled: false }]]);

    const items = renderItems({
      clusterIds: ['c-matched', 'c-empty', 'c-failed', 'c-ghost', 'c-dismissed'],
      clusters: [matched, empty, failed, ghost, dismissed],
      mutation: buildMutation({ suggestions, failedClusterIds }),
      dismissed: new Set(['c-dismissed']),
    });

    // Collect the cluster id from every rendered item.
    const renderedIds = new Set<string>();
    for (const item of items) {
      if (item.type === 'suggestion') renderedIds.add(item.data.cluster_id);
      else if (item.type === 'merged-suggestion') {
        for (const id of item.data.clusterIds) renderedIds.add(id);
      } else renderedIds.add(item.cluster.id);
    }

    expect(renderedIds).toEqual(new Set(['c-matched', 'c-empty', 'c-failed', 'c-ghost']));
    expect(renderedIds.has('c-dismissed')).toBe(false);
  });

  it('withholds an unresolved (not-yet-failed) cluster during an active fetch (B5)', () => {
    // While fetching, a cluster with no response yet and no failure must NOT
    // flash as no-place-found OR lookup-failed — it stays withheld until the
    // fetch resolves it (empty response) or fails it (failedClusterIds).
    const pending = buildCluster('c-pending');

    const items = renderItems({
      clusterIds: ['c-pending'],
      clusters: [pending],
      mutation: buildMutation({ isPending: true, partialResults: [] }),
      fetching: true,
    });

    expect(items).toHaveLength(0);
  });

  it('exhaustiveness: an unhandled union member fails the never check at compile time (guard)', () => {
    // Compile-time guard mirroring ClusterListItem's `const _exhaustive: never`.
    // If a future ClusterDisplayItem member is added without a branch, the
    // assignment to `never` fails compile — proven here by deliberately leaving
    // a synthetic member unhandled and asserting tsc rejects it (@ts-expect-error).
    type Synthetic =
      | { type: 'lookup-failed' }
      | { type: 'photos-only' }
      | { type: 'a-new-unhandled-member' };

    const classify = (item: Synthetic): string => {
      if (item.type === 'lookup-failed') return 'failed';
      if (item.type === 'photos-only') return 'empty';
      // @ts-expect-error 'a-new-unhandled-member' is not assignable to never —
      // this is the load-bearing guard. If this line ever stops erroring, the
      // exhaustiveness check is no longer real.
      const _exhaustive: never = item;
      return _exhaustive;
    };

    // The branch handling proves the runtime side; the @ts-expect-error above is
    // the actual compile-time assertion enforced by `npx tsc --noEmit`.
    expect(classify({ type: 'lookup-failed' })).toBe('failed');
    expect(classify({ type: 'photos-only' })).toBe('empty');
  });

  it('renders a no-place-found cluster the moment its empty response arrives, mid-fetch (R3/KTD3)', () => {
    // KTD3: an empty response is a TERMINAL, honest result — the server answered
    // this cluster and found nothing. The withholding gate held every photos-only
    // row back until the WHOLE fetch settled, so an already-answered cluster
    // stayed invisible behind slower ones. It must render as soon as its own
    // response lands.
    //
    // The flag's other coupling is unaffected: c-pending has no response yet and
    // stays withheld (that half of the flag's role stays — see the B5 test above).
    const answered = buildCluster('c-empty');
    const pending = buildCluster('c-pending');

    const items = renderItems({
      clusterIds: ['c-empty', 'c-pending'],
      clusters: [answered, pending],
      mutation: buildMutation({
        isPending: true,
        partialResults: [buildSuggestion('c-empty', [])],
      }),
      fetching: true,
    });

    const rendered = items.map((item) =>
      item.type === 'photos-only' || item.type === 'lookup-failed'
        ? { id: item.cluster.id, type: item.type }
        : { id: '(grouped)', type: item.type }
    );
    expect(rendered).toEqual([{ id: 'c-empty', type: 'photos-only' }]);
  });

  it('still surfaces a failed cluster as lookup-failed during an active fetch (terminal)', () => {
    // lookup-failed is terminal for that cluster — its fetch already failed —
    // so it should render even while a subsequent/other fetch is in flight.
    const failed = buildCluster('c-failed');
    const failedClusterIds: FailedClusterIds = new Map([['c-failed', { retryDisabled: false }]]);

    const items = renderItems({
      clusterIds: ['c-failed'],
      clusters: [failed],
      mutation: buildMutation({ isPending: true, partialResults: [], failedClusterIds }),
      fetching: true,
    });

    expect(items).toHaveLength(1);
    expect(items[0].type).toBe('lookup-failed');
  });
  it('emits every state in canonical cluster order, whatever the state mix (KTD5/R11)', () => {
    // Candidate order is deliberately interleaved: failed, empty, matched,
    // empty, matched. Pre-U2 the list came out as matched-first, then all
    // failed, then all photos-only — so a row's position depended on its state.
    const ids = ['c-failed', 'c-empty-1', 'c-matched-1', 'c-empty-2', 'c-matched-2'];
    const clusters = ids.map(buildCluster);

    const suggestions = [
      buildSuggestion('c-empty-1', []),
      buildSuggestion('c-empty-2', []),
      buildSuggestion('c-matched-1', [buildPlace({ place_id: 'ChIJ_m1' })]),
      buildSuggestion('c-matched-2', [buildPlace({ place_id: 'ChIJ_m2' })]),
    ];
    const failedClusterIds: FailedClusterIds = new Map([['c-failed', { retryDisabled: false }]]);

    const items = renderItems({
      clusterIds: ids,
      clusters,
      mutation: buildMutation({ suggestions, failedClusterIds }),
    });

    const rendered = items.map((item) =>
      item.type === 'suggestion'
        ? item.data.cluster_id
        : item.type === 'merged-suggestion'
          ? item.data.primaryClusterId
          : item.cluster.id
    );
    expect(rendered).toEqual(ids);
  });

  it('does not move a row when it resolves to no-place-found (R11)', () => {
    // c-slow is unresolved on the first pass (withheld) and answers empty on the
    // second. Its neighbours must not shift, and it must land in its own slot
    // rather than being appended after the matched rows.
    const ids = ['c-matched', 'c-slow', 'c-tail'];
    const clusters = ids.map(buildCluster);

    const before = renderItems({
      clusterIds: ids,
      clusters,
      mutation: buildMutation({
        isPending: true,
        partialResults: [
          buildSuggestion('c-matched', [buildPlace({ place_id: 'ChIJ_a' })]),
          buildSuggestion('c-tail', [buildPlace({ place_id: 'ChIJ_b' })]),
        ],
      }),
      fetching: true,
    });
    expect(before.map((i) => (i.type === 'suggestion' ? i.data.cluster_id : 'other'))).toEqual([
      'c-matched',
      'c-tail',
    ]);

    const after = renderItems({
      clusterIds: ids,
      clusters,
      mutation: buildMutation({
        isPending: true,
        partialResults: [
          buildSuggestion('c-matched', [buildPlace({ place_id: 'ChIJ_a' })]),
          buildSuggestion('c-slow', []),
          buildSuggestion('c-tail', [buildPlace({ place_id: 'ChIJ_b' })]),
        ],
      }),
      fetching: true,
    });

    const rendered = after.map((item) =>
      item.type === 'suggestion'
        ? item.data.cluster_id
        : item.type === 'merged-suggestion'
          ? item.data.primaryClusterId
          : item.cluster.id
    );
    // c-slow lands BETWEEN its neighbours, not appended at the end.
    expect(rendered).toEqual(['c-matched', 'c-slow', 'c-tail']);
    expect(after[1].type).toBe('photos-only');
  });

  it('keeps a lookup-failed row in place instead of appending it after matched rows (R11)', () => {
    const ids = ['c-head', 'c-broken', 'c-tail'];
    const clusters = ids.map(buildCluster);
    const suggestions = [
      buildSuggestion('c-head', [buildPlace({ place_id: 'ChIJ_head' })]),
      buildSuggestion('c-tail', [buildPlace({ place_id: 'ChIJ_tail' })]),
    ];
    const failedClusterIds: FailedClusterIds = new Map([['c-broken', { retryDisabled: false }]]);

    const items = renderItems({
      clusterIds: ids,
      clusters,
      mutation: buildMutation({ suggestions, failedClusterIds }),
    });

    const rendered = items.map((item) =>
      item.type === 'suggestion'
        ? item.data.cluster_id
        : item.type === 'merged-suggestion'
          ? item.data.primaryClusterId
          : item.cluster.id
    );
    expect(rendered).toEqual(ids);
    expect(items[1].type).toBe('lookup-failed');
  });
});
