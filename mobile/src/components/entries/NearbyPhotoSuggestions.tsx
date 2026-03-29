/**
 * Horizontal strip of nearby photo suggestions from the device library.
 *
 * Displays cached photos taken near a selected place's coordinates.
 * Users tap photos to add them to the entry.
 */

import { memo, useCallback } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import type { CachedPhoto } from '@services/photoImport/types';

const THUMBNAIL_SIZE = 72;

interface NearbyPhotoSuggestionsProps {
  photos: CachedPhoto[];
  isLoading: boolean;
  cacheExists: boolean;
  onPhotoSelect: (photo: CachedPhoto) => void;
  remainingSlots: number;
  addedPhotoIds: Set<string>;
}

export const NearbyPhotoSuggestions = memo(function NearbyPhotoSuggestions({
  photos,
  isLoading,
  cacheExists,
  onPhotoSelect,
  remainingSlots,
  addedPhotoIds,
}: NearbyPhotoSuggestionsProps) {
  const renderPhoto = useCallback(
    (item: CachedPhoto) => {
      const isAdded = addedPhotoIds.has(item.id);
      const isDisabled = isAdded || remainingSlots <= 0;

      return (
        <Pressable
          key={item.id}
          style={[styles.thumbnail, isDisabled && styles.thumbnailDisabled]}
          onPress={() => !isDisabled && onPhotoSelect(item)}
          disabled={isDisabled}
          accessibilityRole="button"
          accessibilityLabel={isAdded ? 'Photo already added' : 'Add photo to entry'}
        >
          <Image source={{ uri: item.uri }} style={styles.thumbnailImage} resizeMode="cover" />
          {isAdded && (
            <View style={styles.checkOverlay}>
              <Ionicons name="checkmark-circle" size={24} color="#fff" />
            </View>
          )}
        </Pressable>
      );
    },
    [addedPhotoIds, remainingSlots, onPhotoSelect]
  );

  // Loading or no nearby photos — render nothing to avoid flashing the label
  if (isLoading || (cacheExists && photos.length === 0)) {
    return null;
  }

  // No cache — user hasn't scanned yet
  if (!cacheExists) {
    return (
      <View style={styles.container}>
        <Text style={styles.label}>PHOTOS FROM YOUR LIBRARY</Text>
        <Text style={styles.hint}>Scan your photo library to see nearby photos here</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.label}>PHOTOS FROM YOUR LIBRARY</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.list}
      >
        {photos.map(renderPhoto)}
      </ScrollView>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    marginBottom: 24,
  },
  label: {
    fontFamily: fonts.oswald.medium,
    fontSize: 12,
    color: colors.midnightNavy,
    marginBottom: 12,
    letterSpacing: 1.5,
    opacity: 0.7,
    textTransform: 'uppercase',
  },
  hint: {
    fontFamily: fonts.openSans.regular,
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  list: {
    gap: 8,
  },
  thumbnail: {
    width: THUMBNAIL_SIZE,
    height: THUMBNAIL_SIZE,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: colors.backgroundMuted,
  },
  thumbnailDisabled: {
    opacity: 0.5,
  },
  thumbnailImage: {
    width: '100%',
    height: '100%',
  },
  checkOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
