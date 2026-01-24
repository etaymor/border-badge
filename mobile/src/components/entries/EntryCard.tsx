import { memo, useEffect, useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { EntryType } from '@navigation/types';
import type { EntryWithPlace } from '@hooks/useEntries';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { getFlagEmoji } from '@utils/flags';
import { logger } from '@utils/logger';

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

interface EntryCardProps {
  entry: EntryWithPlace;
  onPress?: () => void;
  onLongPress?: () => void;
}

function formatDate(dateString: string | null): string {
  if (!dateString) return '';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
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

/**
 * Common country name to ISO code mapping for flag display.
 */
const COUNTRY_NAME_TO_CODE: Record<string, string> = {
  Thailand: 'TH',
  Egypt: 'EG',
  Canada: 'CA',
  'United States': 'US',
  USA: 'US',
  'United Kingdom': 'GB',
  UK: 'GB',
  France: 'FR',
  Germany: 'DE',
  Italy: 'IT',
  Spain: 'ES',
  Japan: 'JP',
  China: 'CN',
  Australia: 'AU',
  Mexico: 'MX',
  Brazil: 'BR',
  India: 'IN',
  'South Korea': 'KR',
  Netherlands: 'NL',
  Switzerland: 'CH',
  Portugal: 'PT',
  Greece: 'GR',
  Turkey: 'TR',
  Indonesia: 'ID',
  Vietnam: 'VN',
  Singapore: 'SG',
  Malaysia: 'MY',
  Philippines: 'PH',
  'New Zealand': 'NZ',
  Argentina: 'AR',
  Chile: 'CL',
  Colombia: 'CO',
  Peru: 'PE',
  Morocco: 'MA',
  'South Africa': 'ZA',
  Kenya: 'KE',
  Iceland: 'IS',
  Norway: 'NO',
  Sweden: 'SE',
  Denmark: 'DK',
  Finland: 'FI',
  Ireland: 'IE',
  Austria: 'AT',
  Belgium: 'BE',
  'Czech Republic': 'CZ',
  Czechia: 'CZ',
  Poland: 'PL',
  Hungary: 'HU',
  Croatia: 'HR',
  Russia: 'RU',
  Ukraine: 'UA',
  Israel: 'IL',
  'United Arab Emirates': 'AE',
  UAE: 'AE',
  'Saudi Arabia': 'SA',
  Qatar: 'QA',
  Taiwan: 'TW',
  'Hong Kong': 'HK',
};

/**
 * Get flag emoji for a country name.
 * Falls back to globe emoji if country code not found.
 */
function getCountryFlag(countryName: string | null): string {
  if (!countryName) return '\u{1F30D}'; // Globe emoji
  const code = COUNTRY_NAME_TO_CODE[countryName];
  return code ? getFlagEmoji(code) : '\u{1F30D}';
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

function EntryCardComponent({ entry, onPress, onLongPress }: EntryCardProps) {
  const typeConfig = ENTRY_TYPE_CONFIG[entry.entry_type as EntryType] || ENTRY_TYPE_CONFIG.place;
  const hasUserMedia = entry.media_files && entry.media_files.length > 0;
  const mediaCount = entry.media_files?.length ?? 0;
  const [imageError, setImageError] = useState(false);
  const placePhotoUrl = useMemo(
    () => isValidGooglePhotoUrl(entry.place?.google_photo_url ?? null),
    [entry.place?.google_photo_url]
  );

  // Debug logging
  useEffect(() => {
    if (entry.place?.google_photo_url) {
      logger.log('[EntryCard] Photo URL info', {
        entryId: entry.id,
        rawPhotoUrl: entry.place.google_photo_url?.substring(0, 100),
        validatedUrl: placePhotoUrl?.substring(0, 100),
        hasUserMedia,
      });
    }
  }, [entry.id, entry.place?.google_photo_url, placePhotoUrl, hasUserMedia]);

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

  // Build accessibility label
  const accessibilityParts = [
    typeConfig.label,
    entry.title,
    entry.place?.name && `at ${entry.place.name}`,
    entry.entry_date && formatDate(entry.entry_date),
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
      {/* Entry Type Badge */}
      <View style={[styles.typeBadge, { backgroundColor: typeConfig.color + '15' }]}>
        <Ionicons name={typeConfig.icon} size={16} color={typeConfig.color} />
      </View>

      {/* Main Content */}
      <View style={styles.content}>
        <Text style={styles.title} numberOfLines={1}>
          {entry.title}
        </Text>

        {/* Country from address if available - show with flag */}
        {entry.place?.address && extractCountryFromAddress(entry.place.address) && (
          <View style={styles.placeRow}>
            <Text style={styles.countryFlag}>
              {getCountryFlag(extractCountryFromAddress(entry.place.address))}
            </Text>
            <Text style={styles.countryText} numberOfLines={1}>
              {extractCountryFromAddress(entry.place.address)}
            </Text>
          </View>
        )}

        {/* Date */}
        {entry.entry_date && <Text style={styles.date}>{formatDate(entry.entry_date)}</Text>}
      </View>

      {/* Media Preview - always show thumbnail area */}
      <View style={styles.mediaContainer}>
        {shouldShowImage && firstMediaUrl ? (
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
        ) : (
          <View
            style={[styles.mediaThumbnailPlaceholder, { backgroundColor: typeConfig.color + '15' }]}
          >
            <Ionicons name={typeConfig.icon} size={28} color={typeConfig.color} />
          </View>
        )}
        {mediaCount > 1 && (
          <View style={styles.mediaCount}>
            <Text style={styles.mediaCountText}>+{mediaCount - 1}</Text>
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
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  typeBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  content: {
    flex: 1,
    marginRight: 12,
  },
  title: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 16,
    color: colors.textPrimary,
    marginBottom: 4,
  },
  placeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  countryFlag: {
    fontSize: 14,
    marginRight: 4,
  },
  countryText: {
    fontFamily: fonts.openSans.regular,
    fontSize: 13,
    color: colors.stormGray,
    flex: 1,
  },
  date: {
    fontFamily: fonts.openSans.regular,
    fontSize: 12,
    color: colors.textTertiary,
  },
  mediaContainer: {
    position: 'relative',
  },
  mediaThumbnail: {
    width: 72,
    height: 72,
    borderRadius: 12,
    backgroundColor: colors.backgroundMuted,
  },
  mediaThumbnailPlaceholder: {
    width: 72,
    height: 72,
    borderRadius: 12,
    backgroundColor: colors.backgroundMuted,
    justifyContent: 'center',
    alignItems: 'center',
  },
  mediaCount: {
    position: 'absolute',
    bottom: -4,
    right: -4,
    backgroundColor: colors.mossGreen,
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
    minWidth: 20,
    alignItems: 'center',
  },
  mediaCountText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 10,
    color: colors.white,
  },
});
