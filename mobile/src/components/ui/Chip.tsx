import { useMemo, useRef } from 'react';
import { Animated, Pressable, StyleSheet, ViewStyle } from 'react-native';

import { colors } from '@constants/colors';
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
  const scaleAnim = useRef(new Animated.Value(1)).current;

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

  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.95,
      useNativeDriver: true,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      friction: 3,
      tension: 40,
      useNativeDriver: true,
    }).start();
  };

  return (
    <Animated.View style={[{ transform: [{ scale: scaleAnim }] }, style]}>
      <Pressable
        style={[styles.chip, selected && { backgroundColor: chipColor, borderColor: chipColor }]}
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
      >
        <Text variant="label" style={[styles.chipText, selected && styles.chipTextSelected]}>
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
  chipText: {
    color: colors.textPrimary,
  },
  chipTextSelected: {
    color: colors.white,
  },
});
