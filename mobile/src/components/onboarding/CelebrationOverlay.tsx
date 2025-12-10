import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

import { Text } from '@components/ui';
import { colors } from '@constants/colors';
import type { CelebrationAnimationRefs } from '@hooks/useCountrySelectionAnimations';

export interface CelebrationBadgeConfig {
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  iconSize?: number;
  text: string;
  textColor: string;
}

export interface CelebrationOverlayProps {
  visible: boolean;
  flagEmoji: string;
  countryName: string;
  badge: CelebrationBadgeConfig;
  showStars?: boolean;
  animationRefs: CelebrationAnimationRefs;
}

export default function CelebrationOverlay({
  visible,
  flagEmoji,
  countryName,
  badge,
  showStars = false,
  animationRefs,
}: CelebrationOverlayProps) {
  const {
    selectionScale,
    selectionOpacity,
    flagScale,
    flagRotate,
    checkmarkScale,
    checkmarkOpacity,
    confettiOpacity,
    starScale,
  } = animationRefs;

  // Memoize interpolation to prevent recreation on every render (Issue #8)
  // Must be called before early return to satisfy rules of hooks
  const flagRotateInterpolation = useMemo(
    () =>
      flagRotate.interpolate({
        inputRange: [0, 1],
        outputRange: ['-10deg', '0deg'],
      }),
    [flagRotate]
  );

  if (!visible) return null;

  return (
    <Animated.View
      style={[
        styles.celebrationOverlay,
        {
          opacity: selectionOpacity,
        },
      ]}
    >
      <Animated.View
        style={[
          styles.celebrationContent,
          {
            transform: [{ scale: selectionScale }],
          },
        ]}
      >
        {/* Confetti-like decorative elements */}
        <Animated.View style={[styles.confettiContainer, { opacity: confettiOpacity }]}>
          <View style={[styles.confettiDot, styles.confetti1]} />
          <View style={[styles.confettiDot, styles.confetti2]} />
          <View style={[styles.confettiDot, styles.confetti3]} />
          <View style={[styles.confettiDot, styles.confetti4]} />
          <View style={[styles.confettiDot, styles.confetti5]} />
          <View style={[styles.confettiDot, styles.confetti6]} />
        </Animated.View>

        {/* Stars around the flag (optional) */}
        {showStars && (
          <Animated.View
            style={[
              styles.starsContainer,
              {
                opacity: confettiOpacity,
                transform: [{ scale: starScale }],
              },
            ]}
          >
            <Ionicons name="star" size={24} color={colors.sunsetGold} style={styles.star1} />
            <Ionicons name="star" size={16} color={colors.sunsetGold} style={styles.star2} />
            <Ionicons name="star" size={20} color={colors.sunsetGold} style={styles.star3} />
          </Animated.View>
        )}

        {/* Flag with bounce */}
        <Animated.View
          style={[
            styles.celebrationFlag,
            {
              transform: [{ scale: flagScale }, { rotate: flagRotateInterpolation }],
            },
          ]}
        >
          <Text style={styles.celebrationFlagText}>{flagEmoji}</Text>
        </Animated.View>

        {/* Country name */}
        <Text variant="title" style={styles.celebrationCountryName}>
          {countryName}
        </Text>

        {/* Badge */}
        <Animated.View
          style={[
            styles.checkmarkBadge,
            {
              opacity: checkmarkOpacity,
              transform: [{ scale: checkmarkScale }],
            },
          ]}
        >
          <Ionicons name={badge.icon} size={badge.iconSize ?? 32} color={badge.iconColor} />
          <Text variant="label" style={[styles.checkmarkText, { color: badge.textColor }]}>
            {badge.text}
          </Text>
        </Animated.View>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  celebrationOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(23, 42, 58, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 100,
  },
  celebrationContent: {
    alignItems: 'center',
    padding: 40,
  },
  confettiContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  confettiDot: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  confetti1: {
    backgroundColor: colors.sunsetGold,
    top: -40,
    left: 20,
  },
  confetti2: {
    backgroundColor: colors.dustyCoral,
    top: -20,
    right: 30,
  },
  confetti3: {
    backgroundColor: colors.mossGreen,
    bottom: -30,
    left: 40,
  },
  confetti4: {
    backgroundColor: colors.lakeBlue,
    bottom: -20,
    right: 20,
  },
  confetti5: {
    backgroundColor: colors.adobeBrick,
    top: 20,
    left: -20,
  },
  confetti6: {
    backgroundColor: colors.warmCream,
    top: 30,
    right: -10,
  },
  starsContainer: {
    position: 'absolute',
    width: 200,
    height: 200,
    justifyContent: 'center',
    alignItems: 'center',
  },
  star1: {
    position: 'absolute',
    top: 10,
    right: 20,
  },
  star2: {
    position: 'absolute',
    top: 50,
    left: 10,
  },
  star3: {
    position: 'absolute',
    bottom: 30,
    right: 30,
  },
  celebrationFlag: {
    marginBottom: 16,
  },
  celebrationFlagText: {
    fontSize: 80,
  },
  celebrationCountryName: {
    fontSize: 28,
    color: colors.white,
    marginBottom: 20,
    textAlign: 'center',
  },
  checkmarkBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.warmCream,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 30,
    gap: 8,
  },
  checkmarkText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
