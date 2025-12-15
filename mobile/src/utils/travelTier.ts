/**
 * Travel tier system - determines user's travel status based on countries visited.
 * Extracted to a utility for reuse across components.
 */

import type { Ionicons } from '@expo/vector-icons';

export interface TravelTier {
  threshold: number;
  status: string;
  icon: keyof typeof Ionicons.glyphMap;
}

export const TRAVEL_STATUS_TIERS: TravelTier[] = [
  { threshold: 5, status: 'Local Wanderer', icon: 'walk-outline' },
  { threshold: 15, status: 'Pathfinder', icon: 'compass-outline' },
  { threshold: 30, status: 'Border Breaker', icon: 'map-outline' },
  { threshold: 50, status: 'Roving Explorer', icon: 'navigate-outline' },
  { threshold: 80, status: 'Globe Trotter', icon: 'globe-outline' },
  { threshold: 120, status: 'World Seeker', icon: 'planet-outline' },
  { threshold: 160, status: 'Continental Master', icon: 'earth-outline' },
  { threshold: Infinity, status: 'Global Elite', icon: 'trophy-outline' },
];

/**
 * Get the travel status tier for a given number of visited countries.
 * @param visitedCount Number of countries the user has visited
 * @returns The tier object containing status name and icon
 */
export function getTravelStatus(visitedCount: number): TravelTier {
  for (const tier of TRAVEL_STATUS_TIERS) {
    if (visitedCount < tier.threshold) {
      return tier;
    }
  }
  return TRAVEL_STATUS_TIERS[TRAVEL_STATUS_TIERS.length - 1];
}
