/**
 * Centralized color palette for the Border Badge app.
 * Use these constants instead of hardcoded hex values throughout the app.
 */

export const colors = {
  // Primary brand colors
  primary: '#007AFF', // iOS Blue - primary actions, links, active states
  primaryDark: '#0056B3', // Darker shade for hover/press states

  // Semantic colors
  success: '#34C759', // Green - positive actions, success states
  successDark: '#2E7D32', // Dark green - visited button background
  warning: '#FF9500', // Orange - warnings, food entry type
  error: '#FF3B30', // Red - errors, delete actions

  // Wishlist colors
  wishlistGold: '#FFD700', // Gold - wishlisted background
  wishlistBrown: '#B8860B', // Dark gold brown - wishlisted heart icon

  // Text colors
  textPrimary: '#1a1a1a', // Main text
  textSecondary: '#666', // Secondary/muted text
  textTertiary: '#999', // Placeholder text, disabled states
  textLight: '#ccc', // Very light text, icons

  // Background colors
  background: '#F8F9FA', // App background
  backgroundCard: '#fff', // Card/surface background
  backgroundSecondary: '#E5E5EA', // Secondary backgrounds, chips, inputs
  backgroundTertiary: '#F2F2F7', // Subtle backgrounds, flag containers
  backgroundPlaceholder: '#D1D1D6', // Image placeholders
  backgroundMuted: '#f5f5f5', // Very subtle backgrounds

  // Border/separator colors
  border: '#E5E5EA', // Default borders
  separator: '#C7C7CC', // Separators, chevrons

  // Entry type colors (specific to EntryCard)
  entryPlace: '#007AFF', // Blue
  entryFood: '#FF9500', // Orange
  entryStay: '#5856D6', // Purple
  entryExperience: '#34C759', // Green

  // Shadow colors
  shadow: '#000', // Used with opacity

  // Overlay colors (use with rgba)
  overlayDark: 'rgba(0, 0, 0, 0.95)',
  overlayMedium: 'rgba(0, 0, 0, 0.6)',
  overlayLight: 'rgba(255, 255, 255, 0.85)',
  overlaySubtle: 'rgba(255, 255, 255, 0.2)',

  // Transparent
  transparent: 'transparent',
  white: '#fff',
  black: '#000',
} as const;

// Type for accessing colors
export type ColorKey = keyof typeof colors;
export type ColorValue = (typeof colors)[ColorKey];
