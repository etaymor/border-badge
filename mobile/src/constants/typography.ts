export const fonts = {
  playfair: {
    regular: 'PlayfairDisplay_400Regular',
    bold: 'PlayfairDisplay_700Bold',
  },
  dawning: {
    regular: 'DawningofaNewDay_400Regular',
  },
  openSans: {
    regular: 'OpenSans_400Regular',
    semiBold: 'OpenSans_600SemiBold',
    bold: 'OpenSans_700Bold',
  },
  oswald: {
    medium: 'Oswald_500Medium',
    bold: 'Oswald_700Bold',
  },
} as const;

/**
 * Responsive typography sizes for different screen sizes.
 * Use with useResponsive() hook:
 *
 * @example
 * const { isSmallScreen } = useResponsive();
 * const sizes = isSmallScreen ? fontSizes.small : fontSizes.default;
 */
export const fontSizes = {
  default: {
    title: 32,
    titleLineHeight: 40,
    heading: 28,
    headingLineHeight: 36,
    body: 16,
    bodyLineHeight: 24,
    label: 14,
    caption: 12,
  },
  small: {
    title: 26,
    titleLineHeight: 32,
    heading: 22,
    headingLineHeight: 28,
    body: 14,
    bodyLineHeight: 20,
    label: 13,
    caption: 11,
  },
} as const;

/**
 * Responsive spacing values for different screen sizes.
 *
 * @example
 * const { isSmallScreen } = useResponsive();
 * const space = isSmallScreen ? spacing.small : spacing.default;
 */
export const spacing = {
  default: {
    headerMargin: 32,
    sectionMargin: 24,
    contentPadding: 24,
    elementGap: 16,
  },
  small: {
    headerMargin: 16,
    sectionMargin: 16,
    contentPadding: 20,
    elementGap: 12,
  },
} as const;
