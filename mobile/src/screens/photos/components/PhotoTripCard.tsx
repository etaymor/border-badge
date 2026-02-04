/**
 * PhotoTripCard - Card for displaying a photo-discovered trip.
 *
 * Features:
 * - Photo preview grid with thumbnails
 * - Country flag and name
 * - Date range display
 * - Spring press animation
 * - Staggered fade-in entrance animation
 * - Expandable inline trip selector
 */

import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  LayoutAnimation,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { InlineTripSelector } from '@components/share/InlineTripSelector';
import type { TripCandidateDisplay } from '@services/photoImport';
import { useCountryByCode } from '@hooks/useCountries';
import { colors, withAlpha } from '@constants/colors';
import { fonts } from '@constants/typography';
import { getFlagEmoji } from '@utils/flags';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export interface PhotoTripCardProps {
  candidate: TripCandidateDisplay;
  /** Called when trip is selected */
  onSelectTrip: (candidate: TripCandidateDisplay, tripId: string) => Promise<void>;
  /** Called when a new trip is created */
  onCreateTrip: (name: string, countryCode: string) => Promise<string>;
  /** Index for staggered animation */
  index: number;
}

/**
 * Format date range for display
 */
const formatDateRange = (start: Date, end: Date) => {
  const startStr = start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const endStr = end.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  return `${startStr} - ${endStr}`;
};

export function PhotoTripCard({
  candidate,
  onSelectTrip,
  onCreateTrip,
  index,
}: PhotoTripCardProps) {
  const { data: country } = useCountryByCode(candidate.countryCode);
  const reducedMotion = useReducedMotion();
  const flag = getFlagEmoji(candidate.countryCode);
  const countryName = country?.name ?? candidate.countryCode;
  const photoCount = candidate.photoCount;
  // We display up to 3 images in the masonry layout (1 big, 2 small)
  const previewUris = candidate.previewUris.slice(0, 3);

  // Animation values
  const scale = useSharedValue(1);
  const entranceProgress = useSharedValue(0);

  // Component state
  const [isExpanded, setIsExpanded] = useState(false);
  const [isCreatingTrip, setIsCreatingTrip] = useState(false);
  const [pendingTripId, setPendingTripId] = useState<string | null>(null);
  const [isSelectingTrip, setIsSelectingTrip] = useState(false);

  // Staggered entrance animation
  useEffect(() => {
    if (reducedMotion) {
      entranceProgress.value = 1;
    } else {
      entranceProgress.value = withDelay(
        index * 50,
        withTiming(1, { duration: 300, easing: Easing.out(Easing.cubic) })
      );
    }
  }, [index, reducedMotion, entranceProgress]);

  // Entrance animation style
  const entranceStyle = useAnimatedStyle(() => ({
    opacity: entranceProgress.value,
    transform: [{ translateY: interpolate(entranceProgress.value, [0, 1], [16, 0]) }],
  }));

  // Press animation style
  const pressStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = useCallback(() => {
    if (!reducedMotion) {
      scale.value = withSpring(0.97, { damping: 15, stiffness: 400 });
    }
  }, [reducedMotion, scale]);

  const handlePressOut = useCallback(() => {
    if (!reducedMotion) {
      scale.value = withSpring(1, { damping: 15, stiffness: 400 });
    }
  }, [reducedMotion, scale]);

  const handleCardPress = useCallback(() => {
    // Toggle expansion with animation
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setIsExpanded(!isExpanded);
  }, [isExpanded]);

  const handleTripSelect = useCallback(
    async (tripId: string) => {
      setPendingTripId(tripId);
      setIsSelectingTrip(true);
      try {
        await onSelectTrip(candidate, tripId);
      } finally {
        setIsSelectingTrip(false);
      }
    },
    [candidate, onSelectTrip]
  );

  const handleCreateTrip = useCallback(
    async (name: string, countryCode: string): Promise<string> => {
      setIsCreatingTrip(true);
      try {
        const tripId = await onCreateTrip(name, countryCode);
        setPendingTripId(tripId);
        setIsSelectingTrip(true);
        await onSelectTrip(candidate, tripId);
        return tripId;
      } finally {
        setIsCreatingTrip(false);
        setIsSelectingTrip(false);
      }
    },
    [candidate, onCreateTrip, onSelectTrip]
  );

  const isLoading = isSelectingTrip;

  return (
    <Animated.View style={[styles.cardContainer, entranceStyle]}>
      <AnimatedPressable
        style={[styles.card, pressStyle]}
        onPress={handleCardPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={isLoading}
      >
        {/* Masonry Photo Layout */}
        <View style={styles.photosGrid}>
          {/* Left Column - Large Image */}
          <View style={styles.leftColumn}>
            {previewUris[0] ? (
              <Image
                source={{ uri: previewUris[0] }}
                style={styles.imageFull}
                contentFit="cover"
                transition={200}
                recyclingKey={previewUris[0]}
              />
            ) : (
              <View style={styles.placeholderFull} />
            )}
          </View>

          {/* Right Column - Stacked Images */}
          <View style={styles.rightColumn}>
            <View style={styles.rightImageContainer}>
              {previewUris[1] ? (
                <Image
                  source={{ uri: previewUris[1] }}
                  style={styles.imageFull}
                  contentFit="cover"
                  transition={200}
                  recyclingKey={previewUris[1]}
                />
              ) : (
                <View style={styles.placeholderFull} />
              )}
            </View>
            <View style={styles.rightImageContainer}>
              {previewUris[2] ? (
                <Image
                  source={{ uri: previewUris[2] }}
                  style={styles.imageFull}
                  contentFit="cover"
                  transition={200}
                  recyclingKey={previewUris[2]}
                />
              ) : (
                <View style={styles.placeholderFull} />
              )}
              {/* Overlay for remaining photos */}
              {photoCount > 3 && (
                <View style={styles.morePhotosOverlay}>
                  <Text style={styles.morePhotosText}>+{photoCount - 3}</Text>
                </View>
              )}
            </View>
          </View>
        </View>

        {/* Trip info */}
        <View style={styles.infoRow}>
          <Text style={styles.flag}>{flag}</Text>
          <View style={styles.details}>
            <Text style={styles.countryName} numberOfLines={1}>
              {countryName}
            </Text>
            <Text style={styles.dateRange}>
              {formatDateRange(candidate.dateRange.start, candidate.dateRange.end)}
            </Text>
          </View>
          {isLoading ? (
            <ActivityIndicator size="small" color={colors.sunsetGold} />
          ) : (
            <Ionicons
              name={isExpanded ? 'chevron-down' : 'chevron-forward'}
              size={20}
              color={colors.textSecondary}
              style={styles.chevron}
            />
          )}
        </View>
      </AnimatedPressable>

      {/* Expanded trip selector */}
      {isExpanded && (
        <View style={styles.expandedSection}>
          <Text style={styles.selectorLabel}>SELECT OR CREATE A TRIP</Text>
          <InlineTripSelector
            selectedTripId={pendingTripId}
            onSelectTrip={handleTripSelect}
            countryCode={candidate.countryCode}
            onCreateTrip={handleCreateTrip}
            isCreatingTrip={isCreatingTrip}
            isSelectingTrip={isSelectingTrip}
          />
        </View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  cardContainer: {
    marginBottom: 20,
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 6,
  },
  photosGrid: {
    flexDirection: 'row',
    height: 160,
    gap: 2,
  },
  leftColumn: {
    flex: 1.5,
    height: '100%',
  },
  rightColumn: {
    flex: 1,
    height: '100%',
    gap: 2,
  },
  rightImageContainer: {
    flex: 1,
    position: 'relative',
  },
  imageFull: {
    width: '100%',
    height: '100%',
  },
  placeholderFull: {
    width: '100%',
    height: '100%',
    backgroundColor: colors.border,
  },
  morePhotosOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  morePhotosText: {
    fontFamily: fonts.openSans.bold,
    fontSize: 18,
    color: colors.white,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 16,
    paddingTop: 16, // Added gap between photos and text
  },
  flag: {
    fontSize: 36,
    marginRight: 16,
  },
  details: {
    flex: 1,
    justifyContent: 'center',
  },
  countryName: {
    fontFamily: fonts.playfair.bold,
    fontSize: 22, // Larger
    color: colors.midnightNavy,
    marginBottom: 4,
  },
  dateRange: {
    fontFamily: fonts.openSans.regular,
    fontSize: 14, // Smaller
    color: colors.textSecondary, // Gray
  },
  chevron: {
    marginLeft: 8,
  },
  expandedSection: {
    backgroundColor: colors.white,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
    paddingHorizontal: 16,
    paddingBottom: 16,
    marginTop: -16,
    paddingTop: 16,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  selectorLabel: {
    fontFamily: fonts.oswald.medium,
    fontSize: 12,
    color: colors.midnightNavy,
    marginBottom: 12,
    letterSpacing: 1.5,
    opacity: 0.7,
    textTransform: 'uppercase',
  },
});
