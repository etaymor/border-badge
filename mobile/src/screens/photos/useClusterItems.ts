/**
 * Hook to build the merged list of cluster display items for the suggestions phase.
 *
 * Combines cached suggestions with API results, groups clusters that resolved
 * to the same place, and appends photos-only clusters after loading completes.
 */

import { useMemo } from 'react';

import type {
  ClusterSuggestion,
  LocationClusterDisplay,
  TripCandidateDisplay,
} from '@services/photoImport';
import type { useSuggestPlacesChunked } from '@hooks/usePhotoImport';
import type { FailedClusterIds } from '@hooks/usePhotoImport';
import type { ClusterDisplayItem } from './photoImportHelpers';
import { createMergedSuggestion } from './photoImportHelpers';

/** Stable empty Map so an undefined `failedClusterIds` doesn't churn the memo. */
const EMPTY_FAILED_CLUSTER_IDS: FailedClusterIds = new Map();

/** Stable empty Set so an undefined `retryingClusterIds` doesn't churn the memo. */
const EMPTY_RETRYING_CLUSTER_IDS: Set<string> = new Set();

interface UseClusterItemsOptions {
  selectedCandidate: TripCandidateDisplay | null;
  clusterDisplays: Map<string, LocationClusterDisplay>;
  suggestPlacesMutation: ReturnType<typeof useSuggestPlacesChunked>;
  cachedSuggestions: ClusterSuggestion[];
  dismissedClusterIdsInternal: Set<string>;
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
  suggestPlacesMutation,
  cachedSuggestions,
  dismissedClusterIdsInternal,
  fetchingSuggestions,
  retryingClusterIds = EMPTY_RETRYING_CLUSTER_IDS,
}: UseClusterItemsOptions): ClusterDisplayItem[] {
  // Extract stable values from mutation to avoid re-renders when mutation object reference changes
  const suggestionsIsPending = suggestPlacesMutation.isPending;
  const suggestionsPartialResults = suggestPlacesMutation.partialResults;
  const suggestionsData = suggestPlacesMutation.data;
  // Clusters whose place lookup failed (KTD6) — drives the `lookup-failed`
  // terminal state. Undefined-safe: an empty Map means "nothing failed".
  const failedClusterIds = suggestPlacesMutation.failedClusterIds ?? EMPTY_FAILED_CLUSTER_IDS;

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
    // found nothing) — the genuine no-place-found state.
    const photosOnlyClusters: LocationClusterDisplay[] = [];
    // Clusters whose place lookup FAILED (in failedClusterIds) OR were never
    // enumerated by the mutation at all (ADV-5) — the terminal lookup-failed
    // state. retryDisabled comes from the failure metadata; a never-enumerated
    // cluster gets retry ENABLED (it was never actually attempted).
    const lookupFailedClusters: { cluster: LocationClusterDisplay; retryDisabled: boolean }[] = [];

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
        lookupFailedClusters.push({
          cluster,
          retryDisabled: failedClusterIds.get(clusterId)?.retryDisabled ?? false,
        });
      } else if (suggestion) {
        // no-place-found: a real (empty) response actually arrived for this
        // cluster — the only honest source of a confident "No place found".
        photosOnlyClusters.push(cluster);
      } else if (!fetchingSuggestions) {
        // ADV-5 reconciliation invariant: the fetch is DONE, yet this cluster
        // has NEITHER a response (not in suggestionsMap / cache) NOR a failure
        // entry — the mutation never enumerated it (dropped during chunk
        // assembly, omitted from uncachedClusters, partial-batch edge). It must
        // NOT be confidently labeled no-place-found (no empty response ever
        // arrived). Route it to lookup-failed with retry ENABLED so the user can
        // recover it, never to photos-only.
        lookupFailedClusters.push({ cluster, retryDisabled: false });
      }
      // else: fetch is still in flight and this cluster is unresolved (no
      // response, no failure). Withhold it — don't flash no-place-found OR
      // lookup-failed mid-fetch (B5). It will be classified once the fetch
      // resolves it (empty response) or fails it (failedClusterIds).
    }

    // Phase 2: Build display items, merging clusters with same top place
    const items: ClusterDisplayItem[] = [];
    const processedGroupKeys = new Set<string>();

    // Process in order of original cluster sequence for consistent ordering
    for (const clusterId of selectedCandidate.locationClusterIds) {
      if (dismissedClusterIdsInternal.has(clusterId)) continue;

      const entry = clusterSuggestionMap.get(clusterId);
      if (!entry) continue; // Will be handled in photos-only pass

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
        }
      }
    }

    // Lookup-failed clusters are TERMINAL — their fetch already finished (chunk
    // threw) or they were never enumerated (classified only when the fetch is
    // done, see Phase 1). They are NOT withheld during a *subsequent* fetch:
    // unlike a genuine no-place-found (which could still flip to matched while a
    // fetch is in flight), a failed cluster has no pending resolution to wait
    // for, and hiding it would make it silently vanish again (B1). Emit them.
    for (const { cluster, retryDisabled } of lookupFailedClusters) {
      items.push({
        type: 'lookup-failed',
        cluster,
        retryDisabled,
        isRetrying: retryingClusterIds.has(cluster.id),
      });
    }

    // Add photos-only (genuine no-place-found) clusters at the end — but only
    // after loading is complete. While suggestions are being fetched (cache
    // check, vision prep, or API call), a cluster without a suggestion hasn't
    // been resolved yet and showing "No place found nearby" is misleading (B5).
    // Note: Phase 1 only enters a cluster here when a real empty response
    // arrived, so this withhold is a belt-and-suspenders guard for that path.
    if (!fetchingSuggestions) {
      for (const cluster of photosOnlyClusters) {
        items.push({ type: 'photos-only', cluster });
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
