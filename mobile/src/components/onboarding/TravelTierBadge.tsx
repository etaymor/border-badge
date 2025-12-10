import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

import { Text } from '@components/ui';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';

const TRAVEL_STATUS_TIERS = [
  { threshold: 5, status: 'Local Wanderer', icon: 'walk-outline' as const },
  { threshold: 15, status: 'Pathfinder', icon: 'compass-outline' as const },
  { threshold: 30, status: 'Border Breaker', icon: 'map-outline' as const },
  { threshold: 50, status: 'Roving Explorer', icon: 'navigate-outline' as const },
  { threshold: 80, status: 'Globe Trotter', icon: 'globe-outline' as const },
  { threshold: 120, status: 'World Seeker', icon: 'planet-outline' as const },
  { threshold: 160, status: 'Continental Master', icon: 'earth-outline' as const },
  { threshold: Infinity, status: 'Global Elite', icon: 'trophy-outline' as const },
];

function getTravelStatus(visitedCount: number) {
  for (const tier of TRAVEL_STATUS_TIERS) {
    if (visitedCount < tier.threshold) {
      return tier;
    }
  }
  return TRAVEL_STATUS_TIERS[TRAVEL_STATUS_TIERS.length - 1];
}

export interface TravelTierBadgeProps {
  visitedCount: number;
  animated?: boolean;
  delay?: number;
}

export default function TravelTierBadge({
  visitedCount,
  animated = false,
  delay = 0,
}: TravelTierBadgeProps) {
  const tier = getTravelStatus(visitedCount);
  const scaleAnim = useRef(new Animated.Value(animated ? 0.8 : 1)).current;
  const opacityAnim = useRef(new Animated.Value(animated ? 0 : 1)).current;

  useEffect(() => {
    if (animated) {
      const timeout = setTimeout(() => {
        Animated.parallel([
          Animated.spring(scaleAnim, {
            toValue: 1,
            friction: 6,
            tension: 100,
            useNativeDriver: true,
          }),
          Animated.timing(opacityAnim, {
            toValue: 1,
            duration: 300,
            useNativeDriver: true,
          }),
        ]).start();
      }, delay);

      return () => clearTimeout(timeout);
    }
  }, [animated, delay, scaleAnim, opacityAnim]);

  return (
    <Animated.View
      style={[
        styles.container,
        {
          opacity: opacityAnim,
          transform: [{ scale: scaleAnim }],
        },
      ]}
    >
      <View style={styles.iconContainer}>
        <Ionicons name={tier.icon} size={16} color={colors.cloudWhite} />
      </View>
      <Text style={styles.statusText}>{tier.status}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.mossGreen,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    gap: 8,
    alignSelf: 'center',
  },
  iconContainer: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  statusText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 14,
    color: colors.cloudWhite,
  },
});
