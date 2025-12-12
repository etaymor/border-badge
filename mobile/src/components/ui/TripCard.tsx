import { useEffect, useRef } from 'react';
import { Animated, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { colors } from '@constants/colors';
import { isDevelopment } from '@config/env';
import { fonts } from '@constants/typography';

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

export function TripCard({ trip, flagEmoji, onPress, testID }: TripCardProps) {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const dateStr = formatDateRange(trip.date_range);

  // Cleanup: stop any running animation and reset value on unmount
  useEffect(() => {
    return () => {
      scaleAnim.stopAnimation();
      scaleAnim.setValue(1);
    };
  }, [scaleAnim]);

  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.98,
      friction: 8,
      tension: 100,
      useNativeDriver: true,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      friction: 8,
      tension: 100,
      useNativeDriver: true,
    }).start();
  };

  return (
    <Animated.View style={[styles.container, { transform: [{ scale: scaleAnim }] }]}>
      <Pressable
        style={styles.pressable}
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={`View trip: ${trip.name}`}
        accessibilityHint="Opens trip details"
      >
        {/* Thumbnail */}
        {trip.cover_image_url ? (
          <Image source={{ uri: trip.cover_image_url }} style={styles.thumbnail} />
        ) : (
          <View style={styles.thumbnailPlaceholder}>
            <LinearGradient
              colors={[colors.lakeBlue, colors.mossGreen]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.thumbnailGradient}
            />
            <Text style={styles.thumbnailFlag}>{flagEmoji}</Text>
          </View>
        )}

        {/* Content */}
        <View style={styles.content}>
          <Text style={styles.tripName} numberOfLines={1}>
            {trip.name}
          </Text>
          {dateStr ? (
            <View style={styles.dateRow}>
              <Ionicons name="calendar-outline" size={14} color={colors.stormGray} />
              <Text style={styles.dateText}>{dateStr}</Text>
            </View>
          ) : null}
        </View>

        {/* Chevron */}
        <View style={styles.chevronContainer}>
          <Ionicons name="chevron-forward" size={20} color={colors.stormGray} />
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 20,
    marginVertical: 6,
    borderRadius: 16,
    backgroundColor: colors.paperBeige,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  pressable: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
  },
  thumbnail: {
    width: 72,
    height: 72,
    borderRadius: 12,
    backgroundColor: colors.backgroundMuted,
  },
  thumbnailPlaceholder: {
    width: 72,
    height: 72,
    borderRadius: 12,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  thumbnailGradient: {
    ...StyleSheet.absoluteFillObject,
  },
  thumbnailFlag: {
    fontSize: 32,
  },
  content: {
    flex: 1,
    marginLeft: 16,
    justifyContent: 'center',
  },
  tripName: {
    fontFamily: fonts.playfair.bold,
    fontSize: 17,
    color: colors.midnightNavy,
    marginBottom: 4,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dateText: {
    fontFamily: fonts.openSans.regular,
    fontSize: 14,
    color: colors.stormGray,
  },
  chevronContainer: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
