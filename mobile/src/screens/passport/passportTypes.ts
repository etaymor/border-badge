import type { Animated } from 'react-native';

export interface CountryDisplayItem {
  code: string;
  name: string;
  region: string;
  status: 'visited' | 'wishlist';
  hasTrips: boolean;
}

export interface UnvisitedCountry {
  code: string;
  name: string;
  region: string;
  isWishlisted: boolean;
  hasTrips: boolean;
}

export type ListItem =
  | { type: 'section-header'; title: string; key: string }
  | { type: 'stamp-row'; data: CountryDisplayItem[]; key: string }
  | { type: 'unvisited-row'; data: UnvisitedCountry[]; key: string }
  | { type: 'empty-state'; key: string };

export interface StatBoxProps {
  value: string | number;
  label: string;
  backgroundColor: string;
  textColor?: string;
  labelColor?: string;
  index: number;
  show: boolean;
}

export interface AnimatedCardWrapperProps {
  children: React.ReactNode;
  animValue: Animated.Value;
  style?: object;
}

export interface PassportStats {
  stampedCount: number;
  dreamsCount: number;
  totalCountries: number;
  worldPercentage: number;
  regionsCount: number;
  travelStatus: string;
}
