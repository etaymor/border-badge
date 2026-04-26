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
import { PlaceSuggestionCard, PhotoClusterCard } from './index';
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

  // photos-only type
  return (
    <PhotoClusterCard
      cluster={item.cluster}
      onAddEntry={(cluster) => onAddEntryForCluster(cluster.id)}
      onPhotoPress={(uri) => onOpenGalleryForCluster(uri, item.cluster.id, item.cluster)}
      onDismiss={onHideCluster}
    />
  );
}
