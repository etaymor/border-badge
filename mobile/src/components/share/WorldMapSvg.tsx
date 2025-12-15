/**
 * Simplified world map SVG component for share cards.
 * Renders 6 continent regions with dynamic coloring based on visited status.
 */

import { memo } from 'react';
import Svg, { Path, G } from 'react-native-svg';

import { colors } from '@constants/colors';

// Simplified continent paths for visual appeal (not geographic accuracy)
// ViewBox: 0 0 1000 500 - standard world map aspect ratio
const CONTINENT_PATHS = {
  // Africa - central position
  Africa:
    'M480 180 L520 170 L550 190 L560 230 L555 280 L540 320 L510 350 L480 360 L450 340 L440 300 L445 250 L460 210 Z',
  // Americas - left side (combined North and South America)
  Americas:
    'M150 80 L180 70 L210 90 L220 130 L210 170 L230 200 L240 250 L235 300 L220 350 L200 390 L170 410 L140 400 L120 360 L115 310 L125 260 L130 210 L140 160 L145 120 Z M250 140 L280 130 L300 150 L295 180 L275 200 L255 190 L245 165 Z',
  // Asia - right side (largest)
  Asia: 'M580 80 L650 70 L720 85 L780 100 L820 130 L840 170 L830 220 L800 260 L750 280 L700 270 L650 250 L620 220 L600 180 L590 140 L575 110 Z M850 180 L880 200 L890 240 L870 270 L840 260 L830 230 L840 200 Z',
  // Europe - top center-right
  Europe: 'M480 60 L520 55 L560 65 L580 90 L570 120 L540 140 L500 145 L470 130 L460 100 L465 75 Z',
  // Oceania - bottom right
  Oceania:
    'M780 320 L830 310 L870 330 L880 370 L860 400 L820 410 L780 395 L770 360 Z M900 340 L920 350 L925 380 L910 400 L890 390 L885 365 Z',
  // Antarctica - bottom (optional, often not shown)
  Antarctica:
    'M200 460 L350 455 L500 450 L650 455 L800 460 L750 480 L600 485 L450 485 L300 480 L250 475 Z',
};

interface WorldMapSvgProps {
  /** Array of region names to highlight (e.g., ['Asia', 'Europe']) */
  highlightedRegions: string[];
  /** Width of the SVG (height is calculated from aspect ratio) */
  width: number;
  /** Color for highlighted regions */
  highlightColor?: string;
  /** Color for non-highlighted regions */
  mutedColor?: string;
  /** Color for the stroke/border of regions */
  strokeColor?: string;
}

function WorldMapSvgComponent({
  highlightedRegions,
  width,
  highlightColor = colors.sunsetGold,
  mutedColor = '#E5E5EA',
  strokeColor = colors.warmCream,
}: WorldMapSvgProps) {
  // Standard world map aspect ratio
  const height = width * 0.5;

  const isHighlighted = (region: string) => {
    // Handle "Americas" as a single region that matches both North/South America references
    if (region === 'Americas') {
      return highlightedRegions.some(
        (r) =>
          r === 'Americas' ||
          r === 'North America' ||
          r === 'South America' ||
          r === 'Central America' ||
          r === 'Caribbean'
      );
    }
    return highlightedRegions.includes(region);
  };

  return (
    <Svg width={width} height={height} viewBox="0 0 1000 500">
      <G>
        {Object.entries(CONTINENT_PATHS).map(([region, path]) => (
          <Path
            key={region}
            d={path}
            fill={isHighlighted(region) ? highlightColor : mutedColor}
            stroke={strokeColor}
            strokeWidth={2}
          />
        ))}
      </G>
    </Svg>
  );
}

export const WorldMapSvg = memo(WorldMapSvgComponent);
