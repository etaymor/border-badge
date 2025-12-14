/**
 * Entry type configuration for the entry form.
 * Defines the available entry categories with their icons, colors, and labels.
 */

import { Ionicons } from '@expo/vector-icons';

import type { EntryType } from '@navigation/types';

import { colors } from './colors';

/**
 * Configuration type for entry type options
 */
export interface EntryTypeConfig {
  type: EntryType;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  color: string;
  emoji: string;
}

/**
 * Available entry types with their display configuration
 */
export const ENTRY_TYPES: EntryTypeConfig[] = [
  { type: 'place', icon: 'location', label: 'Place', color: colors.adobeBrick, emoji: '📍' },
  { type: 'food', icon: 'restaurant', label: 'Food', color: colors.sunsetGold, emoji: '🍽️' },
  { type: 'stay', icon: 'bed', label: 'Stay', color: colors.mossGreen, emoji: '🏨' },
  {
    type: 'experience',
    icon: 'star',
    label: 'Experience',
    color: colors.midnightNavy,
    emoji: '✨',
  },
];

/**
 * Get entry type configuration by type
 */
export function getEntryTypeConfig(type: EntryType): EntryTypeConfig | undefined {
  return ENTRY_TYPES.find((t) => t.type === type);
}
