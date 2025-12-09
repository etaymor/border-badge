import { Text as RNText, TextProps as RNTextProps, StyleSheet } from 'react-native';

import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';

type TextVariant = 'title' | 'subtitle' | 'body' | 'label' | 'caption' | 'accent' | 'heading';

interface TextProps extends RNTextProps {
  variant?: TextVariant;
}

export function Text({ variant = 'body', style, ...props }: TextProps) {
  return <RNText style={[styles.base, styles[variant], style]} {...props} />;
}

const styles = StyleSheet.create({
  base: {
    color: colors.textPrimary,
    fontFamily: fonts.openSans.regular,
  },
  title: {
    fontFamily: fonts.playfair.bold,
    fontSize: 28,
    lineHeight: 34,
    color: colors.midnightNavy,
    letterSpacing: -0.5, // -1% roughly
  },
  subtitle: {
    fontFamily: fonts.playfair.regular, // or bold depending on specific usage
    fontSize: 20,
    lineHeight: 26,
    color: colors.midnightNavy,
  },
  heading: {
    fontFamily: fonts.openSans.bold,
    fontSize: 18,
    lineHeight: 24,
    color: colors.textPrimary,
  },
  body: {
    fontFamily: fonts.openSans.regular,
    fontSize: 16,
    lineHeight: 24, // 1.5x
    color: colors.textPrimary,
  },
  label: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textPrimary,
  },
  caption: {
    fontFamily: fonts.openSans.regular,
    fontSize: 12,
    lineHeight: 16,
    color: colors.textSecondary,
  },
  accent: {
    fontFamily: fonts.dawning.regular,
    fontSize: 24,
    color: colors.adobeBrick,
  },
});
