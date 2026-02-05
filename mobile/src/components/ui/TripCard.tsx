import { memo, useMemo } from 'react';
import { Animated, StyleSheet, Text, View, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { SharedTripImage } from '@components/transitions/SharedTripImage';
import { colors } from '@constants/colors';
import { isDevelopment } from '@config/env';
import { fonts } from '@constants/typography';
import { useAnimatedPress, AnimatedPressPresets } from '@hooks/useAnimatedPress';

export interface TripCardTrip {
  id: string;
  name: string;
  date_range?: string;
  cover_image_url?: string | null;
}

interface TripCardProps {
  trip: TripCardTrip;
  flagEmoji: string;
  onPress: () => void;
  testID?: string;
  /** Whether to enable shared element transition for the thumbnail */
  enableSharedElement?: boolean;
}

// Helper to format date range from PostgreSQL format
function formatDateRange(dateRange?: string): string {
  try {
    if (!dateRange) return '';

    // Parse PostgreSQL daterange format: "[2024-01-01,2024-01-15]"
    const match = dateRange.match(/\[([^,]+),([^\]]+)\]/);
    if (!match) return '';

    const [, startStr, endStr] = match;

    // Handle infinity bounds
    if (startStr === '-infinity' || endStr === 'infinity') {
      return '';
    }

    const start = new Date(startStr);
    const end = new Date(endStr);

    // Validate parsed dates
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return '';
    }

    const formatDate = (date: Date) =>
      date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

    if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
      return formatDate(start);
    }

    return `${formatDate(start)} - ${formatDate(end)}`;
  } catch (error) {
    if (isDevelopment) {
      console.warn('[TripCard] Failed to parse date range:', dateRange, error);
    }
    return '';
  }
}

// Deterministic color generator for trips without covers
const FALLBACK_COLORS = [
  colors.midnightNavy, // Deep Navy
  colors.adobeBrick, // Terra Cotta
  colors.mossGreen, // Forest Green
  colors.stormGray, // Slate
  '#8B5E3C', // Deep Earth Brown (custom for variety)
  '#4A6C6F', // Muted Teal
];

function getTripColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash << 5) - hash + id.charCodeAt(i);
    hash |= 0; // Convert to 32bit integer
  }
  const index = Math.abs(hash) % FALLBACK_COLORS.length;
  return FALLBACK_COLORS[index];
}

export const TripCard = memo(function TripCard({
  trip,
  flagEmoji,
  onPress,
  testID,
  enableSharedElement: _enableSharedElement = true,
}: TripCardProps) {
  const { scaleValue, pressHandlers } = useAnimatedPress(AnimatedPressPresets.subtle);
  // Memoize date formatting to avoid re-parsing on each render
  const dateStr = useMemo(() => formatDateRange(trip.date_range), [trip.date_range]);

  // Deterministic fallback color
  const fallbackColor = useMemo(() => getTripColor(trip.id), [trip.id]);

  return (
    <View style={styles.shadowWrapper}>
      <Animated.View style={[styles.container, { transform: [{ scale: scaleValue }] }]}>
        <Pressable
          style={styles.pressable}
          onPress={onPress}
          {...pressHandlers}
          testID={testID}
          accessibilityRole="button"
          accessibilityLabel={`View trip: ${trip.name}`}
          accessibilityHint="Opens trip details"
        >
          {/* Background Image or Solid Color */}
          <View
            style={[
              styles.backgroundContainer,
              !trip.cover_image_url && { backgroundColor: fallbackColor },
            ]}
          >
            {trip.cover_image_url ? (
              <SharedTripImage tripId={trip.id} style={StyleSheet.absoluteFill}>
                <Image
                  source={{ uri: trip.cover_image_url }}
                  style={styles.backgroundImage}
                  contentFit="cover"
                  transition={300}
                />
              </SharedTripImage>
            ) : null}

            {/* Overlay for text readability - only needed for images or very light colors */}
            <LinearGradient
              colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.1)', 'rgba(0,0,0,0.4)']}
              locations={[0, 0.6, 1]}
              style={styles.overlay}
            />
          </View>

          {/* Content */}
          <View style={styles.content}>
            <View style={styles.topRow}>
              <View style={styles.flagContainer}>
                <Text style={styles.flag}>{flagEmoji}</Text>
              </View>
            </View>

            <View style={styles.bottomRow}>
              <Text style={styles.tripName} numberOfLines={2}>
                {trip.name}
              </Text>
              {dateStr ? (
                <View style={styles.dateRow}>
                  <Ionicons name="calendar-outline" size={14} color="rgba(255,255,255,0.9)" />
                  <Text style={styles.dateText}>{dateStr}</Text>
                </View>
              ) : null}
            </View>
          </View>
        </Pressable>
      </Animated.View>
    </View>
  );
});

const styles = StyleSheet.create({
  shadowWrapper: {
    marginHorizontal: 20,
    height: 200,
    borderRadius: 20,
    backgroundColor: colors.paperBeige, // Required for iOS shadow to render
    // Shadow on outer wrapper (not affected by transform)
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 8,
  },
  container: {
    flex: 1,
    borderRadius: 20,
    backgroundColor: colors.paperBeige,
  },
  pressable: {
    flex: 1,
    borderRadius: 20, // Matched to container
    overflow: 'hidden',
  },
  backgroundContainer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.midnightNavy, // Default fallback
  },
  backgroundImage: {
    width: '100%',
    height: '100%',
    opacity: 0.9,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
  },
  content: {
    flex: 1,
    padding: 24,
    justifyContent: 'space-between',
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  flagContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  flag: {
    fontSize: 24,
  },
  bottomRow: {
    gap: 8,
  },
  tripName: {
    fontFamily: fonts.playfair.bold,
    fontSize: 28,
    color: colors.white,
    letterSpacing: -0.5,
    textShadowColor: 'rgba(0, 0, 0, 0.3)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dateText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.9)',
    letterSpacing: 0.5,
  },
});
