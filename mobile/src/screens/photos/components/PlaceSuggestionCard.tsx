/**
 * PlaceSuggestionCard - Displays a place suggestion with photo previews
 * and confirm/reject actions. Supports upload progress and cycling through
 * alternative place suggestions. Skipping is handled by the SwipeToSkipCard
 * wrapper in ClusterListItem, not here.
 */

import { useCallback, useRef } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRecyclingState } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';

import type { ClusterSuggestion, PlaceSuggestion } from '@services/photoImport';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { styles } from '../photoImportStyles';
import { PhotoThumbnail } from './PhotoThumbnail';

/**
 * Metadata captured at the moment a user confirms or overrides a suggestion.
 * Used by useEntryCreation to build the photo_import block on the entry payload
 * (durable in place.extra_data) and to enrich PostHog events for offline evals.
 */
export interface SuggestionDecisionMeta {
  /** 1-based index of the place currently on screen at decision time. */
  suggested_rank: number;
  /** Total alternatives offered for this cluster. */
  alternatives_count: number;
  /** How many distinct alternatives the user actually viewed (>= 1). */
  alternatives_viewed: number;
}

export interface PlaceSuggestionCardProps {
  suggestion: ClusterSuggestion;
  previewUris: string[];
  /** Asset IDs positionally aligned with previewUris, for on-error re-resolve. */
  previewAssetIds?: string[];
  onConfirm: (
    suggestion: ClusterSuggestion,
    place: PlaceSuggestion,
    meta: SuggestionDecisionMeta
  ) => void;
  onReject: (suggestion: ClusterSuggestion, meta: SuggestionDecisionMeta) => void;
  onPhotoPress: (uri: string) => void;
  /** Number of selected (non-excluded) photos */
  selectedPhotoCount?: number;
  /** Total photo count for this cluster */
  totalPhotoCount?: number;
  /** Whether this card is currently uploading photos */
  isUploading?: boolean;
  /** Upload progress (0-100) */
  uploadProgress?: number;
  /** Current photo being uploaded (0-indexed) */
  uploadingPhotoIndex?: number;
  /** Total photos to upload */
  totalPhotosToUpload?: number;
  /** Callback to cancel upload */
  onCancelUpload?: () => void;
}

export function PlaceSuggestionCard({
  suggestion,
  previewUris,
  previewAssetIds,
  onConfirm,
  onReject,
  onPhotoPress,
  selectedPhotoCount,
  totalPhotoCount,
  isUploading,
  uploadProgress = 0,
  uploadingPhotoIndex = 0,
  totalPhotosToUpload = 0,
  onCancelUpload,
}: PlaceSuggestionCardProps) {
  // Track which alternative indices the user has actually viewed so we can
  // distinguish "accepted the top suggestion without looking" from "cycled
  // through 3 options before picking one". Always seeded with index 0.
  const viewedIndicesRef = useRef<Set<number>>(new Set([0]));

  // FlashList recycles this cell into a new cluster WITHOUT remounting, so a
  // plain useState would carry the previous cluster's index over. That index can
  // exceed the new cluster's `places` array, making currentPlace undefined and
  // blanking the card for a frame. useRecyclingState resets during the render
  // that reassigns the cell -- a useEffect would be a frame too late.
  const [placeIndex, setPlaceIndex] = useRecyclingState(0, [suggestion.cluster_id], () => {
    viewedIndicesRef.current = new Set([0]);
  });

  const places = suggestion.places;
  const hasAlternatives = places.length > 1;

  // Compute the next index and record it OUTSIDE the state updater. React may
  // invoke an updater more than once, which would double-count alternatives_viewed
  // (and mutating a ref inside one is the pattern React Compiler flags -- see U2).
  const goToPrevPlace = useCallback(() => {
    const next = placeIndex > 0 ? placeIndex - 1 : places.length - 1;
    viewedIndicesRef.current.add(next);
    setPlaceIndex(next);
  }, [placeIndex, places.length, setPlaceIndex]);

  const goToNextPlace = useCallback(() => {
    const next = placeIndex < places.length - 1 ? placeIndex + 1 : 0;
    viewedIndicesRef.current.add(next);
    setPlaceIndex(next);
  }, [placeIndex, places.length, setPlaceIndex]);

  const currentPlace = places[placeIndex];
  if (!currentPlace) return null;

  const buildDecisionMeta = (): SuggestionDecisionMeta => ({
    suggested_rank: placeIndex + 1,
    alternatives_count: places.length,
    alternatives_viewed: viewedIndicesRef.current.size,
  });

  const heroUri = previewUris[0];
  const heroAssetId = previewAssetIds?.[0];

  return (
    <View style={styles.suggestionCard}>
      {/* Hero Image */}
      <View style={styles.suggestionHeroContainer}>
        <TouchableOpacity
          activeOpacity={0.9}
          onPress={() => onPhotoPress(heroUri)}
          disabled={isUploading}
          style={{ flex: 1 }}
        >
          <PhotoThumbnail
            uri={heroUri}
            assetId={heroAssetId}
            style={styles.suggestionHeroImage}
            contentFit="cover"
            transition={200}
          />
        </TouchableOpacity>
      </View>

      {/* Alternatives strip overlaid on the photo. Rendered as a sibling of
          the hero container (matching suggestionFloatingActions) so its
          touch handlers are not affected by the hero's flex-1
          TouchableOpacity or by FlashList cell recycling that was leaving
          chevrons unresponsive after a save. */}
      {hasAlternatives && !isUploading && (
        <View style={styles.alternativesStrip} pointerEvents="box-none">
          <View style={styles.alternativesStripPill}>
            <TouchableOpacity
              accessibilityLabel="Previous suggestion"
              onPress={goToPrevPlace}
              hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
            >
              <Ionicons name="chevron-back" size={16} color={colors.white} />
            </TouchableOpacity>
            <Text style={styles.alternativesStripText}>
              {placeIndex + 1} of {places.length} options
            </Text>
            <TouchableOpacity
              accessibilityLabel="Next suggestion"
              onPress={goToNextPlace}
              hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
            >
              <Ionicons name="chevron-forward" size={16} color={colors.white} />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Floating Actions */}
      {!isUploading && (
        <View style={styles.suggestionFloatingActions}>
          <TouchableOpacity
            accessibilityLabel="Edit place suggestion"
            style={[styles.floatingActionButton, styles.floatingRejectButton]}
            onPress={() => onReject(suggestion, buildDecisionMeta())}
          >
            <Ionicons name="pencil" size={20} color={colors.white} />
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityLabel="Confirm place suggestion"
            style={[styles.floatingActionButton, styles.floatingConfirmButton]}
            onPress={() => onConfirm(suggestion, currentPlace, buildDecisionMeta())}
          >
            <Ionicons name="checkmark" size={24} color={colors.white} />
          </TouchableOpacity>
        </View>
      )}

      {/* Place info */}
      <View style={styles.suggestionContent}>
        <Text style={styles.suggestionName}>{currentPlace.name}</Text>
        <Text style={styles.suggestionAddress} numberOfLines={1}>
          {currentPlace.address}
        </Text>
        <View style={styles.suggestionMeta}>
          <View style={styles.categoryBadge}>
            <Text style={styles.categoryText}>{currentPlace.category}</Text>
          </View>
          <Text style={styles.distanceText}>{Math.round(currentPlace.distance_m)}m away</Text>
          {totalPhotoCount !== undefined && totalPhotoCount > 0 && (
            <Text style={localStyles.photoCountLabel}>
              {selectedPhotoCount !== undefined && selectedPhotoCount < totalPhotoCount
                ? `${selectedPhotoCount} of ${totalPhotoCount} photos`
                : `${totalPhotoCount} photo${totalPhotoCount !== 1 ? 's' : ''}`}
            </Text>
          )}
        </View>

        {/* Upload progress */}
        {isUploading && (
          <View style={localStyles.uploadContainerInline}>
            <View style={localStyles.uploadContent}>
              <ActivityIndicator size="small" color={colors.sunsetGold} />
              <Text style={localStyles.uploadText}>
                Uploading {uploadingPhotoIndex + 1} of {totalPhotosToUpload}...
              </Text>
            </View>
            <View style={localStyles.uploadProgressBar}>
              <View style={[localStyles.uploadProgressFill, { width: `${uploadProgress}%` }]} />
            </View>
            {onCancelUpload && (
              <TouchableOpacity onPress={onCancelUpload} style={localStyles.cancelButton}>
                <Text style={localStyles.cancelText}>Cancel</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

const localStyles = StyleSheet.create({
  uploadContainerInline: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  uploadContent: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  uploadText: {
    fontFamily: fonts.openSans.regular,
    fontSize: 14,
    color: colors.textSecondary,
    marginLeft: 8,
  },
  uploadProgressBar: {
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 8,
  },
  uploadProgressFill: {
    height: '100%',
    backgroundColor: colors.sunsetGold,
  },
  cancelButton: {
    alignSelf: 'center',
    paddingVertical: 4,
    paddingHorizontal: 12,
  },
  cancelText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 14,
    color: colors.adobeBrick,
  },
  photoCountLabel: {
    fontFamily: fonts.openSans.regular,
    fontSize: 13,
    color: colors.textTertiary,
    marginLeft: 'auto',
  },
});
