/**
 * ProgressSegments - the play screen's tracker: an optional letter-spaced
 * `3 OF 10` label over one thin segment per question. The track is a compact
 * centred bar under the caption (not a full-width strip), so it stays
 * optically centred when the play screen absolutely-positions this component
 * over the back button. Filled segments are gold; the fill animates in as
 * answers land so progress reads as motion, not a hard swap (Q8/Q9: this is
 * the only in-run progress signal - no per-question verdict is shown).
 * Renders any question count gracefully.
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
    <View style={[styles.container, style]} pointerEvents="none" testID={testID}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View
        style={styles.row}
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: total, now: filled }}
        testID={testID ? `${testID}-track` : undefined}
      >
        {Array.from({ length: total }, (_, index) => (
          <Segment key={index} filled={index < filled} reduceMotion={reduceMotion} />
        ))}
      </View>
    </View>
  );
}

/** Compact enough to sit under `N OF N`, not stretch into the back button. */
export const PROGRESS_TRACK_MAX_WIDTH = 168;

const styles = StyleSheet.create({
  container: {
    minHeight: 24,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
  },
  label: {
    fontFamily: fonts.body.bold,
    fontSize: 12,
    letterSpacing: 1.5,
    // RN letterSpacing trails the last glyph; pull it back so the caption
    // optically matches the centred track underneath.
    marginRight: -1.5,
    textTransform: 'uppercase',
    color: withAlpha(colors.warmCream, 0.92),
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    alignSelf: 'center',
    width: '100%',
    maxWidth: PROGRESS_TRACK_MAX_WIDTH,
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
