// Grid layout constants (must match styles)
export const GRID_PADDING = 16;
export const GRID_GAP = 12;

// Column count based on device type
export const PHONE_COLUMNS = 2;
export const TABLET_COLUMNS = 4;

/**
 * Calculate grid dimensions based on screen width and column count
 */
export function getGridDimensions(screenWidth: number, isTablet: boolean) {
  const columns = isTablet ? TABLET_COLUMNS : PHONE_COLUMNS;
  const totalGapWidth = GRID_GAP * (columns - 1);
  const itemWidth = (screenWidth - GRID_PADDING * 2 - totalGapWidth) / columns;
  const stampHeight = itemWidth;
  const countryCardHeight = itemWidth * (4 / 3);

  return {
    columns,
    itemWidth,
    stampHeight,
    countryCardHeight,
    rowHeights: {
      'section-header': 68,
      'stamp-row': Math.round(stampHeight) + 12,
      'unvisited-row': Math.round(countryCardHeight) + 12,
      'empty-state': 200,
    } as const,
  };
}
