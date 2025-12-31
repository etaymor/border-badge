import { useEffect, useMemo, useRef } from 'react';
import { Animated, Pressable, StyleSheet, ViewStyle } from 'react-native';

import { colors } from '@constants/colors';
import { useResponsive } from '@hooks/useResponsive';
import { useAnimatedPress } from '@hooks/useAnimatedPress';
import { Text } from './Text';

// Curated color palette for selected chips - brand-aligned colors
const CHIP_COLORS = [
  colors.mossGreen, // #547A5F - green
  colors.dustyCoral, // #F39B8B - coral/pink
  colors.adobeBrick, // #C1543E - terracotta/red
  '#5B8A72', // Sage green variant
  '#E8A87C', // Peach
  '#7B9E89', // Muted teal-green
  '#D4A574', // Warm tan
  '#8B7355', // Earthy brown
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

  // Selection state animation (bounce on select, shrink on deselect)
  const selectionScale = useRef(new Animated.Value(1)).current;
  const prevSelectedRef = useRef(selected);

  // Generate a consistent random color based on the label
  // This ensures the same chip always gets the same color
  const chipColor = useMemo(() => {
    let hash = 0;
    for (let i = 0; i < label.length; i++) {
      const char = label.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    const index = Math.abs(hash) % CHIP_COLORS.length;
    return CHIP_COLORS[index];
  }, [label]);

  // Animate selection state changes
  useEffect(() => {
    if (selected !== prevSelectedRef.current) {
      if (selected) {
        // Selection bounce: 1 -> 1.05 -> 1
        Animated.sequence([
          Animated.spring(selectionScale, {
            toValue: 1.05,
            friction: 3,
            tension: 200,
            useNativeDriver: true,
          }),
          Animated.spring(selectionScale, {
            toValue: 1,
            friction: 5,
            tension: 100,
            useNativeDriver: true,
          }),
        ]).start();
      } else {
        // Deselection shrink: 1 -> 0.92 -> 1
        Animated.sequence([
          Animated.spring(selectionScale, {
            toValue: 0.92,
            friction: 4,
            tension: 180,
            useNativeDriver: true,
          }),
          Animated.spring(selectionScale, {
            toValue: 1,
            friction: 5,
            tension: 100,
            useNativeDriver: true,
          }),
        ]).start();
      }
      prevSelectedRef.current = selected;
    }
  }, [selected, selectionScale]);

  // Combine press and selection scales - memoize to avoid recreating animated node
  const combinedScale = useMemo(
    () => Animated.multiply(pressScale, selectionScale),
    [pressScale, selectionScale]
  );

  return (
    <Animated.View style={[{ transform: [{ scale: combinedScale }] }, style]}>
      <Pressable
        style={[
          styles.chip,
          isSmallScreen && styles.chipSmall,
          selected && { backgroundColor: chipColor, borderColor: chipColor },
        ]}
        onPress={onPress}
        onPressIn={pressHandlers.onPressIn}
        onPressOut={pressHandlers.onPressOut}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected }}
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
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.paperBeige,
    backgroundColor: colors.paperBeige,
    marginRight: 10,
    marginBottom: 12,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  chipSmall: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginRight: 8,
    marginBottom: 8,
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
