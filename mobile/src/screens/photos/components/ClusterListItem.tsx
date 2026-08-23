/**
 * Renders a single item in the suggestions FlashList.
 *
 * Handles five item types: merged suggestions, single suggestions, lookup-failed
 * clusters, photos-only clusters, and pending clusters (U8/R10) whose lookup has
 * not answered yet.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';

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
  /**
   * U2's auto-seeded exclusions per cluster. Used only to name the cause of a
   * hidden count the user did not create; a tapped exclusion keeps the plain
   * count the cards already render.
   */
  seededPhotoIds?: Map<string, Set<string>>;
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

/**
 * U3 - name the cause when a hidden count came from the seed (U2) rather than
 * from the user's own taps. Text only, and the word is "hidden": nothing is
 * removed from the cluster, and one tap in the gallery brings it all back.
 *
 * Speaks only for exclusions we made. The moment the user hides a photo of
 * their own, the cluster falls back to the plain count the cards already show.
 */
function SeededHiddenNote({
  clusterId,
  excludedPhotoIds,
  seededPhotoIds,
}: {
  clusterId: string;
  excludedPhotoIds: Map<string, Set<string>>;
  seededPhotoIds?: Map<string, Set<string>>;
}) {
  const excluded = excludedPhotoIds.get(clusterId);
  const seeded = seededPhotoIds?.get(clusterId);
  if (!excluded?.size || !seeded?.size) return null;
  for (const id of excluded) {
    if (!seeded.has(id)) return null;
  }
  return (
    <View style={localStyles.seededNoteRow}>
      <Text style={localStyles.seededNoteText}>
        {excluded.size} hidden — screenshots and repeats
      </Text>
    </View>
  );
}

export function ClusterListItem({
  item,
  uploadingClusterIds,
  getUploadState,
  excludedPhotoIds,
  seededPhotoIds,
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
      <>
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
        <SeededHiddenNote
          clusterId={merged.primaryClusterId}
          excludedPhotoIds={excludedPhotoIds}
          seededPhotoIds={seededPhotoIds}
        />
      </>
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
      <>
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
        <SeededHiddenNote
          clusterId={clusterId}
          excludedPhotoIds={excludedPhotoIds}
          seededPhotoIds={seededPhotoIds}
        />
      </>
    );
  }

  if (item.type === 'lookup-failed') {
    const clusterId = item.cluster.id;
    return (
      <>
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
        <SeededHiddenNote
          clusterId={clusterId}
          excludedPhotoIds={excludedPhotoIds}
          seededPhotoIds={seededPhotoIds}
        />
      </>
    );
  }

  if (item.type === 'photos-only') {
    const clusterId = item.cluster.id;
    return (
      <>
        <SwipeToSkipCard itemId={clusterId} onSkip={() => onHideCluster(clusterId)}>
          <PhotoClusterCard
            cluster={item.cluster}
            onAddEntry={(cluster) => onAddEntryForCluster(cluster.id)}
            onPhotoPress={(uri) => onOpenGalleryForCluster(uri, item.cluster.id, item.cluster)}
          />
        </SwipeToSkipCard>
        <SeededHiddenNote
          clusterId={clusterId}
          excludedPhotoIds={excludedPhotoIds}
          seededPhotoIds={seededPhotoIds}
        />
      </>
    );
  }

  if (item.type === 'pending') {
    // R12: no retry, no confirm, no add-manually. Swipe-to-skip and opening the
    // photo are the only interactions a not-yet-answered location supports.
    const clusterId = item.cluster.id;
    return (
      <>
        <SwipeToSkipCard itemId={clusterId} onSkip={() => onHideCluster(clusterId)}>
          <PendingClusterCard
            cluster={item.cluster}
            onPhotoPress={(uri) => onOpenGalleryForCluster(uri, clusterId, item.cluster)}
          />
        </SwipeToSkipCard>
        <SeededHiddenNote
          clusterId={clusterId}
          excludedPhotoIds={excludedPhotoIds}
          seededPhotoIds={seededPhotoIds}
        />
      </>
    );
  }

  // Exhaustiveness: a new union member must be handled, not silently fall
  // through to PhotoClusterCard. Adding a ClusterDisplayItem variant without a
  // branch above fails compile here instead of mis-rendering at runtime.
  const _exhaustive: never = item;
  return _exhaustive;
}

const localStyles = StyleSheet.create({
  seededNoteRow: {
    paddingHorizontal: 20,
    marginTop: -8,
    marginBottom: 12,
  },
  seededNoteText: {
    fontFamily: fonts.openSans.regular,
    fontSize: 13,
    color: colors.textTertiary,
  },
});
