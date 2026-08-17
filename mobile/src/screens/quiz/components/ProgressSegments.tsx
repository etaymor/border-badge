/**
 * ProgressSegments - the play screen's tracker: an optional letter-spaced
 * `3 OF 10` label over one thin segment per question. Filled segments are
 * gold; the fill animates in as answers land so progress reads as motion,
 * not a hard swap (Q8/Q9: this is the only in-run progress signal - no
 * per-question verdict is shown). Renders any question count gracefully.
 */

import { StyleSheet, Text, View, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useEffect } from 'react';

import { colors, withAlpha } from '@constants/colors';
import { fonts } from '@constants/typography';
import { useReducedMotion } from '@hooks/useReducedMotion';

import { DURATION_SLOW } from './motionTokens';

interface SegmentProps {
  filled: boolean;
  reduceMotion: boolean;
}

function Segment({ filled, reduceMotion }: SegmentProps) {
  const progress = useSharedValue(filled ? 1 : 0);

  useEffect(() => {
    progress.value = reduceMotion
      ? filled
        ? 1
        : 0
      : withTiming(filled ? 1 : 0, { duration: DURATION_SLOW });
  }, [filled, progress, reduceMotion]);

  const fillStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
  }));

  return (
    <View style={styles.segment}>
      <Animated.View style={[styles.segmentFill, fillStyle]} />
    </View>
  );
}

interface ProgressSegmentsProps {
  total: number;
  filled: number;
  /** Optional tracker caption above the segments, e.g. `3 OF 10`. */
  label?: string;
  style?: ViewStyle;
  testID?: string;
}

export function ProgressSegments({ total, filled, label, style, testID }: ProgressSegmentsProps) {
  const reduceMotion = useReducedMotion();
  return (
    <View style={[styles.container, style]} testID={testID}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View
        style={styles.row}
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: total, now: filled }}
      >
        {Array.from({ length: total }, (_, index) => (
          <Segment key={index} filled={index < filled} reduceMotion={reduceMotion} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    minHeight: 24,
    justifyContent: 'center',
    gap: 6,
  },
  label: {
    fontFamily: fonts.body.bold,
    fontSize: 12,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: withAlpha(colors.warmCream, 0.92),
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    gap: 5,
  },
  segment: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: withAlpha(colors.warmCream, 0.35),
    overflow: 'hidden',
  },
  segmentFill: {
    flex: 1,
    borderRadius: 2,
    backgroundColor: colors.sunsetGold,
  },
});
