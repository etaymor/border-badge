import { memo, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';

import type { EntryType } from '@navigation/types';
import type { EntryWithPlace } from '@hooks/useEntries';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';

// Entry type icons and colors using brand palette
const ENTRY_TYPE_CONFIG: Record<
  EntryType,
  { icon: keyof typeof Ionicons.glyphMap; color: string; label: string }
> = {
  place: { icon: 'location', color: colors.adobeBrick, label: 'Place' },
  food: { icon: 'restaurant', color: colors.sunsetGold, label: 'Food' },
  stay: { icon: 'bed', color: colors.mossGreen, label: 'Stay' },
  experience: { icon: 'star', color: colors.midnightNavy, label: 'Experience' },
};

interface EntryGridCardProps {
  entry: EntryWithPlace;
  onPress?: () => void;
}

const CARD_GAP = 12;
const HORIZONTAL_PADDING = 16;

function EntryGridCardComponent({ entry, onPress }: EntryGridCardProps) {
  const { width: screenWidth } = useWindowDimensions();
  const [imageError, setImageError] = useState(false);
  const cardWidth = useMemo(
    () => (screenWidth - HORIZONTAL_PADDING * 2 - CARD_GAP) / 2,
    [screenWidth]
  );

  const typeConfig =
    ENTRY_TYPE_CONFIG[entry.entry_type as keyof typeof ENTRY_TYPE_CONFIG] ??
    ENTRY_TYPE_CONFIG.place;

  // Use user-uploaded media first, fall back to Google Places photo, then social media thumbnail
  const firstMedia = entry.media_files?.[0];
  const userMediaUrl = firstMedia?.thumbnail_url ?? firstMedia?.url;
  const googlePhotoUrl = entry.place?.google_photo_url;
  const socialThumbnailUrl = entry.metadata?.thumbnail_url;
  const firstMediaUrl = userMediaUrl ?? googlePhotoUrl ?? socialThumbnailUrl;
  const hasValidImage = firstMediaUrl && !imageError;

  return (
    <Pressable
      style={[styles.container, { width: cardWidth }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${entry.title}, ${typeConfig.label}`}
    >
      {/* Image or Icon Placeholder Background */}
      <View style={[styles.imageContainer, { aspectRatio: 1 }]}>
        {hasValidImage ? (
          <Image
            testID="entry-grid-card-image"
            source={{ uri: firstMediaUrl }}
            style={styles.image}
            contentFit="cover"
            recyclingKey={entry.id}
            cachePolicy="memory-disk"
            onError={() => setImageError(true)}
          />
        ) : (
          <View style={[styles.iconPlaceholder, { backgroundColor: typeConfig.color + '15' }]}>
            <Ionicons name={typeConfig.icon} size={48} color={typeConfig.color} />
          </View>
        )}

        {/* Top Glass Pane - Entry Title (frosted translucent fill, no live blur) */}
        <View style={styles.topGlassPane}>
          <Text style={styles.title} numberOfLines={2}>
            {entry.title}
          </Text>
        </View>

        {/* Bottom Row - Type Badge Left, Media Count Right */}
        <View style={styles.bottomRow}>
          {/* Type Badge - Glass Pill */}
          <View style={styles.typeBadge}>
            <Ionicons name={typeConfig.icon} size={20} color={typeConfig.color} />
          </View>

          {/* Media Count Badge (if more than 1 photo) */}
          {entry.media_files && entry.media_files.length > 1 && (
            <View style={styles.mediaCountBadge}>
              <Ionicons name="images" size={12} color={colors.midnightNavy} />
              <Text style={styles.mediaCountText}>{entry.media_files.length}</Text>
            </View>
          )}
        </View>
      </View>
    </Pressable>
  );
}

export const EntryGridCard = memo(EntryGridCardComponent);

const styles = StyleSheet.create({
  container: {
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: colors.backgroundSecondary,
    position: 'relative',
    shadowColor: colors.shadow,
    // Cheaper static lift: smaller blur radius, slightly higher opacity so the
    // card still reads as elevated without a wide per-frame shadow composite.
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 6,
  },
  imageContainer: {
    width: '100%',
    position: 'relative',
  },
  image: {
    width: '100%',
    height: '100%',
    backgroundColor: colors.backgroundMuted,
  },
  iconPlaceholder: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Top Glass Pane - Entry Title
  topGlassPane: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingVertical: 8,
    paddingHorizontal: 12,
    // Frosted cream fill (was 0.75 over a live blur); higher opacity reads as
    // frosted glass over the photo without compositing a UIVisualEffectView.
    backgroundColor: 'rgba(253, 246, 237, 0.86)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.6)',
    minHeight: 44,
    justifyContent: 'center',
  },
  title: {
    fontFamily: fonts.oswald.bold,
    fontSize: 14,
    color: colors.textPrimary,
    lineHeight: 17,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    textShadowColor: 'rgba(255, 255, 255, 0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },

  // Bottom Row - Badges
  bottomRow: {
    position: 'absolute',
    bottom: 10,
    left: 10,
    right: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  typeBadge: {
    width: 36, // Larger touch target/visual
    height: 36,
    borderRadius: 18,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.85)', // More opaque for better contrast
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.6)',
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  mediaCountBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    overflow: 'hidden',
    // Frosted white fill (was 0.25 over a live blur); higher opacity so the
    // count pill reads as frosted glass without the per-cell blur.
    backgroundColor: 'rgba(255, 255, 255, 0.7)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.6)',
  },
  mediaCountText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 11,
    color: colors.midnightNavy,
  },
});
