// Card dimensions: 9:16 aspect ratio optimized for Instagram Stories
export const CARD_WIDTH = 375;
export const CARD_HEIGHT = Math.round((CARD_WIDTH * 16) / 9); // 667

/**
 * ViewShot capture options for share cards: a story-sized PNG written to a
 * tmpfile the share sheet can attach.
 *
 * No width/height override: the card is laid out at 375x667, and forcing a
 * 1080x1920 output rasterized it up 2.88x - visibly soft edges on an
 * all-type card. Capturing at the device's native pixel ratio (3x on modern
 * iPhones = 1125x2001) keeps every glyph and border crisp at story size.
 */
export const CARD_CAPTURE_OPTIONS = {
  format: 'png',
  quality: 0.95,
  result: 'tmpfile',
} as const;

// Scale factor for consistent sizing
export const SCALE = 1;

/**
 * Pre-calculated stamp positions for a natural scattered look.
 * Each position: { x: % from left, y: % from top, rotation: deg, scale: factor }
 * Layout is optimized for 9:16 aspect ratio cards with up to 12 stamps.
 */
export const STAMP_POSITIONS = [
  // Top area stamps
  { x: 8, y: 12, rotation: -8, scale: 1.0 },
  { x: 52, y: 8, rotation: 12, scale: 0.95 },
  // Upper middle
  { x: 28, y: 22, rotation: -4, scale: 1.05 },
  { x: 68, y: 20, rotation: 8, scale: 0.9 },
  // Middle area
  { x: 5, y: 34, rotation: 6, scale: 0.95 },
  { x: 42, y: 36, rotation: -10, scale: 1.0 },
  { x: 72, y: 38, rotation: 4, scale: 0.92 },
  // Lower middle
  { x: 18, y: 50, rotation: -6, scale: 1.02 },
  { x: 55, y: 52, rotation: 14, scale: 0.88 },
  // Bottom area
  { x: 8, y: 64, rotation: 10, scale: 0.95 },
  { x: 38, y: 68, rotation: -12, scale: 1.0 },
  { x: 65, y: 66, rotation: 5, scale: 0.9 },
] as const;
