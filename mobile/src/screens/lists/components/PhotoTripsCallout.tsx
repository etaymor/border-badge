/**
 * PhotoTripsCallout - Prominent card to access photo-discovered trips.
 *
 * Features:
 * - Preview thumbnails from recent trips
 * - Trip count badge
 * - Spring press animation
 * - "Link camera roll" state when no photos imported yet
 */

import { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  useReducedMotion,
} from 'react-native-reanimated';

import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface PhotoTripsCalloutProps {
  /** Number of discovered trips */
  tripCount: number;
  /** Preview URIs from recent trips (max 3) */
  previewUris: string[];
  /** Whether user has imported photos at least once */
  hasInitialImport: boolean;
  /** Handler when callout is pressed */
  onPress: () => void;
}

export function PhotoTripsCallout({
  tripCount,
  previewUris,
  hasInitialImport,
  onPress,
}: PhotoTripsCalloutProps) {
  const reducedMotion = useReducedMotion();
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
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

  const handlePress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  }, [onPress]);

  // Show "link camera roll" state when no initial import
  if (!hasInitialImport) {
    return (
      <AnimatedPressable
        style={[styles.container, styles.containerUnlinked, animatedStyle]}
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        accessibilityRole="button"
        accessibilityLabel="Link your camera roll to discover trips from photos"
      >
        {/* Camera icon */}
        <View style={[styles.iconContainer, styles.iconContainerUnlinked]}>
          <Ionicons name="camera-outline" size={24} color={colors.sunsetGold} />
        </View>

        {/* Text content */}
        <View style={styles.textContainer}>
          <Text style={styles.title}>Find Trips in Photos</Text>
          <Text style={styles.subtitle}>Scan your camera roll to discover trips</Text>
        </View>

        {/* Chevron */}
        <View style={styles.chevronContainer}>
          <Ionicons name="chevron-forward" size={20} color={colors.sunsetGold} />
        </View>
      </AnimatedPressable>
    );
  }

  // Don't render if imported but no trips discovered
  if (tripCount === 0) return null;

  return (
    <AnimatedPressable
      style={[styles.container, animatedStyle]}
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      accessibilityRole="button"
      accessibilityLabel={`View ${tripCount} trips discovered from photos`}
    >
      {/* Preview thumbnails */}
      <View style={styles.thumbnailRow}>
        {previewUris.slice(0, 3).map((uri, index) => (
          <Image
            key={`thumb-${index}`}
            source={{ uri }}
            style={[
              styles.thumbnail,
              index === 0 && styles.thumbnailFirst,
              index > 0 && styles.thumbnailOverlap,
            ]}
            contentFit="cover"
            transition={200}
            recyclingKey={uri}
          />
        ))}
        {previewUris.length === 0 && (
          <View style={[styles.thumbnail, styles.thumbnailPlaceholder]}>
            <Ionicons name="images" size={20} color={colors.sunsetGold} />
          </View>
        )}
      </View>

      {/* Text content */}
      <View style={styles.textContainer}>
        <Text style={styles.title}>Camera Roll Trips</Text>
        <Text style={styles.subtitle}>
          {tripCount} {tripCount === 1 ? 'trip' : 'trips'} discovered
        </Text>
      </View>

      {/* Chevron */}
      <View style={styles.chevronContainer}>
        <Ionicons name="chevron-forward" size={20} color={colors.sunsetGold} />
      </View>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: 16,
    padding: 16,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
    borderWidth: 1,
    borderColor: 'rgba(244, 194, 78, 0.3)',
  },
  containerUnlinked: {
    borderStyle: 'dashed',
    backgroundColor: 'rgba(244, 194, 78, 0.05)',
  },
  iconContainer: {
    marginRight: 12,
  },
  iconContainerUnlinked: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(244, 194, 78, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  thumbnailRow: {
    flexDirection: 'row',
    marginRight: 12,
  },
  thumbnail: {
    width: 44,
    height: 44,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.white,
  },
  thumbnailFirst: {
    zIndex: 3,
  },
  thumbnailOverlap: {
    marginLeft: -14,
  },
  thumbnailPlaceholder: {
    backgroundColor: 'rgba(244, 194, 78, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(244, 194, 78, 0.3)',
    borderStyle: 'dashed',
  },
  textContainer: {
    flex: 1,
  },
  title: {
    fontFamily: fonts.playfair.bold,
    fontSize: 16,
    color: colors.midnightNavy,
    marginBottom: 2,
  },
  subtitle: {
    fontFamily: fonts.openSans.regular,
    fontSize: 13,
    color: colors.textSecondary,
  },
  chevronContainer: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(244, 194, 78, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
