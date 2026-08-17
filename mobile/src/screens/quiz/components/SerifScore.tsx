/**
 * SerifScore - the score as an editorial serif lockup, e.g. "8 / 10": Playfair
 * Display numerals with a lighter, smaller separator. Static by design (no
 * count-up); the large size is the results hero, the small size acknowledges
 * the demo score on the intro. Defaults to warm cream for over-photo use.
 */

import { StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { colors, withAlpha } from '@constants/colors';
import { fonts } from '@constants/typography';

interface SerifScoreProps {
  score: number;
  total: number;
  size?: 'small' | 'large';
  /** Numeral color; defaults to warm cream for use over photo scrims. */
  color?: string;
  style?: ViewStyle;
  testID?: string;
}

export function SerifScore({
  score,
  total,
  size = 'large',
  color = colors.warmCream,
  style,
  testID,
}: SerifScoreProps) {
  const small = size === 'small';
  return (
    <View style={[styles.row, style]} testID={testID}>
      <Text style={[styles.numeral, small && styles.numeralSmall, { color }]}>{score}</Text>
      <Text
        style={[styles.separator, small && styles.separatorSmall, { color: withAlpha(color, 0.6) }]}
      >
        {' / '}
      </Text>
      <Text style={[styles.numeral, small && styles.numeralSmall, { color }]}>{total}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  numeral: {
    fontFamily: fonts.playfair.bold,
    fontSize: 80,
    lineHeight: 92,
  },
  numeralSmall: {
    fontSize: 34,
    lineHeight: 40,
  },
  separator: {
    fontFamily: fonts.playfair.regular,
    fontSize: 44,
    lineHeight: 92,
  },
  separatorSmall: {
    fontSize: 20,
    lineHeight: 40,
  },
});
