import { StyleSheet, Platform } from 'react-native';
import { colors } from './colors';

/**
 * Liquid Glass Design System
 * References: https://developer.apple.com/documentation/TechnologyOverviews/liquid-glass
 */
export const liquidGlass = StyleSheet.create({
  /**
   * Base glass container style
   * - High blur
   * - Semi-transparent white fill
   * - Crisp white border
   * - Soft shadow
   */
  container: {
    backgroundColor: 'rgba(255, 255, 255, 0.55)', // Increased opacity for better visibility on solid backgrounds
    borderColor: '#FFFFFF',
    borderWidth: 1.5, // Slightly thicker border for "pop"
    borderRadius: 16,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: colors.midnightNavy,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.12,
        shadowRadius: 15,
      },
      android: {
        elevation: 8,
      },
    }),
  },

  /**
   * Floating card variant (for modals/dropdowns)
   * Slightly more prominent shadow and border
   */
  floatingCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.75)', // Higher opacity for floating elements to ensure legibility
    borderColor: '#FFFFFF',
    borderWidth: 2,
    borderRadius: 24,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: colors.midnightNavy,
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.2,
        shadowRadius: 24,
      },
      android: {
        elevation: 12,
      },
    }),
  },

  /**
   * Input field variant
   * Matches GlassInput style but centralized
   */
  input: {
    backgroundColor: 'rgba(255, 255, 255, 0.5)',
    borderColor: 'rgba(255, 255, 255, 0.8)',
    borderWidth: 1.5,
    borderRadius: 12,
    overflow: 'hidden',
  },

  /**
   * Separator line for glass lists
   */
  separator: {
    height: 1,
    backgroundColor: 'rgba(23, 42, 58, 0.1)', // Slightly darker for visibility
  },
});

export const GLASS_CONFIG = {
  intensity: {
    low: 20,
    medium: 50,
    high: 90,
    ultra: 100,
  },
  tint: 'light' as const,
};
