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
  region,
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

  // Cleanup: stop any running animation and reset value on unmount
  useEffect(() => {
    return () => {
      heartScale.stopAnimation();
      heartScale.setValue(1);
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
      if (!isWishlisted) {
        animateHeartPulse();
      }
      onToggleWishlist();
    },
    [onToggleWishlist, isWishlisted, animateHeartPulse]
  );

  return (
    <TouchableOpacity
      style={[styles.container, style]}
      onPress={onPress}
      activeOpacity={0.9}
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
            style={styles.countryName}
            numberOfLines={2}
            adjustsFontSizeToFit
            minimumFontScale={0.85}
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
        <BlurView intensity={30} tint="light" style={styles.glassBadge}>
          <Text style={styles.flagEmoji}>{flagEmoji}</Text>
        </BlurView>

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
          <Animated.View style={{ transform: [{ scale: heartScale }] }}>
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
                <Ionicons
                  name={isWishlisted ? 'heart' : 'heart-outline'}
                  size={20}
                  color={isWishlisted ? colors.wishlistBrown : colors.textTertiary}
                />
              </BlurView>
            </TouchableOpacity>
          </Animated.View>
        </View>
      </View>
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    borderRadius: 24, // Smoother corners for liquid feel
    overflow: 'hidden',
    backgroundColor: colors.backgroundSecondary,
    aspectRatio: 3 / 4,
    position: 'relative',
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 6,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.4)', // Subtle highlight border
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
    bottom: 12,
    left: 12,
    right: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
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
  actionsContainer: {
    flexDirection: 'column',
    gap: 8,
  },
  actionButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
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
  textContainer: {
    gap: 0,
  },
  countryName: {
    fontFamily: fonts.oswald.bold,
    fontSize: 18,
    color: colors.textPrimary,
    lineHeight: 22,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    textShadowColor: 'rgba(255, 255, 255, 0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
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
