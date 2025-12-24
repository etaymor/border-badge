import { Text as RNText, TextProps as RNTextProps, StyleSheet } from 'react-native';

import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { useResponsive } from '@hooks/useResponsive';

type TextVariant = 'title' | 'subtitle' | 'body' | 'label' | 'caption' | 'accent' | 'heading';

interface TextProps extends RNTextProps {
  variant?: TextVariant;
  /** Set to false to disable automatic responsive sizing */
  responsive?: boolean;
}

export function Text({ variant = 'body', style, responsive = true, ...props }: TextProps) {
  const { isSmallScreen } = useResponsive();

  // Apply small screen styles automatically for responsive text
  const smallStyle = responsive && isSmallScreen ? smallStyles[variant] : undefined;

  return <RNText style={[styles.base, styles[variant], smallStyle, style]} {...props} />;
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
    letterSpacing: -0.5,
  },
  subtitle: {
    fontFamily: fonts.playfair.regular,
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
    lineHeight: 24,
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

// Small screen overrides - only fontSize and lineHeight adjustments
const smallStyles = StyleSheet.create({
  title: {
    fontSize: 24,
    lineHeight: 30,
  },
  subtitle: {
    fontSize: 18,
    lineHeight: 24,
  },
  heading: {
    fontSize: 16,
    lineHeight: 22,
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
  },
  label: {
    fontSize: 13,
    lineHeight: 18,
  },
  caption: {
    fontSize: 11,
    lineHeight: 14,
  },
  accent: {
    fontSize: 20,
  },
});
