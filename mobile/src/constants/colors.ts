/**
 * Centralized color palette for the Border Badge app.
 * Use these constants instead of hardcoded hex values throughout the app.
 */

export const colors = {
  // Primary brand colors
  primary: '#007AFF', // iOS Blue - keeping for system consistency where needed
  primaryDark: '#0056B3',

  // Brand Palette
  midnightNavy: '#172A3A', // Backgrounds, headers, dark containers
  warmCream: '#FDF6ED', // Background paper feel, base layer
  sunsetGold: '#F4C24E', // Highlight buttons, call to actions
  adobeBrick: '#C1543E', // Accent, icons, "visited" mark
  lakeBlue: '#A0CDEB', // Sky/illustration tie-in, neutral tint
  mossGreen: '#547A5F', // Secondary accents, tags

  // Secondary Brand Colors
  paperBeige: '#F5ECE0', // Card backgrounds
  dustyCoral: '#F39B8B', // Badge variants, hover states
  stormGray: '#666D7A', // Secondary text
  cloudWhite: '#FFFFFF', // Text on dark backgrounds

  // Semantic colors - Mapped to Brand Palette where appropriate
  success: '#547A5F', // Moss Green
  successDark: '#2E7D32',
  warning: '#F4C24E', // Sunset Gold
  error: '#C1543E', // Adobe Brick

  // Wishlist colors
  wishlistGold: '#F4C24E', // Sunset Gold
  wishlistBrown: '#B8860B',

  // Text colors
  textPrimary: '#172A3A', // Midnight Navy
  textSecondary: '#666D7A', // Storm Gray
  textTertiary: '#999',
  textLight: '#FDF6ED', // Warm Cream

  // Background colors
  background: '#FDF6ED', // Warm Cream
  backgroundCard: '#F5ECE0', // Paper Beige
  backgroundSecondary: '#E5E5EA', // Keep for standard iOS feel elements
  backgroundTertiary: '#F2F2F7',
  backgroundPlaceholder: '#D1D1D6',
  backgroundMuted: '#f5f5f5',

  // Border/separator colors
  border: '#E5E5EA',
  separator: '#C7C7CC',

  // Entry type colors
  entryPlace: '#007AFF',
  entryFood: '#F4C24E', // Sunset Gold
  entryStay: '#5856D6',
  entryExperience: '#547A5F', // Moss Green

  // Shadow colors
  shadow: '#172A3A', // Midnight Navy based shadow

  // Overlay colors
  overlayDark: 'rgba(23, 42, 58, 0.95)', // Midnight Navy
  overlayMedium: 'rgba(23, 42, 58, 0.6)',
  overlayLight: 'rgba(253, 246, 237, 0.85)', // Warm Cream
  overlaySubtle: 'rgba(255, 255, 255, 0.2)',

  // Basic
  transparent: 'transparent',
  white: '#fff',
  black: '#000',
} as const;

// Type for accessing colors
export type ColorKey = keyof typeof colors;
export type ColorValue = (typeof colors)[ColorKey];
