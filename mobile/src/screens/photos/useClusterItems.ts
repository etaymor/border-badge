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
import type { ClusterDisplayItem } from './photoImportHelpers';
import { createMergedSuggestion } from './photoImportHelpers';

interface UseClusterItemsOptions {
  selectedCandidate: TripCandidateDisplay | null;
  clusterDisplays: Map<string, LocationClusterDisplay>;
  suggestPlacesMutation: ReturnType<typeof useSuggestPlacesChunked>;
  cachedSuggestions: ClusterSuggestion[];
  dismissedClusterIdsInternal: Set<string>;
  fetchingSuggestions: boolean;
}

export function useClusterItems({
  selectedCandidate,
  clusterDisplays,
  suggestPlacesMutation,
  cachedSuggestions,
  dismissedClusterIdsInternal,
  fetchingSuggestions,
}: UseClusterItemsOptions): ClusterDisplayItem[] {
  // Extract stable values from mutation to avoid re-renders when mutation object reference changes
  const suggestionsIsPending = suggestPlacesMutation.isPending;
  const suggestionsPartialResults = suggestPlacesMutation.partialResults;
  const suggestionsData = suggestPlacesMutation.data;

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

    // Phase 1: Group clusters by their top place's place_id
    const placeIdToClusterIds = new Map<string, string[]>();
    const clusterSuggestionMap = new Map<
      string,
      { suggestion: ClusterSuggestion; cluster: LocationClusterDisplay }
    >();
    const photosOnlyClusters: LocationClusterDisplay[] = [];

    for (const clusterId of selectedCandidate.locationClusterIds) {
      if (dismissedClusterIdsInternal.has(clusterId)) continue;

      const cluster = clusterDisplays.get(clusterId);
      if (!cluster) continue;

      const suggestion = suggestionsMap.get(clusterId);
      if (suggestion && suggestion.places.length > 0) {
        const topPlaceId = suggestion.places[0].place_id;

        // Track this cluster for the place_id
        if (!placeIdToClusterIds.has(topPlaceId)) {
          placeIdToClusterIds.set(topPlaceId, []);
        }
        placeIdToClusterIds.get(topPlaceId)!.push(clusterId);
        clusterSuggestionMap.set(clusterId, { suggestion, cluster });
      } else {
        photosOnlyClusters.push(cluster);
      }
    }

    // Phase 2: Build display items, merging clusters with same top place
    const items: ClusterDisplayItem[] = [];
    const processedPlaceIds = new Set<string>();

    // Process in order of original cluster sequence for consistent ordering
    for (const clusterId of selectedCandidate.locationClusterIds) {
      if (dismissedClusterIdsInternal.has(clusterId)) continue;

      const entry = clusterSuggestionMap.get(clusterId);
      if (!entry) continue; // Will be handled in photos-only pass

      const topPlaceId = entry.suggestion.places[0].place_id;
      if (processedPlaceIds.has(topPlaceId)) continue;
      processedPlaceIds.add(topPlaceId);

      const clusterIdsForPlace = placeIdToClusterIds.get(topPlaceId)!;

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

    // Add photos-only clusters at the end — but only after loading is complete.
    // While suggestions are being fetched (cache check, vision prep, or API call),
    // clusters without suggestions haven't been resolved yet and showing
    // "No place found nearby" is misleading.
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
  ]);
}
