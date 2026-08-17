import { useMemo, useRef, useEffect } from 'react';
import { Animated, Pressable, StyleSheet, ViewStyle } from 'react-native';

import { colors } from '@constants/colors';
import { useResponsive } from '@hooks/useResponsive';
import { useAnimatedPress } from '@hooks/useAnimatedPress';
import { Text } from './Text';

// Expanded color palette for more variety - each with complementary shadow
const CHIP_COLORS = [
  { bg: colors.mossGreen, shadow: '#3D5A46' }, // Deep forest shadow
  { bg: colors.adobeBrick, shadow: '#8E3E2E' }, // Deep terracotta shadow
  { bg: colors.dustyCoral, shadow: '#C47868' }, // Warm coral shadow
  { bg: colors.lakeBlue, shadow: '#6BA3C4' }, // Deep sky shadow
  { bg: '#E8B86D', shadow: '#B8944E' }, // Warm amber with golden shadow
  { bg: '#8B7355', shadow: '#5E4D3A' }, // Warm taupe with earthy shadow
  { bg: '#9CAF88', shadow: '#6E8060' }, // Sage green with forest shadow
  { bg: '#D4A574', shadow: '#A67F58' }, // Warm sand with terracotta shadow
];

interface ChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  style?: ViewStyle;
}

export function Chip({ label, selected, onPress, style }: ChipProps) {
  const { isSmallScreen } = useResponsive();

  // Press feedback animation (0.95 scale on press)
  const { scaleValue: pressScale, pressHandlers } = useAnimatedPress({ pressedScale: 0.95 });

  // Selection animation value
  const colorAnim = useRef(new Animated.Value(selected ? 1 : 0)).current;

  // Generate a consistent color based on the label
  const chipColors = useMemo(() => {
    let hash = 0;
    for (let i = 0; i < label.length; i++) {
      const char = label.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    const index = Math.abs(hash) % CHIP_COLORS.length;
    return CHIP_COLORS[index];
  }, [label]);

  // Track previous selected state for animation
  const prevSelectedRef = useRef(selected);

  useEffect(() => {
    if (selected !== prevSelectedRef.current) {
      Animated.spring(colorAnim, {
        toValue: selected ? 1 : 0,
        friction: 8,
        tension: 120,
        useNativeDriver: false,
      }).start();
      prevSelectedRef.current = selected;
    }
  }, [selected, colorAnim]);

  // Interpolate background color
  const animatedBackgroundColor = colorAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [colors.paperBeige, chipColors.bg],
  });

  // Interpolate shadow color - from neutral to colored
  const animatedShadowColor = colorAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [colors.midnightNavy, chipColors.shadow],
  });

  // Interpolate shadow opacity - slightly stronger when selected
  const animatedShadowOpacity = colorAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.1, 0.35],
  });

  // Subtle border for unselected state
  const animatedBorderColor = colorAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [colors.stormGray + '20', 'transparent'],
  });

  const animatedBorderWidth = colorAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0],
  });

  return (
    <Animated.View style={[{ transform: [{ scale: pressScale }] }, style]}>
      <Pressable
        onPress={onPress}
        onPressIn={pressHandlers.onPressIn}
        onPressOut={pressHandlers.onPressOut}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected }}
      >
        <Animated.View
          style={[
            styles.chip,
            isSmallScreen && styles.chipSmall,
            {
              backgroundColor: animatedBackgroundColor,
              borderColor: animatedBorderColor,
              borderWidth: animatedBorderWidth,
              shadowColor: animatedShadowColor,
              shadowOpacity: animatedShadowOpacity,
            },
          ]}
        >
          <Text
            variant="label"
            style={[
              styles.chipText,
              isSmallScreen && styles.chipTextSmall,
              selected && styles.chipTextSelected,
            ]}
          >
            {label}
          </Text>
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
    backgroundColor: colors.paperBeige,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
    elevation: 4,
  },
  chipSmall: {
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipText: {
    color: colors.textPrimary,
  },
  chipTextSmall: {
    fontSize: 13,
  },
  chipTextSelected: {
    color: colors.white,
  },
});
