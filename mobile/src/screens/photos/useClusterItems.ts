/**
 * Hook to build the merged list of cluster display items for the suggestions phase.
 *
 * Combines cached suggestions with API results and groups clusters that resolved
 * to the same place.
 *
 * KTD5 / R11 — CANONICAL ORDER: every item is emitted in the candidate's own
 * `locationClusterIds` order, whatever state the cluster is in. Rows therefore
 * keep their position for the whole session: a row that resolves from withheld
 * to matched / no-place-found / lookup-failed changes appearance IN PLACE
 * instead of teleporting to the end of the list as results stream in.
 */

import { useMemo } from 'react';

import type {
  ClusterSuggestion,
  LocationClusterDisplay,
  TripCandidateDisplay,
} from '@services/photoImport';
import type { FailedClusterIds, SuggestionDispatchState } from '@hooks/usePhotoImport';
import type { ClusterDisplayItem } from './photoImportHelpers';
import { createMergedSuggestion } from './photoImportHelpers';

/** Stable empty Map so an undefined `failedClusterIds` doesn't churn the memo. */
const EMPTY_FAILED_CLUSTER_IDS: FailedClusterIds = new Map();

/** Stable empty Set so an undefined `retryingClusterIds` doesn't churn the memo. */
const EMPTY_RETRYING_CLUSTER_IDS: Set<string> = new Set();

interface UseClusterItemsOptions {
  selectedCandidate: TripCandidateDisplay | null;
  clusterDisplays: Map<string, LocationClusterDisplay>;
  /** Live snapshot of the `suggestionDispatch` controller (U14). */
  suggestionDispatch: SuggestionDispatchState;
  cachedSuggestions: ClusterSuggestion[];
  dismissedClusterIdsInternal: Set<string>;
  /**
   * True while ANY dispatch owner is unsettled (R1/KTD13) — the consumer ORs
   * every owner's signal together, because the screen only knows about the
   * fetches it started itself.
   *
   * It has exactly ONE role left (KTD3): the Phase-1 reconciliation sweep. Once
   * dispatch has settled, a cluster with neither a response nor a failure entry
   * becomes `lookup-failed`. It no longer withholds already-answered
   * no-place-found rows — an empty response is terminal and renders at once.
   */
  fetchingSuggestions: boolean;
  /**
   * Cluster ids whose U10 scoped retry is currently in flight (per-cluster
   * spinner). NOT the global `fetchingSuggestions` flag — retry must not re-hide
   * healthy photos-only / no-place-found cards (KTD7 / C4).
   */
  retryingClusterIds?: Set<string>;
}

export function useClusterItems({
  selectedCandidate,
  clusterDisplays,
  suggestionDispatch,
  cachedSuggestions,
  dismissedClusterIdsInternal,
  fetchingSuggestions,
  retryingClusterIds = EMPTY_RETRYING_CLUSTER_IDS,
}: UseClusterItemsOptions): ClusterDisplayItem[] {
  // Extract the individual fields the memos depend on, so a snapshot change
  // that touches an unrelated field does not rebuild the item list.
  const suggestionsIsPending = suggestionDispatch.isDispatching;
  const suggestionsPartialResults = suggestionDispatch.partialResults;
  const suggestionsData = suggestionDispatch.data;
  // Clusters whose place lookup failed (KTD6) — drives the `lookup-failed`
  // terminal state. Undefined-safe: an empty Map means "nothing failed".
  const failedClusterIds = suggestionDispatch.failedClusterIds ?? EMPTY_FAILED_CLUSTER_IDS;

  // Memoize the merged suggestions Map separately to avoid rebuilding on every clusterItems recomputation
  // This Map only needs to rebuild when the suggestion sources change, not when dismissedClusterIds changes
  const suggestionsMap = useMemo(() => {
    const map = new Map<string, ClusterSuggestion>();

    // Get API results (partial during loading, full when done)
    const apiSuggestions = suggestionsIsPending
      ? (suggestionsPartialResults ?? [])
      : (suggestionsData?.suggestions ?? []);

    // Add cached suggestions first (takes precedence for deduplication)
    for (const suggestion of cachedSuggestions) {
      map.set(suggestion.cluster_id, suggestion);
    }

    // Add API suggestions (won't overwrite cached ones)
    for (const suggestion of apiSuggestions) {
      if (!map.has(suggestion.cluster_id)) {
        map.set(suggestion.cluster_id, suggestion);
      }
    }

    return map;
  }, [suggestionsIsPending, suggestionsPartialResults, suggestionsData, cachedSuggestions]);

  // Build combined list of all clusters for the selected candidate
  // Clusters with the same top place are merged into a single card
  return useMemo(() => {
    if (!selectedCandidate) return [];

    // Phase 1: Classify each non-dismissed cluster into exactly one state, with
    // precedence (highest wins): dismissed/auto-dismissed > matched >
    // lookup-failed > no-place-found. The `dismissedClusterIdsInternal` filter
    // runs FIRST (continue) so auto-dismiss always wins (I6).
    const placeIdToClusterIds = new Map<string, string[]>();
    const clusterSuggestionMap = new Map<
      string,
      { suggestion: ClusterSuggestion; cluster: LocationClusterDisplay }
    >();
    // Clusters that resolved to a real empty response (place lookup succeeded,
    // found nothing) — the genuine no-place-found state. Keyed by cluster id so
    // Phase 2 can emit them in canonical order (KTD5).
    const photosOnlyClusters = new Map<string, LocationClusterDisplay>();
    // Clusters whose place lookup FAILED (in failedClusterIds) OR were never
    // enumerated by the mutation at all (ADV-5) — the terminal lookup-failed
    // state. retryDisabled comes from the failure metadata; a never-enumerated
    // cluster gets retry ENABLED (it was never actually attempted).
    const lookupFailedClusters = new Map<
      string,
      { cluster: LocationClusterDisplay; retryDisabled: boolean }
    >();

    // Sub-clusters from a manual split always render as their own card, even if
    // they share a top place_id with another cluster. Grouping them would undo
    // the user's split. Use a per-cluster group key for split sub-clusters.
    const groupKeyFor = (clusterId: string, placeId: string) =>
      clusterId.includes('__split_') ? `split:${clusterId}` : placeId;

    for (const clusterId of selectedCandidate.locationClusterIds) {
      if (dismissedClusterIdsInternal.has(clusterId)) continue;

      const cluster = clusterDisplays.get(clusterId);
      if (!cluster) continue;

      const suggestion = suggestionsMap.get(clusterId);
      if (suggestion && suggestion.places.length > 0) {
        // matched (highest non-dismiss precedence): a suggestion with places.
        const groupKey = groupKeyFor(clusterId, suggestion.places[0].place_id);

        if (!placeIdToClusterIds.has(groupKey)) {
          placeIdToClusterIds.set(groupKey, []);
        }
        placeIdToClusterIds.get(groupKey)!.push(clusterId);
        clusterSuggestionMap.set(clusterId, { suggestion, cluster });
      } else if (failedClusterIds.has(clusterId)) {
        // lookup-failed: the cluster's chunk threw. Do NOT fall through to
        // photos-only — that would re-introduce B1 (a transient failure shown
        // as a confident "No place found"). Terminal: render even mid-fetch.
        lookupFailedClusters.set(clusterId, {
          cluster,
          retryDisabled: failedClusterIds.get(clusterId)?.retryDisabled ?? false,
        });
      } else if (suggestion) {
        // no-place-found: a real (empty) response actually arrived for this
        // cluster — the only honest source of a confident "No place found".
        // TERMINAL (R3/KTD3): emitted the moment its own response lands, even
        // while other clusters are still on the wire. It is never withheld
        // behind the global fetch flag — that gate made an already-answered
        // cluster stay invisible behind slower ones.
        photosOnlyClusters.set(clusterId, cluster);
      } else if (!fetchingSuggestions) {
        // ADV-5 reconciliation invariant: the fetch is DONE, yet this cluster
        // has NEITHER a response (not in suggestionsMap / cache) NOR a failure
        // entry — the mutation never enumerated it (dropped during chunk
        // assembly, omitted from uncachedClusters, partial-batch edge). It must
        // NOT be confidently labeled no-place-found (no empty response ever
        // arrived). Route it to lookup-failed with retry ENABLED so the user can
        // recover it, never to photos-only.
        lookupFailedClusters.set(clusterId, { cluster, retryDisabled: false });
      }
      // else: fetch is still in flight and this cluster is unresolved (no
      // response, no failure). Withhold it — don't flash no-place-found OR
      // lookup-failed mid-fetch (B5). It will be classified once the fetch
      // resolves it (empty response) or fails it (failedClusterIds).
    }

    // Phase 2: Build display items in CANONICAL cluster order (KTD5/R11),
    // merging clusters with the same top place. Every state — matched,
    // lookup-failed, no-place-found — is emitted from this single ordered pass,
    // so a row resolving mid-session changes appearance in place rather than
    // being appended after the matched rows and teleporting.
    const items: ClusterDisplayItem[] = [];
    const processedGroupKeys = new Set<string>();

    for (const clusterId of selectedCandidate.locationClusterIds) {
      if (dismissedClusterIdsInternal.has(clusterId)) continue;

      const entry = clusterSuggestionMap.get(clusterId);
      if (!entry) {
        // Not matched. Emit the cluster's terminal state at ITS position, or
        // withhold it (no entry in either map) while it is still unresolved.
        const failedEntry = lookupFailedClusters.get(clusterId);
        if (failedEntry) {
          // Lookup-failed is TERMINAL — its fetch already finished (chunk threw)
          // or it was never enumerated. It is NOT withheld during a *subsequent*
          // fetch: unlike a still-unresolved cluster it has no pending
          // resolution to wait for, and hiding it would make it silently vanish
          // again (B1).
          items.push({
            type: 'lookup-failed',
            cluster: failedEntry.cluster,
            retryDisabled: failedEntry.retryDisabled,
            isRetrying: retryingClusterIds.has(failedEntry.cluster.id),
          });
          continue;
        }
        const photosOnlyCluster = photosOnlyClusters.get(clusterId);
        if (photosOnlyCluster) {
          items.push({ type: 'photos-only', cluster: photosOnlyCluster });
        }
        continue;
      }

      const groupKey = groupKeyFor(clusterId, entry.suggestion.places[0].place_id);
      if (processedGroupKeys.has(groupKey)) continue;
      processedGroupKeys.add(groupKey);

      const clusterIdsForPlace = placeIdToClusterIds.get(groupKey)!;

      if (clusterIdsForPlace.length === 1) {
        // Single cluster - use original format
        items.push({ type: 'suggestion', data: entry.suggestion, cluster: entry.cluster });
      } else {
        // Multiple clusters - create merged suggestion
        const mergedSuggestion = createMergedSuggestion(
          clusterIdsForPlace,
          clusterSuggestionMap,
          clusterDisplays
        );
        if (mergedSuggestion) {
          items.push({ type: 'merged-suggestion', data: mergedSuggestion });
        } else {
          // B4: the merged build failed (the primary cluster vanished from the
          // suggestion map mid-merge — a dismiss race). DEGRADE to individual
          // `suggestion` cards for every group member that still has its own
          // entry, instead of pushing NOTHING (which silently dropped the WHOLE
          // merged card and every cluster in it). The dev console.error inside
          // createMergedSuggestion is preserved for diagnosis. A group member
          // that lost its suggestion entirely is skipped here and is already
          // routed through Phase 1's normal state logic (photos-only /
          // lookup-failed), so it is never double-emitted.
          for (const memberId of clusterIdsForPlace) {
            const memberEntry = clusterSuggestionMap.get(memberId);
            if (memberEntry) {
              items.push({
                type: 'suggestion',
                data: memberEntry.suggestion,
                cluster: memberEntry.cluster,
              });
            }
          }
        }
      }
    }

    return items;
  }, [
    selectedCandidate,
    suggestionsMap,
    clusterDisplays,
    dismissedClusterIdsInternal,
    fetchingSuggestions,
    failedClusterIds,
    retryingClusterIds,
  ]);
}
