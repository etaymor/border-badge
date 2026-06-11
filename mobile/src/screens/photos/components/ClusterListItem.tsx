/**
 * Renders a single item in the suggestions FlashList.
 *
 * Handles three item types: merged suggestions, single suggestions, and photos-only clusters.
 */

import React from 'react';

import type {
  ClusterSuggestion,
  LocationClusterDisplay,
  PlaceSuggestion,
} from '@services/photoImport';
import type { ClusterUploadState } from '@hooks/useMultiClusterUpload';
import type { ClusterDisplayItem } from '../photoImportHelpers';
import { buildSuggestionFromMerged } from '../photoImportHelpers';
import type { MergedSuggestion } from '../photoImportTypes';
import { PlaceSuggestionCard, PhotoClusterCard, LookupFailedCard } from './index';
import type { SuggestionDecisionMeta } from './PlaceSuggestionCard';

export interface ClusterListItemProps {
  item: ClusterDisplayItem;
  uploadingClusterIds: Set<string>;
  getUploadState: (id: string) => ClusterUploadState | null;
  excludedPhotoIds: Map<string, Set<string>>;
  onConfirmPlace: (
    suggestion: ClusterSuggestion,
    place: PlaceSuggestion,
    meta: SuggestionDecisionMeta,
    wasFromCache: boolean,
    additionalClusterIds: string[],
    excluded?: Set<string>
  ) => Promise<void>;
  onRejectPlace: (suggestion: ClusterSuggestion, meta: SuggestionDecisionMeta) => void;
  onHideCluster: (clusterId: string) => Promise<void>;
  onHideMultipleClusters: (clusterIds: string[]) => Promise<void>;
  onAddEntryForCluster: (clusterId: string) => void;
  /** Retry the place lookup for a failed cluster (U10 supplies the real fetch). */
  onRetryCluster: (clusterId: string) => void;
  onCancelUpload: (clusterId: string) => void;
  onOpenGalleryForCluster: (
    uri: string,
    clusterId: string,
    cluster: LocationClusterDisplay
  ) => void;
  onOpenGalleryForMerged: (uri: string, merged: MergedSuggestion) => void;
}

export function ClusterListItem({
  item,
  uploadingClusterIds,
  getUploadState,
  excludedPhotoIds,
  onConfirmPlace,
  onRejectPlace,
  onHideCluster,
  onHideMultipleClusters,
  onAddEntryForCluster,
  onRetryCluster,
  onCancelUpload,
  onOpenGalleryForCluster,
  onOpenGalleryForMerged,
}: ClusterListItemProps) {
  if (item.type === 'merged-suggestion') {
    const merged = item.data;
    const isUploadingAny = merged.clusterIds.some((id) => uploadingClusterIds.has(id));
    const primaryUploadState = getUploadState(merged.primaryClusterId);

    const additionalClusterIds = merged.clusterIds.filter((id) => id !== merged.primaryClusterId);

    const totalPhotos = merged.previewUris.length;
    const excludedCount = excludedPhotoIds.get(merged.primaryClusterId)?.size ?? 0;
    const selectedPhotos = totalPhotos - excludedCount;

    return (
      <PlaceSuggestionCard
        suggestion={buildSuggestionFromMerged(merged)}
        previewUris={merged.previewUris}
        onConfirm={(suggestion, place, meta) => {
          const excluded = excludedPhotoIds.get(merged.primaryClusterId);
          onConfirmPlace(suggestion, place, meta, false, additionalClusterIds, excluded);
        }}
        onReject={onRejectPlace}
        onPhotoPress={(uri) => onOpenGalleryForMerged(uri, merged)}
        onDismiss={() => onHideMultipleClusters(merged.clusterIds)}
        selectedPhotoCount={selectedPhotos}
        totalPhotoCount={totalPhotos}
        isUploading={isUploadingAny}
        uploadProgress={primaryUploadState?.overallProgress ?? 0}
        uploadingPhotoIndex={primaryUploadState?.currentPhotoIndex ?? 0}
        totalPhotosToUpload={primaryUploadState?.totalPhotos ?? 0}
        onCancelUpload={() => onCancelUpload(merged.primaryClusterId)}
      />
    );
  }

  if (item.type === 'suggestion') {
    const clusterId = item.data.cluster_id;
    const isUploadingThisCluster = uploadingClusterIds.has(clusterId);
    const clusterUploadState = getUploadState(clusterId);

    const totalPhotos = item.cluster.previewUris.length;
    const excludedCount = excludedPhotoIds.get(clusterId)?.size ?? 0;
    const selectedPhotos = totalPhotos - excludedCount;

    return (
      <PlaceSuggestionCard
        suggestion={item.data}
        previewUris={item.cluster.previewUris}
        onConfirm={(suggestion, place, meta) => {
          const excluded = excludedPhotoIds.get(clusterId);
          onConfirmPlace(suggestion, place, meta, false, [], excluded);
        }}
        onReject={onRejectPlace}
        onPhotoPress={(uri) => onOpenGalleryForCluster(uri, clusterId, item.cluster)}
        onDismiss={onHideCluster}
        selectedPhotoCount={selectedPhotos}
        totalPhotoCount={totalPhotos}
        isUploading={isUploadingThisCluster}
        uploadProgress={clusterUploadState?.overallProgress ?? 0}
        uploadingPhotoIndex={clusterUploadState?.currentPhotoIndex ?? 0}
        totalPhotosToUpload={clusterUploadState?.totalPhotos ?? 0}
        onCancelUpload={() => onCancelUpload(clusterId)}
      />
    );
  }

  if (item.type === 'lookup-failed') {
    return (
      <LookupFailedCard
        cluster={item.cluster}
        retryDisabled={item.retryDisabled}
        onRetry={onRetryCluster}
        onAddEntry={(cluster) => onAddEntryForCluster(cluster.id)}
        onPhotoPress={(uri) => onOpenGalleryForCluster(uri, item.cluster.id, item.cluster)}
        onDismiss={onHideCluster}
      />
    );
  }

  if (item.type === 'photos-only') {
    return (
      <PhotoClusterCard
        cluster={item.cluster}
        onAddEntry={(cluster) => onAddEntryForCluster(cluster.id)}
        onPhotoPress={(uri) => onOpenGalleryForCluster(uri, item.cluster.id, item.cluster)}
        onDismiss={onHideCluster}
      />
    );
  }

  // Exhaustiveness: a new union member must be handled, not silently fall
  // through to PhotoClusterCard. Adding a ClusterDisplayItem variant without a
  // branch above fails compile here instead of mis-rendering at runtime.
  const _exhaustive: never = item;
  return _exhaustive;
}
