import { memo, useEffect, useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { EntryType } from '@navigation/types';
import type { EntryWithPlace } from '@hooks/useEntries';
import { logger } from '@utils/logger';
// Entry type icons and colors
const ENTRY_TYPE_CONFIG: Record<
  EntryType,
  { icon: keyof typeof Ionicons.glyphMap; color: string; label: string }
> = {
  place: { icon: 'location', color: '#007AFF', label: 'Place' },
  food: { icon: 'restaurant', color: '#FF9500', label: 'Food' },
  stay: { icon: 'bed', color: '#5856D6', label: 'Stay' },
  experience: { icon: 'star', color: '#34C759', label: 'Experience' },
};

interface EntryCardProps {
  entry: EntryWithPlace;
  onPress?: () => void;
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

function EntryCardComponent({ entry, onPress }: EntryCardProps) {
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

  // Use user-uploaded media first, fall back to Google Places photo
  const firstMediaUrl = hasUserMedia
    ? (entry.media_files?.[0]?.thumbnail_url ?? entry.media_files?.[0]?.url)
    : placePhotoUrl;

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

        {/* Place name if available */}
        {entry.place?.name && (
          <View style={styles.placeRow}>
            <Ionicons name="location-outline" size={14} color="#666" />
            <Text style={styles.placeName} numberOfLines={1}>
              {entry.place.name}
            </Text>
          </View>
        )}

        {/* Date */}
        {entry.entry_date && <Text style={styles.date}>{formatDate(entry.entry_date)}</Text>}
      </View>

      {/* Media Preview */}
      {shouldShowImage ? (
        <View style={styles.mediaContainer}>
          {firstMediaUrl ? (
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
            <View style={styles.mediaThumbnailPlaceholder}>
              <Ionicons name="image" size={20} color="#ccc" />
            </View>
          )}
          {mediaCount > 1 && (
            <View style={styles.mediaCount}>
              <Text style={styles.mediaCountText}>+{mediaCount - 1}</Text>
            </View>
          )}
        </View>
      ) : (
        <Ionicons name="chevron-forward" size={20} color="#ccc" />
      )}
    </Pressable>
  );
}

export const EntryCard = memo(EntryCardComponent);

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
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
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 4,
  },
  placeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  placeName: {
    fontSize: 13,
    color: '#666',
    marginLeft: 4,
    flex: 1,
  },
  date: {
    fontSize: 12,
    color: '#999',
  },
  mediaContainer: {
    position: 'relative',
  },
  mediaThumbnail: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: '#f0f0f0',
  },
  mediaThumbnailPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: '#f0f0f0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  mediaCount: {
    position: 'absolute',
    bottom: -4,
    right: -4,
    backgroundColor: '#007AFF',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
    minWidth: 20,
    alignItems: 'center',
  },
  mediaCountText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#fff',
  },
});
