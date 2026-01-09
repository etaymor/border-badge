import { Dimensions } from 'react-native';

// Calculate row heights dynamically based on screen width for accurate getItemLayout
export const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Grid layout constants (must match styles)
export const GRID_PADDING = 16;
export const GRID_GAP = 12;
export const ITEM_WIDTH = (SCREEN_WIDTH - GRID_PADDING * 2 - GRID_GAP) / 2;
const ROW_VERTICAL_SPACING = 12; // must stay in sync with StampRow/CountryRow marginBottom

// StampCard is square, CountryCard has 3:4 aspect ratio
export const STAMP_HEIGHT = ITEM_WIDTH;
export const COUNTRY_CARD_HEIGHT = ITEM_WIDTH * (4 / 3);

// Row heights including margins - must match actual rendered heights exactly
export const ROW_HEIGHTS = {
  'section-header': 68, // fontSize 20-32 + marginTop 24 + marginBottom 8-12
  'stamp-row': STAMP_HEIGHT + ROW_VERTICAL_SPACING, // avoid rounding drift to prevent layout gaps
  'unvisited-row': COUNTRY_CARD_HEIGHT + ROW_VERTICAL_SPACING,
  'empty-state': 200,
} as const;
