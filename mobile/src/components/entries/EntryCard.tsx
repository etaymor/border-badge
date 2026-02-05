import { memo, useEffect, useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import type { EntryWithPlace } from '@hooks/useEntries';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { getFlagEmoji } from '@utils/flags';
import { logger } from '@utils/logger';

interface EntryCardProps {
  entry: EntryWithPlace;
  onPress?: () => void;
  onLongPress?: () => void;
}

/**
 * Validate that a URL is a Google Places photo URL.
 * Both v1 (places.googleapis.com) and legacy (maps.googleapis.com) formats are supported.
 */
function isValidGooglePhotoUrl(url: string | null): string | null {
  if (!url) {
    return null;
  }

  try {
    const parsed = new URL(url);

    // Valid Google photo URL domains
    const validHosts = [
      'places.googleapis.com',
      'maps.googleapis.com',
      'lh3.googleusercontent.com',
      'ggpht.com',
    ];

    const isValid = validHosts.some(
      (host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`)
    );

    return isValid ? url : null;
  } catch {
    return null;
  }
}

/**
 * Extract country name from Google Places address.
 * Most addresses end with country name after last comma.
 */
function extractCountryFromAddress(address: string | null): string | null {
  if (!address) return null;
  const parts = address.split(',').map((p) => p.trim());
  return parts.length >= 2 ? parts[parts.length - 1] : null;
}

function EntryCardComponent({ entry, onPress, onLongPress }: EntryCardProps) {
  const hasUserMedia = entry.media_files && entry.media_files.length > 0;
  const mediaCount = entry.media_files?.length ?? 0;
  const [imageError, setImageError] = useState(false);
  const placePhotoUrl = useMemo(
    () => isValidGooglePhotoUrl(entry.place?.google_photo_url ?? null),
    [entry.place?.google_photo_url]
  );

  // Social media thumbnail from metadata (Instagram/TikTok)
  const socialThumbnailUrl = entry.metadata?.thumbnail_url ?? null;

  // Use user-uploaded media first, then social thumbnail, then Google Places photo
  const firstMediaUrl = hasUserMedia
    ? (entry.media_files?.[0]?.thumbnail_url ?? entry.media_files?.[0]?.url)
    : (socialThumbnailUrl ?? placePhotoUrl);

  const hasMedia = !!firstMediaUrl;
  const shouldShowImage = hasMedia && !imageError;

  useEffect(() => {
    setImageError(false);
  }, [entry.id, firstMediaUrl]);

  // Get country code - prefer direct country_code, fallback to extracting from address
  const countryCode = entry.place?.country_code?.toUpperCase() ?? null;
  const countryName = extractCountryFromAddress(entry.place?.address ?? null);

  // Build accessibility label
  const accessibilityParts = [
    entry.title,
    countryName && `in ${countryName}`,
    hasUserMedia && `${mediaCount} photo${mediaCount > 1 ? 's' : ''}`,
  ].filter(Boolean);

  return (
    <Pressable
      style={styles.container}
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityParts.join(', ')}
      accessibilityHint="Double tap to view entry details"
    >
      {/* Thumbnail - only show if we have media */}
      {shouldShowImage && firstMediaUrl ? (
        <View style={styles.mediaContainer}>
          <Image
            source={{ uri: firstMediaUrl }}
            style={styles.mediaThumbnail}
            onError={(e) => {
              logger.warn('[EntryCard] Image load error', {
                url: firstMediaUrl.substring(0, 100),
                error: e.nativeEvent?.error,
              });
              setImageError(true);
            }}
            onLoad={() => {
              logger.log('[EntryCard] Image loaded successfully', {
                url: firstMediaUrl.substring(0, 100),
              });
            }}
          />
          {mediaCount > 1 && (
            <View style={styles.mediaCount}>
              <Text style={styles.mediaCountText}>+{mediaCount - 1}</Text>
            </View>
          )}
        </View>
      ) : null}

      {/* Main Content */}
      <View style={styles.content}>
        <Text style={styles.title} numberOfLines={2}>
          {entry.title}
        </Text>

        {/* Country with flag */}
        {(countryCode || countryName) && (
          <View style={styles.placeRow}>
            {countryCode && <Text style={styles.countryFlag}>{getFlagEmoji(countryCode)}</Text>}
            {countryName && (
              <Text style={styles.countryText} numberOfLines={1}>
                {countryName}
              </Text>
            )}
          </View>
        )}
      </View>
    </Pressable>
  );
}

export const EntryCard = memo(EntryCardComponent);

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.paperBeige,
    borderRadius: 16,
    padding: 12,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },
  mediaContainer: {
    position: 'relative',
    marginRight: 12,
  },
  mediaThumbnail: {
    width: 56,
    height: 56,
    borderRadius: 10,
    backgroundColor: colors.backgroundMuted,
  },
  mediaCount: {
    position: 'absolute',
    bottom: -4,
    right: -4,
    backgroundColor: colors.mossGreen,
    borderRadius: 8,
    paddingHorizontal: 5,
    paddingVertical: 1,
    minWidth: 18,
    alignItems: 'center',
  },
  mediaCountText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 9,
    color: colors.white,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
  },
  title: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 15,
    color: colors.textPrimary,
    lineHeight: 20,
  },
  placeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  countryFlag: {
    fontSize: 13,
    marginRight: 6,
  },
  countryText: {
    fontFamily: fonts.openSans.regular,
    fontSize: 13,
    color: colors.stormGray,
    flex: 1,
  },
});
