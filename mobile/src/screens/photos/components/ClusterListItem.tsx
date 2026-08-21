/**
 * Renders a single item in the suggestions FlashList.
 *
 * Handles five item types: merged suggestions, single suggestions, lookup-failed
 * clusters, photos-only clusters, and pending clusters (U8/R10) whose lookup has
 * not answered yet.
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
import {
  PlaceSuggestionCard,
  PhotoClusterCard,
  LookupFailedCard,
  PendingClusterCard,
} from './index';
import { SwipeToSkipCard } from './SwipeToSkipCard';
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
      <SwipeToSkipCard
        itemId={merged.primaryClusterId}
        onSkip={() => onHideMultipleClusters(merged.clusterIds)}
        enabled={!isUploadingAny}
      >
        <PlaceSuggestionCard
          suggestion={buildSuggestionFromMerged(merged)}
          previewUris={merged.previewUris}
          previewAssetIds={merged.previewAssetIds}
          onConfirm={(suggestion, place, meta) => {
            const excluded = excludedPhotoIds.get(merged.primaryClusterId);
            onConfirmPlace(suggestion, place, meta, false, additionalClusterIds, excluded);
          }}
          onReject={onRejectPlace}
          onPhotoPress={(uri) => onOpenGalleryForMerged(uri, merged)}
          selectedPhotoCount={selectedPhotos}
          totalPhotoCount={totalPhotos}
          isUploading={isUploadingAny}
          uploadProgress={primaryUploadState?.overallProgress ?? 0}
          uploadingPhotoIndex={primaryUploadState?.currentPhotoIndex ?? 0}
          totalPhotosToUpload={primaryUploadState?.totalPhotos ?? 0}
          onCancelUpload={() => onCancelUpload(merged.primaryClusterId)}
        />
      </SwipeToSkipCard>
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
      <SwipeToSkipCard
        itemId={clusterId}
        onSkip={() => onHideCluster(clusterId)}
        enabled={!isUploadingThisCluster}
      >
        <PlaceSuggestionCard
          suggestion={item.data}
          previewUris={item.cluster.previewUris}
          previewAssetIds={item.cluster.previewAssetIds}
          onConfirm={(suggestion, place, meta) => {
            const excluded = excludedPhotoIds.get(clusterId);
            onConfirmPlace(suggestion, place, meta, false, [], excluded);
          }}
          onReject={onRejectPlace}
          onPhotoPress={(uri) => onOpenGalleryForCluster(uri, clusterId, item.cluster)}
          selectedPhotoCount={selectedPhotos}
          totalPhotoCount={totalPhotos}
          isUploading={isUploadingThisCluster}
          uploadProgress={clusterUploadState?.overallProgress ?? 0}
          uploadingPhotoIndex={clusterUploadState?.currentPhotoIndex ?? 0}
          totalPhotosToUpload={clusterUploadState?.totalPhotos ?? 0}
          onCancelUpload={() => onCancelUpload(clusterId)}
        />
      </SwipeToSkipCard>
    );
  }

  if (item.type === 'lookup-failed') {
    const clusterId = item.cluster.id;
    return (
      <SwipeToSkipCard itemId={clusterId} onSkip={() => onHideCluster(clusterId)}>
        <LookupFailedCard
          cluster={item.cluster}
          retryDisabled={item.retryDisabled}
          isRetrying={item.isRetrying}
          onRetry={onRetryCluster}
          onAddEntry={(cluster) => onAddEntryForCluster(cluster.id)}
          onPhotoPress={(uri) => onOpenGalleryForCluster(uri, item.cluster.id, item.cluster)}
        />
      </SwipeToSkipCard>
    );
  }

  if (item.type === 'photos-only') {
    const clusterId = item.cluster.id;
    return (
      <SwipeToSkipCard itemId={clusterId} onSkip={() => onHideCluster(clusterId)}>
        <PhotoClusterCard
          cluster={item.cluster}
          onAddEntry={(cluster) => onAddEntryForCluster(cluster.id)}
          onPhotoPress={(uri) => onOpenGalleryForCluster(uri, item.cluster.id, item.cluster)}
        />
      </SwipeToSkipCard>
    );
  }

  if (item.type === 'pending') {
    // R12: no retry, no confirm, no add-manually. Swipe-to-skip and opening the
    // photo are the only interactions a not-yet-answered location supports.
    const clusterId = item.cluster.id;
    return (
      <SwipeToSkipCard itemId={clusterId} onSkip={() => onHideCluster(clusterId)}>
        <PendingClusterCard
          cluster={item.cluster}
          onPhotoPress={(uri) => onOpenGalleryForCluster(uri, clusterId, item.cluster)}
        />
      </SwipeToSkipCard>
    );
  }

  // Exhaustiveness: a new union member must be handled, not silently fall
  // through to PhotoClusterCard. Adding a ClusterDisplayItem variant without a
  // branch above fails compile here instead of mis-rendering at runtime.
  const _exhaustive: never = item;
  return _exhaustive;
}
