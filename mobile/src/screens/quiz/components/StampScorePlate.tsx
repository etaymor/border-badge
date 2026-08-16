/**
 * StampScorePlate - the score as a passport-stamp plate: rotated, bordered in
 * adobe brick, numerals in Oswald. `animateIn` plays the stamp press (scales
 * down from above the surface and lands with a spring) - the single payoff
 * moment the whole game builds to (Q8/Q9). The caller owns the haptic.
 */

import { useEffect } from 'react';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
} from 'react-native-reanimated';

import { colors, withAlpha } from '@constants/colors';
import { fonts } from '@constants/typography';
import { useReducedMotion } from '@hooks/useReducedMotion';

interface StampScorePlateProps {
  score: number;
  total: number;
  /** Uppercase eyebrow above the numerals, e.g. "SCORE TO BEAT". */
  label?: string;
  /** Play the stamp-press entrance (once, on mount). */
  animateIn?: boolean;
  /** Delay before the press lands (ms). */
  animateInDelay?: number;
  size?: 'large' | 'small';
  style?: ViewStyle;
  testID?: string;
}

export function StampScorePlate({
  score,
  total,
  label,
  animateIn = false,
  animateInDelay = 0,
  size = 'large',
  style,
  testID,
}: StampScorePlateProps) {
  const reduceMotion = useReducedMotion();
  const skipAnimation = !animateIn || reduceMotion;
  const press = useSharedValue(skipAnimation ? 1 : 0);

  useEffect(() => {
    if (skipAnimation) {
      press.value = 1;
      return;
    }
    press.value = withDelay(animateInDelay, withSpring(1, { damping: 14, stiffness: 260 }));
  }, [animateInDelay, press, skipAnimation]);

  const pressStyle = useAnimatedStyle(() => ({
    opacity: interpolate(press.value, [0, 0.3, 1], [0, 1, 1]),
    transform: [{ rotate: '-2deg' }, { scale: interpolate(press.value, [0, 1], [1.9, 1]) }],
  }));

  const small = size === 'small';
  return (
    <Animated.View
      style={[styles.plate, small && styles.plateSmall, pressStyle, style]}
      testID={testID}
    >
      {label ? <Text style={[styles.label, small && styles.labelSmall]}>{label}</Text> : null}
      <View style={styles.scoreRow}>
        <Text style={[styles.score, small && styles.scoreSmall]}>{score}</Text>
        <Text style={[styles.total, small && styles.totalSmall]}>/{total}</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  plate: {
    alignSelf: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: withAlpha(colors.adobeBrick, 0.85),
    borderRadius: 20,
    paddingVertical: 18,
    paddingHorizontal: 32,
  },
  plateSmall: {
    borderWidth: 2,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  label: {
    fontFamily: fonts.body.bold,
    fontSize: 12,
    letterSpacing: 2,
    color: colors.adobeBrick,
    marginBottom: 2,
  },
  labelSmall: {
    fontSize: 10,
    letterSpacing: 1.5,
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  score: {
    fontFamily: fonts.oswald.bold,
    fontSize: 84,
    lineHeight: 92,
    color: colors.adobeBrick,
  },
  scoreSmall: {
    fontSize: 40,
    lineHeight: 46,
  },
  total: {
    fontFamily: fonts.oswald.medium,
    fontSize: 36,
    color: withAlpha(colors.adobeBrick, 0.75),
  },
  totalSmall: {
    fontSize: 20,
  },
});
