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
 *
 * U8 adds the fourth, NON-terminal state on top of those three:
 *  - R10: every ENQUEUED, unresolved cluster is a `pending` row — including the
 *    clusters queued behind the live batches, which is what the withhold used to
 *    hide; a cluster the controller has not accepted yet is still withheld
 *  - R11: a pending row resolves to matched / no-place-found / lookup-failed in
 *    its own slot, without moving its neighbours
 *  - R2: once every owner has settled, an enqueued cluster that never answered
 *    becomes lookup-failed (retry enabled) rather than staying pending forever
 *  - same-place merging is PROGRESSIVE (KTD22/R23 reversed 2026-08-20): two
 *    clusters collapse into one merged card the moment both have matched,
 *    anchored at the earlier canonical slot; settle collapses nothing further
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
 * useClusterItems reads: isDispatching, partialResults, data, failedClusterIds
 * (U9) and — for U8 — `enqueuedClusterIds` (the source of pending rows, R10)
 * plus `ownerCount` (the all-owners-settled gate for the reconciliation sweep).
 */
const buildMutation = (opts: {
  isPending?: boolean;
  partialResults?: ClusterSuggestion[];
  suggestions?: ClusterSuggestion[];
  failedClusterIds?: FailedClusterIds;
  /** Clusters the controller has ACCEPTED (not merely put on the wire). */
  enqueued?: string[];
  /** Unsettled dispatch owners; 0 means every owner has settled. */
  ownerCount?: number;
}): SuggestionDispatchState => {
  const {
    isPending = false,
    partialResults = [],
    suggestions,
    failedClusterIds,
    enqueued,
    ownerCount = 0,
  } = opts;
  return {
    isDispatching: isPending,
    partialResults,
    data: suggestions ? { suggestions } : undefined,
    failedClusterIds: failedClusterIds ?? new Map(),
    enqueuedClusterIds: new Set(enqueued ?? []),
    ownerCount,
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

  it('renders an enqueued, unresolved cluster as pending — never no-place-found or lookup-failed (B5/R10)', () => {
    // B5 still holds in its real content: a cluster with no response and no
    // failure must NOT flash as no-place-found OR lookup-failed. U8 changes only
    // how the truth is shown — withholding the row is replaced by a pending row,
    // because withholding left most of a large import invisible.
    const pending = buildCluster('c-pending');

    const items = renderItems({
      clusterIds: ['c-pending'],
      clusters: [pending],
      mutation: buildMutation({
        isPending: true,
        partialResults: [],
        enqueued: ['c-pending'],
        ownerCount: 1,
      }),
      fetching: true,
    });

    expect(items).toHaveLength(1);
    expect(items[0].type).toBe('pending');
    expect(items.some((i) => i.type === 'lookup-failed' || i.type === 'photos-only')).toBe(false);
  });

  it('withholds a cluster the controller has not accepted yet (pre-dispatch window)', () => {
    // Before the controller enqueues anything — the SQLite cache read / vision
    // prep window — a cluster has no state at all. Pending means ENQUEUED and
    // unresolved, not "some fetch is happening somewhere", so this stays out of
    // the list rather than claiming a status it does not have.
    const notYet = buildCluster('c-not-yet');

    const items = renderItems({
      clusterIds: ['c-not-yet'],
      clusters: [notYet],
      mutation: buildMutation({ isPending: false, enqueued: [], ownerCount: 1 }),
      fetching: true,
    });

    expect(items).toHaveLength(0);
  });

  it('renders pending for clusters queued behind the live batch, not just the in-flight ones (R10)', () => {
    // The controller accepts every cluster up front but dispatches a couple at a
    // time. Sourcing pending from the in-flight set would render 2 rows here
    // (and ~15 of 100 on a real import) and leave the rest blank.
    const ids = ['c-1', 'c-2', 'c-3', 'c-4', 'c-5'];
    const clusters = ids.map(buildCluster);

    const items = renderItems({
      clusterIds: ids,
      clusters,
      mutation: buildMutation({
        isPending: true,
        enqueued: ids, // every accepted cluster, in flight or not
        ownerCount: 1,
      }),
      fetching: true,
    });

    expect(items.map((i) => i.type)).toEqual(ids.map(() => 'pending'));
    expect(items.map((i) => (i.type === 'pending' ? i.cluster.id : 'other'))).toEqual(ids);
  });

  it('resolves a pending row into each terminal state without changing its position (R11)', () => {
    // One pass per outcome, same candidate order each time. The middle row must
    // stay the middle row whether it matches, answers empty, or fails.
    const ids = ['c-head', 'c-mid', 'c-tail'];
    const clusters = ids.map(buildCluster);
    const headTail = [
      buildSuggestion('c-head', [buildPlace({ place_id: 'ChIJ_head' })]),
      buildSuggestion('c-tail', [buildPlace({ place_id: 'ChIJ_tail' })]),
    ];

    const positions = (items: ReturnType<typeof renderItems>) =>
      items.map((item) =>
        item.type === 'suggestion'
          ? item.data.cluster_id
          : item.type === 'merged-suggestion'
            ? item.data.primaryClusterId
            : item.cluster.id
      );

    const pendingPass = renderItems({
      clusterIds: ids,
      clusters,
      mutation: buildMutation({
        isPending: true,
        partialResults: headTail,
        enqueued: ids,
        ownerCount: 1,
      }),
      fetching: true,
    });
    expect(positions(pendingPass)).toEqual(ids);
    expect(pendingPass[1].type).toBe('pending');

    const matchedPass = renderItems({
      clusterIds: ids,
      clusters,
      mutation: buildMutation({
        isPending: true,
        partialResults: [
          ...headTail,
          buildSuggestion('c-mid', [buildPlace({ place_id: 'ChIJ_m' })]),
        ],
        enqueued: ids,
        ownerCount: 1,
      }),
      fetching: true,
    });
    expect(positions(matchedPass)).toEqual(ids);
    expect(matchedPass[1].type).toBe('suggestion');

    const emptyPass = renderItems({
      clusterIds: ids,
      clusters,
      mutation: buildMutation({
        isPending: true,
        partialResults: [...headTail, buildSuggestion('c-mid', [])],
        enqueued: ids,
        ownerCount: 1,
      }),
      fetching: true,
    });
    expect(positions(emptyPass)).toEqual(ids);
    expect(emptyPass[1].type).toBe('photos-only');

    const failedPass = renderItems({
      clusterIds: ids,
      clusters,
      mutation: buildMutation({
        isPending: true,
        partialResults: headTail,
        failedClusterIds: new Map([['c-mid', { retryDisabled: false }]]),
        enqueued: ids,
        ownerCount: 1,
      }),
      fetching: true,
    });
    expect(positions(failedPass)).toEqual(ids);
    expect(failedPass[1].type).toBe('lookup-failed');
  });

  it('turns an enqueued cluster that never resolved into lookup-failed once every owner settles (R2)', () => {
    // The reconciliation sweep is keyed on ALL owners settled, so it outranks
    // the pending arm: with nothing left to wait for, a silent cluster IS a
    // failure — retry ENABLED, because it was never actually answered.
    const ids = ['c-answered', 'c-silent'];
    const clusters = ids.map(buildCluster);

    const settled = buildMutation({
      suggestions: [buildSuggestion('c-answered', [buildPlace()])],
      enqueued: ids,
      ownerCount: 0,
    });

    const items = renderItems({ clusterIds: ids, clusters, mutation: settled, fetching: false });

    expect(items.some((i) => i.type === 'pending')).toBe(false);
    const silent = items[1];
    expect(silent.type).toBe('lookup-failed');
    if (silent.type === 'lookup-failed') {
      expect(silent.retryDisabled).toBe(false);
    }
  });

  it('keeps the sweep from firing while an owner is still unsettled, even if the caller flag is false', () => {
    // Defense in depth for KTD13: `ownerCount` is the controller's own truth. A
    // caller that forgets to OR in the hook's report must not cause a wall of
    // "Couldn't check this location" — the unresolved rows stay pending.
    const ids = ['c-pending'];
    const clusters = ids.map(buildCluster);

    const items = renderItems({
      clusterIds: ids,
      clusters,
      mutation: buildMutation({ enqueued: ids, ownerCount: 1 }),
      fetching: false,
    });

    expect(items).toHaveLength(1);
    expect(items[0].type).toBe('pending');
  });

  it('a pending cluster dismissed mid-flight leaves the list and does not return when its batch answers', () => {
    const ids = ['c-keep', 'c-skipped'];
    const clusters = ids.map(buildCluster);

    const duringFetch = renderItems({
      clusterIds: ids,
      clusters,
      mutation: buildMutation({ isPending: true, enqueued: ids, ownerCount: 1 }),
      dismissed: new Set(['c-skipped']),
      fetching: true,
    });
    expect(duringFetch.map((i) => (i.type === 'pending' ? i.cluster.id : 'other'))).toEqual([
      'c-keep',
    ]);

    // Its batch comes back WITH a place for the skipped cluster — dismissal still
    // wins (precedence I6), so the row does not reappear.
    const afterResponse = renderItems({
      clusterIds: ids,
      clusters,
      mutation: buildMutation({
        suggestions: [
          buildSuggestion('c-keep', [buildPlace({ place_id: 'ChIJ_keep' })]),
          buildSuggestion('c-skipped', [buildPlace({ place_id: 'ChIJ_skipped' })]),
        ],
        enqueued: ids,
        ownerCount: 0,
      }),
      dismissed: new Set(['c-skipped']),
      fetching: false,
    });
    expect(afterResponse).toHaveLength(1);
    expect(afterResponse[0].type).toBe('suggestion');
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

  it('merges two clusters that resolved to the same place as soon as both are matched, mid-flight (KTD22 reversed)', () => {
    // The original KTD22 deferred this merge until every owner had settled so
    // no row would ever be removed mid-scroll. In practice that showed two
    // near-identical cards for one venue ("same photo and location") for the
    // whole loading phase, which read as a duplicate bug. Merge the moment the
    // second cluster lands; settle must not collapse anything further.
    const ids = ['c-a', 'c-b'];
    const clusters = ids.map(buildCluster);
    const sharedPlace = buildPlace({ place_id: 'ChIJ_shared', name: 'Shared Venue' });
    const suggestions = [
      buildSuggestion('c-a', [sharedPlace]),
      buildSuggestion('c-b', [sharedPlace]),
    ];

    const midFlight = renderItems({
      clusterIds: ids,
      clusters,
      mutation: buildMutation({
        isPending: true,
        partialResults: suggestions,
        enqueued: ids,
        ownerCount: 1,
      }),
      fetching: true,
    });
    // One merged card, anchored at the earlier cluster's slot, while the fetch
    // is still running.
    expect(midFlight).toHaveLength(1);
    expect(midFlight[0].type).toBe('merged-suggestion');
    if (midFlight[0].type === 'merged-suggestion') {
      expect(midFlight[0].data.clusterIds).toEqual(ids);
      expect(midFlight[0].data.primaryClusterId).toBe('c-a');
    }

    const settled = renderItems({
      clusterIds: ids,
      clusters,
      mutation: buildMutation({ suggestions, enqueued: ids, ownerCount: 0 }),
      fetching: false,
    });
    // Settle changes nothing: same single card, same members.
    expect(settled).toHaveLength(1);
    expect(settled[0].type).toBe('merged-suggestion');
    if (settled[0].type === 'merged-suggestion') {
      expect(settled[0].data.clusterIds).toEqual(ids);
    }
  });

  it('never swallows a pending row into a merge — merging waits for a real match', () => {
    // Only c-a has answered; c-b is still enqueued. c-b keeps its own pending
    // slot (R10/R11) and c-a renders as a plain single card.
    const ids = ['c-a', 'c-b'];
    const clusters = ids.map(buildCluster);
    const sharedPlace = buildPlace({ place_id: 'ChIJ_shared' });

    const items = renderItems({
      clusterIds: ids,
      clusters,
      mutation: buildMutation({
        isPending: true,
        partialResults: [buildSuggestion('c-a', [sharedPlace])],
        enqueued: ids,
        ownerCount: 1,
      }),
      fetching: true,
    });

    expect(items.map((i) => i.type)).toEqual(['suggestion', 'pending']);
  });

  it('anchors the merged card at the earliest canonical slot even when the later cluster resolves first', () => {
    // c-b answers before c-a. c-b shows as its own card in its own slot while
    // c-a is pending; once c-a lands the pair collapses into ONE card whose
    // primary is c-a (canonical order), and c-b's row disappears.
    const ids = ['c-a', 'c-b'];
    const clusters = ids.map(buildCluster);
    const sharedPlace = buildPlace({ place_id: 'ChIJ_shared' });

    const before = renderItems({
      clusterIds: ids,
      clusters,
      mutation: buildMutation({
        isPending: true,
        partialResults: [buildSuggestion('c-b', [sharedPlace])],
        enqueued: ids,
        ownerCount: 1,
      }),
      fetching: true,
    });
    expect(before.map((i) => i.type)).toEqual(['pending', 'suggestion']);

    const after = renderItems({
      clusterIds: ids,
      clusters,
      mutation: buildMutation({
        isPending: true,
        // Arrival order: c-b first, then c-a. Anchor must follow canonical
        // order, not arrival order.
        partialResults: [
          buildSuggestion('c-b', [sharedPlace]),
          buildSuggestion('c-a', [sharedPlace]),
        ],
        enqueued: ids,
        ownerCount: 1,
      }),
      fetching: true,
    });
    expect(after).toHaveLength(1);
    expect(after[0].type).toBe('merged-suggestion');
    if (after[0].type === 'merged-suggestion') {
      expect(after[0].data.primaryClusterId).toBe('c-a');
      expect(after[0].data.clusterIds).toEqual(ids);
    }
  });

  it('does not merge a cluster the user already confirmed into another card mid-flight', () => {
    // Confirming c-saved auto-dismissed it. When c-other later resolves to the
    // same place while the fetch is still running, it renders as its OWN card
    // (dismissal is evaluated first) — never a merged card that re-surfaces the
    // photos the user already saved.
    const ids = ['c-saved', 'c-other'];
    const clusters = ids.map(buildCluster);
    const sharedPlace = buildPlace({ place_id: 'ChIJ_shared' });

    const items = renderItems({
      clusterIds: ids,
      clusters,
      mutation: buildMutation({
        isPending: true,
        partialResults: [
          buildSuggestion('c-saved', [sharedPlace]),
          buildSuggestion('c-other', [sharedPlace]),
        ],
        enqueued: ids,
        ownerCount: 1,
      }),
      dismissed: new Set(['c-saved']),
      fetching: true,
    });

    expect(items).toHaveLength(1);
    expect(items[0].type).toBe('suggestion');
    if (items[0].type === 'suggestion') {
      expect(items[0].data.cluster_id).toBe('c-other');
    }
  });

  it('does not merge a cluster the user already confirmed into another card at settle (KTD22)', () => {
    // Confirming a card auto-dismisses its cluster. Because dismissal is
    // evaluated first, the surviving cluster settles as its OWN card rather than
    // producing a merged card for a place the user has already saved.
    const ids = ['c-saved', 'c-other'];
    const clusters = ids.map(buildCluster);
    const sharedPlace = buildPlace({ place_id: 'ChIJ_shared' });

    const items = renderItems({
      clusterIds: ids,
      clusters,
      mutation: buildMutation({
        suggestions: [
          buildSuggestion('c-saved', [sharedPlace]),
          buildSuggestion('c-other', [sharedPlace]),
        ],
        enqueued: ids,
        ownerCount: 0,
      }),
      dismissed: new Set(['c-saved']),
      fetching: false,
    });

    expect(items).toHaveLength(1);
    expect(items[0].type).toBe('suggestion');
    if (items[0].type === 'suggestion') {
      expect(items[0].data.cluster_id).toBe('c-other');
    }
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
