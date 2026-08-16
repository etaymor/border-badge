/**
 * ProgressSegments - one thin segment per question along the top of the play
 * screen. Filled segments are gold; the fill animates in as answers land so
 * progress reads as motion, not a hard swap (Q8/Q9: this is the only in-run
 * progress signal - no per-question verdict is shown).
 */

import { StyleSheet, View, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useEffect } from 'react';

import { colors } from '@constants/colors';
import { useReducedMotion } from '@hooks/useReducedMotion';

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
      : withTiming(filled ? 1 : 0, { duration: 350 });
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
  style?: ViewStyle;
  testID?: string;
}

export function ProgressSegments({ total, filled, style, testID }: ProgressSegmentsProps) {
  const reduceMotion = useReducedMotion();
  return (
    <View
      style={[styles.row, style]}
      testID={testID}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: total, now: filled }}
    >
      {Array.from({ length: total }, (_, index) => (
        <Segment key={index} filled={index < filled} reduceMotion={reduceMotion} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 5,
  },
  segment: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(253, 246, 237, 0.35)',
    overflow: 'hidden',
  },
  segmentFill: {
    flex: 1,
    borderRadius: 2,
    backgroundColor: colors.sunsetGold,
  },
});
