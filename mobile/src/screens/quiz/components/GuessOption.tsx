/**
 * GuessOption - an answer choice layered over the full-bleed photo on the
 * play screen (Q6). A warm-cream card keeps arbitrary photos legible behind
 * it; the tapped option compresses slightly and turns solid midnight navy -
 * a neutral acknowledgment, never a verdict (Q8: right/wrong is only
 * revealed at the end).
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

import { colors, withAlpha } from '@constants/colors';
import { fonts } from '@constants/typography';
import { useReducedMotion } from '@hooks/useReducedMotion';

import { DURATION_BASE, DURATION_FAST } from './motionTokens';

interface GuessOptionProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /** Navy-card acknowledgment on the tapped option (no verdict). */
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
  // Press feedback and the selection compress are independent gestures; kept
  // as separate values so a press-out never undoes the selected 98% state.
  const pressScale = useSharedValue(1);
  const selectScale = useSharedValue(1);
  const entrance = useSharedValue(reduceMotion ? 1 : 0);

  useEffect(() => {
    entrance.value = reduceMotion
      ? 1
      : withDelay(
          entranceDelay,
          withTiming(1, { duration: DURATION_BASE, easing: Easing.out(Easing.cubic) })
        );
  }, [entrance, entranceDelay, reduceMotion]);

  // The acknowledgment must land within the tap's perceptual window
  // (DURATION_FAST). Reduced motion keeps the color swap but skips the
  // spatial compress.
  useEffect(() => {
    selectScale.value = reduceMotion
      ? 1
      : withTiming(selected ? 0.98 : 1, { duration: DURATION_FAST });
  }, [selected, selectScale, reduceMotion]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: entrance.value,
    transform: [
      { translateY: interpolate(entrance.value, [0, 1], [16, 0]) },
      { scale: pressScale.value * selectScale.value },
    ],
  }));

  const handlePressIn = () => {
    if (reduceMotion) return;
    pressScale.value = withSpring(0.97, { damping: 15, stiffness: 400 });
  };

  const handlePressOut = () => {
    if (reduceMotion) return;
    pressScale.value = withSpring(1, { damping: 15, stiffness: 400 });
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
          <Text
            style={[styles.label, selected && styles.labelSelected]}
            numberOfLines={2}
            adjustsFontSizeToFit
            minimumFontScale={0.8}
          >
            {label}
          </Text>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  option: {
    minHeight: 48,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.warmCream,
    // Constant border width so the selected swap never shifts layout; the
    // resting border is invisible against the cream surface.
    borderWidth: 1,
    borderColor: colors.warmCream,
  },
  optionSelected: {
    backgroundColor: colors.midnightNavy,
    borderColor: withAlpha(colors.warmCream, 0.45),
  },
  label: {
    fontFamily: fonts.body.semiBold,
    fontSize: 16,
    color: colors.midnightNavy,
    textAlign: 'center',
  },
  labelSelected: {
    color: colors.warmCream,
  },
});
