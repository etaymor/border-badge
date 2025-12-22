import { Dimensions } from 'react-native';

// Calculate row heights dynamically based on screen width for accurate getItemLayout
export const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Grid layout constants (must match styles)
export const GRID_PADDING = 16;
export const GRID_GAP = 12;
export const ITEM_WIDTH = (SCREEN_WIDTH - GRID_PADDING * 2 - GRID_GAP) / 2;

// StampCard is square, CountryCard has 3:4 aspect ratio
export const STAMP_HEIGHT = ITEM_WIDTH;
export const COUNTRY_CARD_HEIGHT = ITEM_WIDTH * (4 / 3);

// Row heights including margins - must match actual rendered heights exactly
export const ROW_HEIGHTS = {
  'section-header': 68, // fontSize 20-32 + marginTop 24 + marginBottom 8-12
  'stamp-row': Math.round(STAMP_HEIGHT) + 12, // stamp height + marginBottom
  'unvisited-row': Math.round(COUNTRY_CARD_HEIGHT) + 12, // card height + marginBottom
  'empty-state': 200,
} as const;
