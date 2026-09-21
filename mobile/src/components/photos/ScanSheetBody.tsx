/**
 * Shared scan-sheet body (section 3.4): one title, one counter with a thin
 * gold bar, one rotating status line, and — on a first scan only — one
 * action row. Both doors render this under the stage card so the only
 * difference left is the title and the door's own header.
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';

import { RotatingStatusLine } from '@components/photos/RotatingStatusLine';
import { Button } from '@components/ui/Button';
import { colors, withAlpha } from '@constants/colors';
import { fonts } from '@constants/typography';

const STATUS_FIRST_HOLD_MS = 6000;
const STATUS_HOLD_MS = 4000;

interface ScanSheetBodyProps {
  title: string;
  current: number;
  total: number;
  /** 0–1 fill of the thin gold bar. */
  barFraction: number;
  lines: readonly string[];
  reduceMotion: boolean;
  showActions: boolean;
  onLeave: () => void;
  onStop: () => void;
  leaveTestID?: string;
  stopTestID?: string;
}

export function ScanSheetBody({
  title,
  current,
  total,
  barFraction,
  lines,
  reduceMotion,
  showActions,
  onLeave,
  onStop,
  leaveTestID = 'quiz-leave-running',
  stopTestID = 'quiz-cancel',
}: ScanSheetBodyProps) {
  const fraction = Math.min(1, Math.max(0, barFraction));

  return (
    <View style={styles.body}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.counter} testID="quiz-found-counter">
        {current.toLocaleString()}
        <Text style={styles.counterOf}> of </Text>
        {total.toLocaleString()}
      </Text>
      <View
        style={styles.barTrack}
        testID="quiz-progress-track"
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: Math.round(fraction * 100) }}
      >
        <View style={[styles.barFill, { width: `${fraction * 100}%` }]} />
      </View>
      <RotatingStatusLine
        lines={lines}
        firstHoldMs={STATUS_FIRST_HOLD_MS}
        holdMs={STATUS_HOLD_MS}
        reduceMotion={reduceMotion}
      />
      {showActions ? (
        <View style={styles.actions}>
          <Button
            testID={leaveTestID}
            title="Leave It Running"
            variant="ghost"
            onPress={onLeave}
            style={styles.leave}
          />
          <Pressable
            testID={stopTestID}
            onPress={onStop}
            accessibilityRole="button"
            hitSlop={8}
            style={styles.stop}
          >
            <Text style={styles.stopLabel}>Stop</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    alignItems: 'center',
    gap: 14,
    paddingTop: 8,
  },
  title: {
    fontFamily: fonts.playfair.regular,
    fontSize: 26,
    lineHeight: 32,
    color: colors.midnightNavy,
    textAlign: 'center',
  },
  counter: {
    fontFamily: fonts.playfair.bold,
    fontSize: 40,
    lineHeight: 48,
    color: colors.midnightNavy,
  },
  counterOf: {
    fontFamily: fonts.body.regular,
    fontSize: 16,
    color: colors.stormGray,
  },
  barTrack: {
    width: '100%',
    height: 3,
    borderRadius: 2,
    backgroundColor: withAlpha(colors.midnightNavy, 0.08),
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    backgroundColor: colors.sunsetGold,
  },
  actions: {
    alignItems: 'center',
    gap: 4,
    marginTop: 8,
  },
  leave: {
    minHeight: 44,
    paddingVertical: 8,
  },
  stop: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  stopLabel: {
    fontFamily: fonts.body.semiBold,
    fontSize: 15,
    color: colors.stormGray,
  },
});
