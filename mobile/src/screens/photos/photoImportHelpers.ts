/**
 * Pure helper functions for the photo import workflow.
 *
 * No React dependencies - these are stateless utilities
 * used by PhotoImportScreen and its sub-components.
 */

import type { ClusterSuggestion, LocationClusterDisplay } from '@services/photoImport';
import type { MergedSuggestion } from './photoImportTypes';

/**
 * Display item that can be a merged suggestion, single suggestion, a terminal
 * lookup-failed cluster (place lookup errored — distinct from a real empty), a
 * photo-only cluster (place lookup succeeded but found nothing), or a `pending`
 * cluster still waiting on its answer.
 *
 * `lookup-failed` carries the cluster (so its photos render), `retryDisabled`
 * (true for 429/503 quota/rate-limit, where an immediate retry is pointless —
 * KTD10), and `isRetrying` (true while U10's scoped re-fetch is in flight for
 * this cluster — drives the card spinner). It must NEVER collapse into
 * `photos-only`: that would re-introduce B1 (a transient failure rendered as a
 * confident "No place found").
 *
 * `pending` (U8/R10) is the NON-terminal state: the dispatch controller has
 * ACCEPTED this cluster (it is in `enqueuedClusterIds`) and nothing has resolved
 * it yet. It is sourced from the enqueued set rather than the in-flight set on
 * purpose — the in-flight set holds only the clusters in the live batches
 * (roughly 15 of 100), so sourcing pending rows from it would leave the screen
 * mostly empty. Retry is NOT offered on a pending row (R12): there is nothing to
 * retry, its request has not come back.
 */
export type ClusterDisplayItem =
  | { type: 'merged-suggestion'; data: MergedSuggestion }
  | { type: 'suggestion'; data: ClusterSuggestion; cluster: LocationClusterDisplay }
  | {
      type: 'lookup-failed';
      cluster: LocationClusterDisplay;
      retryDisabled: boolean;
      isRetrying: boolean;
    }
  | { type: 'photos-only'; cluster: LocationClusterDisplay }
  | { type: 'pending'; cluster: LocationClusterDisplay };

/**
 * Format date range for display
 */
export const formatDateRange = (start: Date, end: Date): string => {
  const startStr = start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const endStr = end.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  return `${startStr} - ${endStr}`;
};

/**
 * Format relative time for last scan (e.g., "2 hours ago", "Yesterday")
 */
export const formatLastScanTime = (timestamp: number): string => {
  const now = Date.now();
  const diffMs = now - timestamp;
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} min${diffMins !== 1 ? 's' : ''} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  return new Date(timestamp).toLocaleDateString();
};

/**
 * Create a MergedSuggestion from multiple clusters that share the same top place.
 */
export function createMergedSuggestion(
  clusterIds: string[],
  clusterSuggestionMap: Map<
    string,
    { suggestion: ClusterSuggestion; cluster: LocationClusterDisplay }
  >,
  clusterDisplays: Map<string, LocationClusterDisplay>
): MergedSuggestion | null {
  const allPhotoIds: string[] = [];
  const allPreviewUris: string[] = [];
  const allPreviewAssetIds: string[] = [];
  let minStart: Date | null = null;
  let maxEnd: Date | null = null;

  for (const clusterId of clusterIds) {
    const cluster = clusterDisplays.get(clusterId);
    if (!cluster) continue;

    allPhotoIds.push(...cluster.photoIds);
    allPreviewUris.push(...cluster.previewUris);
    // previewAssetIds is aligned with previewUris per cluster, so pushing both
    // in lockstep keeps merged.previewAssetIds[i] the asset for previewUris[i].
    allPreviewAssetIds.push(...cluster.previewAssetIds);

    if (!minStart || cluster.timeRange.start < minStart) {
      minStart = cluster.timeRange.start;
    }
    if (!maxEnd || cluster.timeRange.end > maxEnd) {
      maxEnd = cluster.timeRange.end;
    }
  }

  const primaryEntry = clusterSuggestionMap.get(clusterIds[0]);
  if (!primaryEntry) {
    console.error('[PhotoImport] Primary cluster not found in suggestion map:', clusterIds[0]);
    return null;
  }

  return {
    primaryClusterId: clusterIds[0],
    clusterIds,
    photoIds: allPhotoIds,
    previewUris: allPreviewUris.slice(0, 30),
    previewAssetIds: allPreviewAssetIds.slice(0, 30),
    photoCount: allPhotoIds.length,
    place: primaryEntry.suggestion.places[0],
    allPlaces: primaryEntry.suggestion.places,
    timeRange: {
      start: minStart!,
      end: maxEnd!,
    },
  };
}

/**
 * Convert a MergedSuggestion back to ClusterSuggestion format for PlaceSuggestionCard.
 */
export function buildSuggestionFromMerged(merged: MergedSuggestion): ClusterSuggestion {
  return {
    cluster_id: merged.primaryClusterId,
    photo_ids: merged.photoIds,
    places: merged.allPlaces,
  };
}
