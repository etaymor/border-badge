import { memo, useMemo } from 'react';
import { Image, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { EntryType } from '@navigation/types';
import type { EntryWithPlace } from '@hooks/useEntries';

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

interface EntryGridCardProps {
  entry: EntryWithPlace;
  onPress?: () => void;
}

const CARD_GAP = 12;
const HORIZONTAL_PADDING = 16;

function EntryGridCardComponent({ entry, onPress }: EntryGridCardProps) {
  const { width: screenWidth } = useWindowDimensions();
  const cardWidth = useMemo(
    () => (screenWidth - HORIZONTAL_PADDING * 2 - CARD_GAP) / 2,
    [screenWidth]
  );

  const typeConfig =
    ENTRY_TYPE_CONFIG[entry.entry_type as keyof typeof ENTRY_TYPE_CONFIG] ??
    ENTRY_TYPE_CONFIG.place;
  const firstMedia = entry.media_files?.[0];
  const firstMediaUrl = firstMedia?.thumbnail_url ?? firstMedia?.url;

  return (
    <Pressable
      style={[styles.container, { width: cardWidth }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${entry.title}, ${typeConfig.label}`}
    >
      {/* Image or Icon Placeholder */}
      <View style={[styles.imageContainer, { height: cardWidth }]}>
        {firstMediaUrl ? (
          <Image source={{ uri: firstMediaUrl }} style={styles.image} />
        ) : (
          <View style={[styles.iconPlaceholder, { backgroundColor: typeConfig.color + '20' }]}>
            <Ionicons name={typeConfig.icon} size={32} color={typeConfig.color} />
          </View>
        )}

        {/* Type badge overlay */}
        <View style={[styles.typeBadge, { backgroundColor: typeConfig.color }]}>
          <Ionicons name={typeConfig.icon} size={12} color="#fff" />
        </View>
      </View>

      {/* Content */}
      <View style={styles.content}>
        <Text style={styles.title} numberOfLines={2}>
          {entry.title}
        </Text>

        {/* Place name if available */}
        {entry.place?.name && (
          <Text style={styles.placeName} numberOfLines={1}>
            {entry.place.name}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

export const EntryGridCard = memo(EntryGridCardComponent);

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#fff',
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  imageContainer: {
    width: '100%',
    position: 'relative',
  },
  image: {
    width: '100%',
    height: '100%',
    backgroundColor: '#f0f0f0',
  },
  iconPlaceholder: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  typeBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    padding: 10,
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1a1a1a',
    lineHeight: 18,
  },
  placeName: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
  },
});
