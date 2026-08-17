import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  GestureResponderEvent,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';

import { colors } from '@constants/colors';
import { useAnimatedPress, AnimatedPressPresets } from '@hooks/useAnimatedPress';
import { useBreathingAnimation, BreathingPresets } from '@hooks/useBreathingAnimation';
import { getFlagEmoji } from '@utils/flags';

interface CountryGridItemProps {
  code: string;
  name: string;
  isSelected: boolean;
  isWishlisted: boolean;
  onToggleVisited: () => void;
  onToggleWishlist: () => void;
}

// Custom comparison to prevent re-renders from new function references
function arePropsEqual(prevProps: CountryGridItemProps, nextProps: CountryGridItemProps): boolean {
  return (
    prevProps.code === nextProps.code &&
    prevProps.name === nextProps.name &&
    prevProps.isSelected === nextProps.isSelected &&
    prevProps.isWishlisted === nextProps.isWishlisted
  );
  // Intentionally ignore function props - they should be stable via useCallback in parent
}

export const CountryGridItem = React.memo(function CountryGridItem({
  code,
  name,
  isSelected,
  isWishlisted,
  onToggleVisited,
  onToggleWishlist,
}: CountryGridItemProps) {
  // Memoize flag emoji calculation
  const flagEmoji = useMemo(() => getFlagEmoji(code), [code]);

  // Press feedback animation
  const { scaleValue: pressScale, pressHandlers } = useAnimatedPress(AnimatedPressPresets.default);

  // Breathing animation for visited countries
  const { breathingScale, startBreathing, stopBreathing } = useBreathingAnimation(
    BreathingPresets.subtle
  );

  // Start/stop breathing based on selection state
  useEffect(() => {
    if (isSelected) {
      startBreathing();
    } else {
      stopBreathing();
    }
  }, [isSelected, startBreathing, stopBreathing]);

  // Combine press and breathing scales - memoize to avoid creating new animated node each render
  const combinedScale = useMemo(
    () => Animated.multiply(pressScale, breathingScale),
    [pressScale, breathingScale]
  );

  // Wishlist star pop animation
  const wishlistScale = useRef(new Animated.Value(1)).current;

  const triggerWishlistPop = useCallback(() => {
    // Quick pop: scale up to 1.4 then back to 1
    Animated.sequence([
      Animated.spring(wishlistScale, {
        toValue: 1.4,
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
    ]).start();
  }, [wishlistScale]);

  // Handle visited toggle with haptic feedback
  const handleToggleVisited = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onToggleVisited();
  }, [onToggleVisited]);

  // Memoize star button press handler with haptic feedback and pop animation
  const handleStarPress = useCallback(
    (e: GestureResponderEvent) => {
      e.stopPropagation?.();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      triggerWishlistPop();
      onToggleWishlist();
    },
    [onToggleWishlist, triggerWishlistPop]
  );

  return (
    <Animated.View style={{ transform: [{ scale: combinedScale }] }}>
      <TouchableOpacity
        style={[styles.container, isSelected && styles.containerSelected]}
        onPress={handleToggleVisited}
        onPressIn={pressHandlers.onPressIn}
        onPressOut={pressHandlers.onPressOut}
        activeOpacity={1}
        accessibilityRole="button"
        accessibilityLabel={`${name}, ${isSelected ? 'visited' : 'not visited'}`}
        accessibilityHint="Double tap to toggle visited status"
        testID={`country-item-${code}`}
      >
        {/* Grey placeholder for country illustration */}
        <View style={styles.illustrationPlaceholder}>
          <Text style={styles.flagEmoji}>{flagEmoji}</Text>
        </View>

        <Text style={styles.countryName} numberOfLines={2}>
          {name}
        </Text>

        {/* Wishlist star button */}
        <Animated.View style={{ transform: [{ scale: wishlistScale }] }}>
          <TouchableOpacity
            style={[styles.starButton, isWishlisted && styles.starButtonActive]}
            onPress={handleStarPress}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel={`${isWishlisted ? 'Remove from' : 'Add to'} wishlist`}
            testID={`country-wishlist-${code}`}
          >
            <Text style={styles.starIcon}>{isWishlisted ? '★' : '☆'}</Text>
          </TouchableOpacity>
        </Animated.View>

        {/* Selected checkmark */}
        {isSelected && (
          <View style={styles.checkmark}>
            <Text style={styles.checkmarkText}>✓</Text>
          </View>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
}, arePropsEqual);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    margin: 4,
    backgroundColor: '#F2F2F7',
    borderRadius: 20,
    padding: 12,
    alignItems: 'center',
    minHeight: 120,
    position: 'relative',
    borderWidth: 2,
    borderColor: 'transparent',
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  containerSelected: {
    borderColor: '#007AFF',
    backgroundColor: '#E8F4FF',
  },
  illustrationPlaceholder: {
    width: 60,
    height: 60,
    backgroundColor: '#E5E5EA',
    borderRadius: 8,
    marginBottom: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  flagEmoji: {
    fontSize: 28,
  },
  countryName: {
    fontSize: 12,
    fontWeight: '500',
    color: '#1a1a1a',
    textAlign: 'center',
  },
  starButton: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  starButtonActive: {
    backgroundColor: '#FFD700',
  },
  starIcon: {
    fontSize: 14,
    color: '#666',
  },
  checkmark: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkmarkText: {
    fontSize: 12,
    color: '#fff',
    fontWeight: 'bold',
  },
});
