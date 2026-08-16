/**
 * GuessOption - an answer choice layered over the full-bleed photo on the
 * play screen (Q6). Dark glass keeps arbitrary photos legible behind it; the
 * selected state is a gold ring - a neutral acknowledgment, never a verdict
 * (Q8: right/wrong is only revealed at the end).
 */

import { useEffect } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { useReducedMotion } from '@hooks/useReducedMotion';

interface GuessOptionProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /** Gold-ring acknowledgment on the tapped option (no verdict). */
  selected?: boolean;
  /** Pulse while the answer is in flight. */
  loading?: boolean;
  /** Staggered entrance offset (ms); options deal in one after another. */
  entranceDelay?: number;
  style?: ViewStyle;
  testID?: string;
}

export function GuessOption({
  label,
  onPress,
  disabled,
  selected,
  loading,
  entranceDelay = 0,
  style,
  testID,
}: GuessOptionProps) {
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(1);
  const entrance = useSharedValue(reduceMotion ? 1 : 0);

  useEffect(() => {
    entrance.value = reduceMotion
      ? 1
      : withDelay(
          entranceDelay,
          withTiming(1, { duration: 300, easing: Easing.out(Easing.cubic) })
        );
  }, [entrance, entranceDelay, reduceMotion]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: entrance.value,
    transform: [
      { translateY: interpolate(entrance.value, [0, 1], [16, 0]) },
      { scale: scale.value },
    ],
  }));

  const handlePressIn = () => {
    if (reduceMotion) return;
    scale.value = withSpring(0.97, { damping: 15, stiffness: 400 });
  };

  const handlePressOut = () => {
    if (reduceMotion) return;
    scale.value = withSpring(1, { damping: 15, stiffness: 400 });
  };

  return (
    <Animated.View style={[animatedStyle, style]}>
      <Pressable
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityState={{ disabled: !!disabled, selected: !!selected }}
        testID={testID}
        style={[styles.option, selected && styles.optionSelected]}
      >
        {loading ? (
          <ActivityIndicator size="small" color={colors.sunsetGold} />
        ) : (
          <Text style={styles.label} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.8}>
            {label}
          </Text>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  option: {
    minHeight: 56,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(23, 42, 58, 0.55)',
    borderWidth: 1.5,
    borderColor: 'rgba(253, 246, 237, 0.35)',
  },
  optionSelected: {
    borderColor: colors.sunsetGold,
    borderWidth: 2,
    backgroundColor: 'rgba(23, 42, 58, 0.75)',
  },
  label: {
    fontFamily: fonts.body.semiBold,
    fontSize: 16,
    color: colors.textLight,
    textAlign: 'center',
  },
});
