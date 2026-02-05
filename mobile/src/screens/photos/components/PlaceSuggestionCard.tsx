/**
 * PlaceSuggestionCard - Displays a place suggestion with photo previews
 * and confirm/reject actions. Supports swipe-left-to-dismiss and upload progress.
 */

import { useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';

import type { ClusterSuggestion, PlaceSuggestion } from '@services/photoImport';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { styles } from '../photoImportStyles';

export interface PlaceSuggestionCardProps {
  suggestion: ClusterSuggestion;
  previewUris: string[];
  onConfirm: (suggestion: ClusterSuggestion, place: PlaceSuggestion) => void;
  onReject: (suggestion: ClusterSuggestion) => void;
  onPhotoPress: (uri: string, allUris: string[]) => void;
  onDismiss?: (clusterId: string) => void;
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
  onConfirm,
  onReject,
  onPhotoPress,
  onDismiss,
  isUploading,
  uploadProgress = 0,
  uploadingPhotoIndex = 0,
  totalPhotosToUpload = 0,
  onCancelUpload,
}: PlaceSuggestionCardProps) {
  const swipeableRef = useRef<Swipeable>(null);
  const topPlace = suggestion.places[0];
  if (!topPlace) return null;

  const heroUri = previewUris[0];

  const renderRightActions = (
    progress: Animated.AnimatedInterpolation<number>,
    _dragX: Animated.AnimatedInterpolation<number>
  ) => {
    const scale = progress.interpolate({
      inputRange: [0, 1],
      outputRange: [0.8, 1],
      extrapolate: 'clamp',
    });

    return (
      <View style={localStyles.swipeActionContainer}>
        <Animated.View style={[localStyles.swipeAction, { transform: [{ scale }] }]}>
          <Ionicons name="close-circle" size={28} color={colors.white} />
          <Text style={localStyles.swipeActionText}>Skip</Text>
        </Animated.View>
      </View>
    );
  };

  const handleSwipeOpen = () => {
    if (onDismiss) {
      onDismiss(suggestion.cluster_id);
    }
  };

  return (
    <Swipeable
      ref={swipeableRef}
      renderRightActions={renderRightActions}
      onSwipeableOpen={handleSwipeOpen}
      friction={2}
      rightThreshold={80}
      overshootRight={false}
      enabled={!isUploading} // Disable swipe during upload
    >
      <View style={styles.suggestionCard}>
        {/* Hero Image */}
        <View style={styles.suggestionHeroContainer}>
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => onPhotoPress(heroUri, previewUris)}
            disabled={isUploading}
            style={{ flex: 1 }}
          >
            <Image
              source={{ uri: heroUri }}
              style={styles.suggestionHeroImage}
              contentFit="cover"
              transition={200}
              recyclingKey={heroUri}
            />
          </TouchableOpacity>
        </View>

        {/* Floating Actions */}
        {!isUploading && (
          <View style={styles.suggestionFloatingActions}>
            <TouchableOpacity
              style={[styles.floatingActionButton, styles.floatingRejectButton]}
              onPress={() => onReject(suggestion)}
            >
              <Ionicons name="close" size={24} color={colors.white} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.floatingActionButton, styles.floatingConfirmButton]}
              onPress={() => onConfirm(suggestion, topPlace)}
            >
              <Ionicons name="checkmark" size={24} color={colors.white} />
            </TouchableOpacity>
          </View>
        )}

        {/* Place info */}
        <View style={styles.suggestionContent}>
          <Text style={styles.suggestionName}>{topPlace.name}</Text>
          <Text style={styles.suggestionAddress} numberOfLines={1}>
            {topPlace.address}
          </Text>
          <View style={styles.suggestionMeta}>
            <View style={styles.categoryBadge}>
              <Text style={styles.categoryText}>{topPlace.category}</Text>
            </View>
            <Text style={styles.distanceText}>{Math.round(topPlace.distance_m)}m away</Text>
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
    </Swipeable>
  );
}

const localStyles = StyleSheet.create({
  swipeActionContainer: {
    width: 100,
    backgroundColor: colors.adobeBrick,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24, // Matches suggestionCard marginBottom
    borderTopRightRadius: 16,
    borderBottomRightRadius: 16,
  },
  swipeAction: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  swipeActionText: {
    color: colors.white,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
  },
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
});
