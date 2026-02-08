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
import { BlurView } from 'expo-blur';

import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { useAnimatedPress, AnimatedPressPresets } from '@hooks/useAnimatedPress';
import { useReducedMotion } from '@hooks/useReducedMotion';
import { useResponsive } from '@hooks/useResponsive';
import { getFlagEmoji } from '@utils/flags';
import { getCountryImage } from '../../assets/countryImages';
import quillIcon from '../../../assets/quill-icon.png';

// Layout constants exported for tooltip overlay alignment
export const COUNTRY_CARD_LAYOUT = {
  BORDER_RADIUS: 20,
  BOTTOM_ROW_OFFSET: 12,
  ACTION_BUTTON_SIZE: 40,
  ACTION_BUTTON_GAP: 8,
} as const;

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
  /** Whether the country has any trips logged */
  hasTrips?: boolean;
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
  region,
  isVisited = false,
  isWishlisted = false,
  hasTrips = false,
  onPress,
  onAddVisited,
  onToggleWishlist,
  style,
  testID,
}: CountryCardProps) {
  const { isSmallScreen } = useResponsive();
  const reduceMotion = useReducedMotion();
  const flagEmoji = useMemo(() => getFlagEmoji(code), [code]);
  const countryImage = useMemo(() => getCountryImage(code), [code]);

  // Press feedback animation
  const { scaleValue: pressScale, pressHandlers } = useAnimatedPress(AnimatedPressPresets.default);

  // Visited inner-border fade animation
  const visitedBorderOpacity = useRef(new Animated.Value(isVisited ? 1 : 0)).current;
  const visitedAnimRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (reduceMotion) {
      visitedBorderOpacity.setValue(isVisited ? 1 : 0);
      return;
    }
    // Stop any in-flight animation to avoid leaks/overlaps
    if (visitedAnimRef.current) {
      visitedAnimRef.current.stop();
      visitedAnimRef.current = null;
    }
    const anim = Animated.timing(visitedBorderOpacity, {
      toValue: isVisited ? 1 : 0,
      duration: 280,
      useNativeDriver: true,
    });
    visitedAnimRef.current = anim;
    anim.start(() => {
      visitedAnimRef.current = null;
    });
  }, [isVisited, reduceMotion, visitedBorderOpacity]);

  // Wishlist button pop animation
  const wishlistScale = useRef(new Animated.Value(1)).current;
  const wishlistAnimRef = useRef<Animated.CompositeAnimation | null>(null);

  const triggerWishlistPop = useCallback(() => {
    if (reduceMotion) {
      wishlistScale.setValue(1);
      return;
    }
    // Stop any in-flight animation to avoid leaks/overlaps
    if (wishlistAnimRef.current) {
      wishlistAnimRef.current.stop();
      wishlistAnimRef.current = null;
    }
    // Quick pop: scale up to 1.3 then back to 1
    const anim = Animated.sequence([
      Animated.spring(wishlistScale, {
        toValue: 1.3,
        friction: 3,
        tension: 200,
        useNativeDriver: true,
      }),
      Animated.spring(wishlistScale, {
        toValue: 1,
        friction: 5,
        tension: 100,
        useNativeDriver: true,
      }),
    ]);
    wishlistAnimRef.current = anim;
    anim.start(() => {
      wishlistAnimRef.current = null;
    });
  }, [reduceMotion, wishlistScale]);

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
      if (!reduceMotion) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      triggerWishlistPop();
      onToggleWishlist();
    },
    [onToggleWishlist, triggerWishlistPop, reduceMotion]
  );

  // Ensure animated values settle when reduce motion is enabled/toggled
  useEffect(() => {
    if (reduceMotion) {
      wishlistScale.stopAnimation();
      wishlistScale.setValue(1);
      if (wishlistAnimRef.current) {
        wishlistAnimRef.current.stop();
        wishlistAnimRef.current = null;
      }
    }
    return () => {
      if (wishlistAnimRef.current) {
        wishlistAnimRef.current.stop();
        wishlistAnimRef.current = null;
      }
    };
  }, [reduceMotion, wishlistScale]);

  return (
    <Animated.View style={{ transform: [{ scale: pressScale }] }}>
      <TouchableOpacity
        style={[styles.container, style]}
        onPress={onPress}
        onPressIn={pressHandlers.onPressIn}
        onPressOut={pressHandlers.onPressOut}
        activeOpacity={1}
        accessibilityRole="button"
        accessibilityLabel={`${name}, tap to view details`}
        accessibilityHint="Opens country details"
        testID={testID || `country-card-${code}`}
      >
        {/* Background Image */}
        {countryImage ? (
          <Image source={countryImage} style={styles.countryImage} resizeMode="cover" />
        ) : (
          <View style={styles.imagePlaceholder}>
            <Ionicons name="image-outline" size={48} color={colors.textTertiary} />
          </View>
        )}

        {/* Top Liquid Glass Pane - Country Name */}
        <BlurView intensity={45} tint="light" style={styles.topGlassPane}>
          <View style={styles.textContainer}>
            <Text
              style={[styles.countryName, isSmallScreen && styles.countryNameSmall]}
              numberOfLines={2}
            >
              {name}
            </Text>
            {region && (
              <Text style={styles.regionName} numberOfLines={1}>
                {region}
              </Text>
            )}
          </View>
        </BlurView>

        {/* Bottom Row - Flag Badge Left, Action Buttons Right */}
        <View style={styles.bottomRow}>
          {/* Flag Badge - Bottom Left */}
          <View style={styles.flagContainer}>
            <BlurView intensity={30} tint="light" style={styles.glassBadge}>
              <Text style={styles.flagEmoji}>{flagEmoji}</Text>
            </BlurView>
            {/* Trips Indicator - Badge next to flag */}
            {hasTrips && (
              <View style={styles.tripsIndicator} testID={`country-card-trips-${code}`}>
                <Image source={quillIcon} style={styles.tripsIcon} />
              </View>
            )}
          </View>

          {/* Action Buttons - Bottom Right */}
          <View style={styles.actionsContainer}>
            {/* Visited Button */}
            <TouchableOpacity
              onPress={handleAddVisitedPress}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel={isVisited ? 'Already visited' : 'Mark as visited'}
              accessibilityHint={
                isVisited
                  ? 'Country is already in your visited list'
                  : 'Adds country to your visited list'
              }
              testID={`country-card-visited-${code}`}
            >
              <BlurView
                intensity={30}
                tint="light"
                style={[styles.actionButton, isVisited && styles.actionButtonVisited]}
              >
                <Ionicons
                  name={isVisited ? 'checkmark' : 'add'}
                  size={22}
                  color={isVisited ? colors.white : colors.successDark}
                />
              </BlurView>
            </TouchableOpacity>

            {/* Wishlist Button */}
            <Animated.View style={{ transform: [{ scale: wishlistScale }] }}>
              <TouchableOpacity
                onPress={handleWishlistPress}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel={isWishlisted ? 'Remove from wishlist' : 'Add to wishlist'}
                accessibilityHint={
                  isWishlisted
                    ? 'Removes country from your dreams list'
                    : 'Adds country to your dreams list'
                }
                testID={`country-card-wishlist-${code}`}
              >
                <BlurView
                  intensity={30}
                  tint="light"
                  style={[styles.actionButton, isWishlisted && styles.actionButtonWishlisted]}
                >
                  <View style={styles.airplaneIconRotated}>
                    <Ionicons
                      name={isWishlisted ? 'airplane' : 'airplane-outline'}
                      size={20}
                      color={isWishlisted ? colors.wishlistBrown : colors.textTertiary}
                    />
                  </View>
                </BlurView>
              </TouchableOpacity>
            </Animated.View>
          </View>
        </View>

        {/* Visited inner-glow border — always mounted to avoid layout shift */}
        <Animated.View
          style={[styles.visitedBorderOverlay, { opacity: visitedBorderOpacity }]}
          pointerEvents="none"
        />
      </TouchableOpacity>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    borderRadius: COUNTRY_CARD_LAYOUT.BORDER_RADIUS,
    overflow: 'hidden',
    backgroundColor: colors.backgroundSecondary,
    aspectRatio: 3 / 4,
    position: 'relative',
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 8,
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
  // Top Glass Pane - Country Name
  topGlassPane: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(253, 246, 237, 0.75)', // Warm tint + Blur
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.6)',
  },
  // Bottom Row - Flag and Actions
  bottomRow: {
    position: 'absolute',
    bottom: COUNTRY_CARD_LAYOUT.BOTTOM_ROW_OFFSET,
    left: COUNTRY_CARD_LAYOUT.BOTTOM_ROW_OFFSET,
    right: COUNTRY_CARD_LAYOUT.BOTTOM_ROW_OFFSET,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  flagContainer: {
    position: 'relative',
  },
  glassBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.25)', // Fallback / Boost
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.6)',
  },
  flagEmoji: {
    fontSize: 24,
  },
  tripsIndicator: {
    position: 'absolute',
    bottom: -8,
    right: -10,
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tripsIcon: {
    width: 36,
    height: 36,
    resizeMode: 'contain',
  },
  actionsContainer: {
    flexDirection: 'column',
    gap: COUNTRY_CARD_LAYOUT.ACTION_BUTTON_GAP,
  },
  actionButton: {
    width: COUNTRY_CARD_LAYOUT.ACTION_BUTTON_SIZE,
    height: COUNTRY_CARD_LAYOUT.ACTION_BUTTON_SIZE,
    borderRadius: COUNTRY_CARD_LAYOUT.ACTION_BUTTON_SIZE / 2,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.6)',
  },
  actionButtonVisited: {
    backgroundColor: colors.successDark, // Override for active state
    borderColor: colors.successDark,
  },
  actionButtonWishlisted: {
    backgroundColor: colors.wishlistGold, // Override for active state
    borderColor: colors.wishlistGold,
  },
  visitedBorderOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: COUNTRY_CARD_LAYOUT.BORDER_RADIUS,
    borderWidth: 2.5,
    borderColor: 'rgba(255, 198, 54, 0.55)', // sunsetGold at ~55% — soft warm glow
  },
  airplaneIconRotated: {
    transform: [{ rotate: '-35deg' }],
  },
  textContainer: {
    gap: 0,
  },
  countryName: {
    fontFamily: fonts.oswald.bold,
    fontSize: 16,
    color: colors.textPrimary,
    lineHeight: 20,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    textShadowColor: 'rgba(255, 255, 255, 0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  countryNameSmall: {
    fontSize: 14,
    lineHeight: 18,
  },
  regionName: {
    fontFamily: fonts.openSans.regular,
    fontSize: 12,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 2,
  },
});
