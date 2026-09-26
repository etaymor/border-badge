import { Ionicons } from '@expo/vector-icons';
import { useEffect } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Animated, {
  Easing,
  Extrapolation,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';

const CONTINUE_LABEL = 'Continue';
const FINAL_LABEL = 'Start my journey';
const LABEL_SHIFT = 6;
const BLOOM_SCALE = 1.04;
const BLOOM_UP_MS = 140;
/** A real overshoot (the shared "bouncy" config is overdamped). */
const BLOOM_SPRING = { damping: 11, stiffness: 240, mass: 1 };

interface IntroCtaProps {
  scrollX: SharedValue<number>;
  pageWidth: number;
  count: number;
  /** The settled page is the last one. */
  isLast: boolean;
  reduceMotion: boolean;
  onPress: () => void;
}

/**
 * The gold pill. Fixed width, so it never jumps; the two labels cross-fade with
 * the scroll into the last page, then the pill blooms once when it settles.
 */
export default function IntroCta({
  scrollX,
  pageWidth,
  count,
  isLast,
  reduceMotion,
  onPress,
}: IntroCtaProps) {
  const bloom = useSharedValue(1);

  useEffect(() => {
    if (!isLast || reduceMotion) {
      cancelAnimation(bloom);
      bloom.value = 1;
      return;
    }
    bloom.value = withSequence(
      withTiming(BLOOM_SCALE, { duration: BLOOM_UP_MS, easing: Easing.out(Easing.cubic) }),
      withSpring(1, BLOOM_SPRING)
    );
    return () => cancelAnimation(bloom);
  }, [bloom, isLast, reduceMotion]);

  const pillStyle = useAnimatedStyle(() => ({ transform: [{ scale: bloom.value }] }));

  const continueStyle = useAnimatedStyle(() => {
    const last = interpolate(
      scrollX.value,
      [(count - 2) * pageWidth, (count - 1) * pageWidth],
      [0, 1],
      Extrapolation.CLAMP
    );
    return {
      opacity: 1 - last,
      transform: [{ translateY: reduceMotion ? 0 : -LABEL_SHIFT * last }],
    };
  });

  const finalStyle = useAnimatedStyle(() => {
    const last = interpolate(
      scrollX.value,
      [(count - 2) * pageWidth, (count - 1) * pageWidth],
      [0, 1],
      Extrapolation.CLAMP
    );
    return {
      opacity: last,
      transform: [{ translateY: reduceMotion ? 0 : LABEL_SHIFT * (1 - last) }],
    };
  });

  return (
    <Animated.View style={pillStyle}>
      <TouchableOpacity
        style={styles.pill}
        onPress={onPress}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={isLast ? FINAL_LABEL : CONTINUE_LABEL}
        testID="start-journey-button"
      >
        <View
          style={styles.labelBox}
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
        >
          <Animated.View style={[styles.labelRow, continueStyle]}>
            <Text style={styles.label}>{CONTINUE_LABEL}</Text>
            <Ionicons name="arrow-forward" size={20} color={colors.midnightNavy} />
          </Animated.View>
          <Animated.View style={[styles.labelRow, finalStyle]}>
            <Text style={styles.label}>{FINAL_LABEL}</Text>
          </Animated.View>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  pill: {
    backgroundColor: colors.sunsetGold,
    height: 56,
    minWidth: 260,
    paddingHorizontal: 48,
    borderRadius: 9999,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  // Both labels share one fixed box so the longer one never clips or wraps.
  labelBox: {
    width: 164,
    height: 24,
  },
  labelRow: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  label: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 16,
    color: colors.midnightNavy,
  },
});
