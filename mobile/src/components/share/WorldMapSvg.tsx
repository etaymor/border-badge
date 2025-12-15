/**
 * Simplified world map SVG component for share cards.
 * Renders 6 continent regions with dynamic coloring based on visited status.
 * Uses Robinson projection-like simplified paths for better visual balance.
 */

import { memo } from 'react';
import Svg, { Path, G } from 'react-native-svg';

import { colors } from '@constants/colors';

// Improved simplified paths - clearer definitions while remaining low-poly
// ViewBox: 0 0 1000 500
const CONTINENT_PATHS = {
  // North America & South America
  Americas:
    'M165,65 C130,65 90,80 90,110 C90,130 110,140 130,150 C150,160 180,140 200,120 C220,100 280,80 320,80 C360,80 340,120 310,140 C280,160 250,180 240,220 C230,260 250,280 260,300 C270,320 280,360 270,400 C260,440 240,480 220,490 C200,500 180,480 170,440 C160,400 150,360 170,320 C190,280 200,240 190,210 C180,180 140,180 120,140 C100,100 120,80 140,70 C150,65 160,65 165,65 Z',
  
  // Europe
  Europe:
    'M480,70 C460,70 450,90 450,110 C450,130 470,140 490,140 C510,140 530,130 540,110 C550,90 580,70 560,60 C540,50 500,70 480,70 Z',
  
  // Africa
  Africa:
    'M460,160 C440,180 430,220 440,250 C450,280 470,320 500,340 C530,360 560,320 570,280 C580,240 590,200 560,170 C530,140 480,140 460,160 Z',
  
  // Asia
  Asia:
    'M600,60 C580,80 570,120 600,150 C630,180 600,220 620,250 C640,280 680,280 710,250 C740,220 760,200 800,180 C840,160 880,140 850,100 C820,60 750,40 700,50 C650,60 620,40 600,60 Z',
  
  // Oceania
  Oceania:
    'M800,300 C780,320 790,360 820,380 C850,400 890,380 900,340 C910,300 880,280 850,290 C820,300 820,280 800,300 Z',
    
  // Antarctica (Optional, included for completeness if needed)
  Antarctica:
    'M200,470 L800,470 C820,490 780,500 500,500 C220,500 180,490 200,470 Z'
};

// More refined paths using standard coordinates (simplified)
const REFINED_PATHS = {
  Americas: "M259.6,73.1 c-14.7-12-42.7-18.7-42.7-18.7 s-18.7,1.3-30.7,16 c-12,14.7-12,28-5.3,42.7 c6.7,14.7,26.7,28,34.7,37.3 c8,9.3,5.3,22.7,0,33.3 c-5.3,10.7-18.7,16-29.3,16 c-10.7,0-24-5.3-32-13.3 c-8-8-13.3-21.3-6.7-32 c-4-5.3-10.7-8-17.3-5.3 c-6.7,2.7-10.7,9.3-9.3,16 c1.3,6.7,5.3,12,10.7,14.7 c-2.7,13.3,2.7,28,13.3,36 c10.7,8,26.7,9.3,38.7,4 c5.3,13.3,18.7,22.7,33.3,22.7 c14.7,0,28-9.3,33.3-22.7 c9.3,2.7,18.7,1.3,26.7-4 c8-5.3,13.3-13.3,14.7-22.7 c13.3-2.7,24-10.7,29.3-22.7 C326.3,158.4,329,143.1,323.6,129.7 c-5.3-13.3-16-22.7-29.3-25.3 C291.6,92.4,274.3,85.1,259.6,73.1 z M292.9,321.7 c-10.7-10.7-26.7-13.3-40-8 c-13.3,5.3-21.3,18.7-20,33.3 c1.3,14.7,10.7,26.7,24,32 c13.3,5.3,29.3,2.7,40-8 C307.6,360.4,303.6,332.4,292.9,321.7 z",
  
  Europe: "M486.3,83.7 c-10.7-5.3-24-2.7-32,8 c-8,10.7-8,25.3,0,36 c8,10.7,21.3,13.3,32,8 c10.7-5.3,13.3-18.7,8-29.3 C492.9,98.4,497,94.4,486.3,83.7 z",
  
  Africa: "M538.3,165.1 c-14.7-12-36-12-50.7,0 c-14.7,12-14.7,32,0,44 c5.3,4,8,10.7,5.3,17.3 c-2.7,6.7-8,10.7-14.7,10.7 c-6.7,0-13.3-2.7-17.3-8 c-4-5.3-4-13.3,0-18.7 c-8-5.3-13.3-13.3-14.7-22.7 c-1.3-9.3,1.3-18.7,6.7-25.3 c-10.7-5.3-24-2.7-32,8 c-8,10.7-8,25.3,0,36 c6.7,9.3,17.3,12,28,8 c5.3,13.3,18.7,22.7,33.3,22.7 c14.7,0,28-9.3,33.3-22.7 c13.3,4,26.7,1.3,36-8 C562.9,196.4,561.6,177.1,538.3,165.1 z",
  
  Asia: "M736.9,62.4 c-24-10.7-52-5.3-70.7,13.3 c-18.7,18.7-24,46.7-13.3,70.7 c5.3,12,16,21.3,29.3,24 c2.7,13.3,10.7,24,22.7,29.3 c12,5.3,26.7,2.7,37.3-6.7 c5.3,5.3,13.3,8,21.3,6.7 c8-1.3,14.7-5.3,18.7-12 c8,5.3,18.7,5.3,26.7,0 c8-5.3,12-13.3,10.7-22.7 c-1.3-9.3-6.7-16-14.7-18.7 c4-8,2.7-18.7-4-25.3 c-6.7-6.7-17.3-8-25.3-4 c-2.7-8-9.3-13.3-18.7-14.7 C786.3,92.4,766.3,73.1,736.9,62.4 z",
  
  Oceania: "M867.6,321.7 c-13.3-5.3-28-1.3-37.3,9.3 c-9.3,10.7-9.3,26.7,0,37.3 c9.3,10.7,25.3,13.3,37.3,8 c12-5.3,18.7-18.7,17.3-32 C883.6,333.7,878.3,325.7,867.6,321.7 z",
  
  Antarctica: "M500,480 c-133.3,0-253.3,5.3-266.7,13.3 c13.3,5.3,133.3,6.7,266.7,6.7 s253.3-1.3,266.7-6.7 C753.3,485.3,633.3,480,500,480 z"
};

// Use the refined paths
const PATHS = REFINED_PATHS;

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
  /** Opacity for the fill */
  fillOpacity?: number;
}

function WorldMapSvgComponent({
  highlightedRegions,
  width,
  highlightColor = colors.sunsetGold,
  mutedColor = '#E5E5EA',
  strokeColor = 'transparent',
  fillOpacity = 1,
}: WorldMapSvgProps) {
  // Standard world map aspect ratio
  const height = width * 0.55;

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
    <Svg width={width} height={height} viewBox="0 0 1000 550">
      <G>
        {Object.entries(PATHS).map(([region, path]) => (
          <Path
            key={region}
            d={path}
            fill={isHighlighted(region) ? highlightColor : mutedColor}
            stroke={strokeColor}
            strokeWidth={1}
            fillOpacity={fillOpacity}
          />
        ))}
      </G>
    </Svg>
  );
}

export const WorldMapSvg = memo(WorldMapSvgComponent);
