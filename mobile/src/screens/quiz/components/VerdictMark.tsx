/**
 * VerdictMark - a small corner verdict badge for photo thumbnails: a gold
 * check (correct) or terracotta X (incorrect) on a solid navy chip so the
 * mark reads over any photo. Glyph-based (same approach as the existing
 * checkmarks in CountryGridItem / SearchInput) - no icon libraries.
 */

import { StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';

export type Verdict = 'correct' | 'incorrect';

interface VerdictMarkProps {
  verdict: Verdict;
  /** Chip diameter in points. */
  size?: number;
  style?: ViewStyle;
  testID?: string;
}

const VERDICT_GLYPHS: Record<Verdict, string> = {
  correct: '✓',
  incorrect: '✕',
};

const VERDICT_COLORS: Record<Verdict, string> = {
  correct: colors.sunsetGold,
  incorrect: colors.adobeBrick,
};

const VERDICT_LABELS: Record<Verdict, string> = {
  correct: 'Correct',
  incorrect: 'Incorrect',
};

export function VerdictMark({ verdict, size = 20, style, testID }: VerdictMarkProps) {
  return (
    <View
      style={[styles.chip, { width: size, height: size, borderRadius: size / 2 }, style]}
      accessibilityLabel={VERDICT_LABELS[verdict]}
      testID={testID}
    >
      <Text
        style={[styles.glyph, { fontSize: size * 0.6, color: VERDICT_COLORS[verdict] }]}
        allowFontScaling={false}
      >
        {VERDICT_GLYPHS[verdict]}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    backgroundColor: colors.midnightNavy,
    borderWidth: 1,
    borderColor: colors.cloudWhite,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyph: {
    fontFamily: fonts.body.bold,
  },
});
