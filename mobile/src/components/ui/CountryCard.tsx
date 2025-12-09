import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  GestureResponderEvent,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

import { colors } from '@constants/colors';
import { getFlagEmoji } from '@utils/flags';
import { getCountryImage } from '../../assets/countryImages';

export interface CountryCardProps {
  /** ISO 3166-1 alpha-2 country code (e.g., "US", "FR") */
  code: string;
  /** Country display name */
  name: string;
  /** Country region for display context */
  region?: string;
  /** Optional image URL for future implementation */
  imageUrl?: string;
  /** Whether the country is already visited */
  isVisited?: boolean;
  /** Whether the country is in the wishlist */
  isWishlisted?: boolean;
  /** Handler when card body is pressed - navigates to CountryDetail */
  onPress: () => void;
  /** Handler for plus button - marks as visited */
  onAddVisited: () => void;
  /** Handler for heart button - adds to wishlist */
  onToggleWishlist: () => void;
  /** Optional custom container style */
  style?: ViewStyle;
  /** Test ID for testing purposes */
  testID?: string;
}

export const CountryCard = React.memo(function CountryCard({
  code,
  name,
  region: _region,
  isVisited = false,
  isWishlisted = false,
  onPress,
  onAddVisited,
  onToggleWishlist,
  style,
  testID,
}: CountryCardProps) {
  const flagEmoji = useMemo(() => getFlagEmoji(code), [code]);
  const countryImage = useMemo(() => getCountryImage(code), [code]);
  const heartScale = useRef(new Animated.Value(1)).current;

  // Cleanup: stop any running animation on unmount
  useEffect(() => {
    return () => {
      heartScale.stopAnimation();
    };
  }, [heartScale]);

  const animateHeartPulse = useCallback(() => {
    Animated.sequence([
      Animated.spring(heartScale, {
        toValue: 1.3,
        friction: 3,
        tension: 200,
        useNativeDriver: true,
      }),
      Animated.spring(heartScale, {
        toValue: 1,
        friction: 3,
        useNativeDriver: true,
      }),
    ]).start();
  }, [heartScale]);

  const handleAddVisitedPress = useCallback(
    (e?: GestureResponderEvent) => {
      e?.stopPropagation?.();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onAddVisited();
    },
    [onAddVisited]
  );

  const handleWishlistPress = useCallback(
    (e?: GestureResponderEvent) => {
      e?.stopPropagation?.();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      // Animate heart pulse when adding to wishlist (not when removing)
      if (!isWishlisted) {
        animateHeartPulse();
      }
      onToggleWishlist();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- animateHeartPulse is stable (only depends on heartScale ref)
    [onToggleWishlist, isWishlisted]
  );

  return (
    <TouchableOpacity
      style={[styles.container, style]}
      onPress={onPress}
      activeOpacity={0.9}
      accessibilityRole="button"
      accessibilityLabel={`${name}, tap to view details`}
      testID={testID || `country-card-${code}`}
    >
      {/* Country Image or Placeholder */}
      {countryImage ? (
        <Image source={countryImage} style={styles.countryImage} resizeMode="cover" />
      ) : (
        <View style={styles.imagePlaceholder}>
          <Ionicons name="image-outline" size={48} color={colors.textTertiary} />
        </View>
      )}

      {/* Flag Badge - Top Left */}
      <View style={styles.flagContainer}>
        <Text style={styles.flagEmoji}>{flagEmoji}</Text>
      </View>

      {/* Action Buttons - Top Right */}
      <View style={styles.actionsContainer}>
        {/* Plus Button - Add to Visited */}
        <TouchableOpacity
          style={[styles.actionButton, isVisited && styles.actionButtonVisited]}
          onPress={handleAddVisitedPress}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel={isVisited ? 'Already visited' : 'Mark as visited'}
          testID={`country-card-visited-${code}`}
        >
          <Ionicons
            name={isVisited ? 'checkmark' : 'add'}
            size={24}
            color={isVisited ? colors.white : colors.successDark}
          />
        </TouchableOpacity>

        {/* Heart Button - Add to Wishlist */}
        <Animated.View style={{ transform: [{ scale: heartScale }] }}>
          <TouchableOpacity
            style={[styles.actionButton, isWishlisted && styles.actionButtonWishlisted]}
            onPress={handleWishlistPress}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel={isWishlisted ? 'Remove from wishlist' : 'Add to wishlist'}
            testID={`country-card-wishlist-${code}`}
          >
            <Ionicons
              name={isWishlisted ? 'heart' : 'heart-outline'}
              size={22}
              color={isWishlisted ? colors.wishlistBrown : colors.textTertiary}
            />
          </TouchableOpacity>
        </Animated.View>
      </View>

      {/* Country Name Label - Bottom */}
      <View style={styles.nameContainer}>
        <Text style={styles.countryName} numberOfLines={2}>
          {name}
        </Text>
      </View>
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: colors.backgroundSecondary,
    aspectRatio: 3 / 4,
    position: 'relative',
  },
  countryImage: {
    width: '100%',
    height: '100%',
  },
  imagePlaceholder: {
    width: '100%',
    height: '100%',
    backgroundColor: colors.backgroundPlaceholder,
    justifyContent: 'center',
    alignItems: 'center',
  },
  flagContainer: {
    position: 'absolute',
    top: 12,
    left: 12,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.overlayLight,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  flagEmoji: {
    fontSize: 22,
  },
  nameContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.overlayLight,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  countryName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  actionsContainer: {
    position: 'absolute',
    top: 12,
    right: 12,
    gap: 8,
  },
  actionButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.overlayLight,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  actionButtonVisited: {
    backgroundColor: colors.successDark,
  },
  actionButtonWishlisted: {
    backgroundColor: colors.wishlistGold,
  },
});
