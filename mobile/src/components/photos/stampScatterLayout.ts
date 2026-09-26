/**
 * stampScatterLayout - where each found country's stamp lands on the stage.
 *
 * Stamps fill the visible band like a passport page, not a list. The band is
 * cut into a staggered grid sized for `capacity` stamps (odd rows shift half
 * a cell, so it never reads as rows), each cell's anchor is jittered by a
 * per-page seed, and the anchors are visited in FARTHEST-FIRST order, so any
 * prefix — the first two finds, the first four — already spans the band
 * instead of filling it top to bottom.
 *
 * Stamp size follows the cell: fewer stamps per page means bigger stamps.
 * The same seed always gives the same layout, so a landed stamp never moves.
 *
 * Pure geometry, no React, so bounds can be unit tested.
 */

/** Photos tucked behind a stamp, relative to its center, in stamp-size units. */
export const TUCKED_PHOTO_OFFSETS: readonly {
  x: number;
  y: number;
  rotation: number;
}[] = [
  { x: -0.46, y: -0.3, rotation: -14 },
  { x: 0.48, y: -0.16, rotation: 11 },
];

export const TUCKED_PHOTO_SCALE = 0.7;

const MAX_STAMP_SIZE = 124;
const MIN_STAMP_SIZE = 48;
/** A stamp group (stamp + fanned photos) is about this many stamps wide. */
const GROUP_WIDTH_IN_STAMPS = 1.75;
const GROUP_HEIGHT_IN_STAMPS = 1.3;
const JITTER = 0.14;
const MAX_TILT_DEG = 10;

export interface StampBand {
  width: number;
  /** Full stage height. */
  height: number;
  /** Covered at the top (header) and bottom (sheet). */
  top: number;
  bottom: number;
  /** Top-left block (a back button) no stamp may cover. */
  corner?: { width: number; height: number };
}

export interface StampAnchor {
  /** Stamp center, in stage points. */
  x: number;
  y: number;
}

export interface StampScatterLayout {
  stampSize: number;
  photoSize: number;
  /** One per slot, in visit order. */
  anchors: StampAnchor[];
}

/** djb2 — small, stable, good enough to seed a layout. */
export function hashString(value: string): number {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash + value.charCodeAt(index)) | 0;
  }
  return hash >>> 0;
}

/** mulberry32 */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Resting tilt for a stamp, stable per country. */
export function stampTilt(code: string): number {
  const unit = (hashString(code.toUpperCase()) % 1000) / 999;
  return Math.round((unit * 2 - 1) * MAX_TILT_DEG * 10) / 10;
}

/** Columns x rows for `capacity` cells whose shape best suits a group. */
function chooseGrid(capacity: number, width: number, height: number) {
  let best = { columns: 1, rows: capacity, size: 0 };
  for (let columns = 1; columns <= capacity; columns += 1) {
    const rows = Math.ceil(capacity / columns);
    const size = Math.min(
      width / columns / GROUP_WIDTH_IN_STAMPS,
      height / rows / GROUP_HEIGHT_IN_STAMPS
    );
    if (size > best.size) best = { columns, rows, size };
  }
  return best;
}

/** Order anchors so each next one is as far as possible from those chosen. */
function farthestFirst(points: StampAnchor[], centerX: number, centerY: number): StampAnchor[] {
  if (points.length === 0) return [];
  const remaining = points.slice();
  let startIndex = 0;
  let startDistance = Infinity;
  remaining.forEach((point, index) => {
    const distance = Math.hypot(point.x - centerX, point.y - centerY);
    if (distance < startDistance) {
      startDistance = distance;
      startIndex = index;
    }
  });
  const ordered = remaining.splice(startIndex, 1);
  while (remaining.length > 0) {
    let pick = 0;
    let pickDistance = -1;
    remaining.forEach((point, index) => {
      const nearest = Math.min(
        ...ordered.map((chosen) => Math.hypot(point.x - chosen.x, point.y - chosen.y))
      );
      if (nearest > pickDistance) {
        pickDistance = nearest;
        pick = index;
      }
    });
    ordered.push(...remaining.splice(pick, 1));
  }
  return ordered;
}

/**
 * Layout for a page of `capacity` stamps inside the visible band.
 * Deterministic for a given seed. Empty before the stage has a size.
 */
export function layoutStampScatter(
  band: StampBand,
  capacity: number,
  seed: number
): StampScatterLayout {
  const bandHeight = band.height - band.top - band.bottom;
  if (band.width <= 0 || bandHeight <= 0 || capacity <= 0) {
    return { stampSize: 0, photoSize: 0, anchors: [] };
  }

  const margin = 10;
  const usableWidth = band.width - margin * 2;
  const usableHeight = bandHeight - margin * 2;
  const grid = chooseGrid(capacity, usableWidth, usableHeight);
  const stampSize = Math.round(Math.min(MAX_STAMP_SIZE, Math.max(MIN_STAMP_SIZE, grid.size)));
  const photoSize = Math.round(stampSize * TUCKED_PHOTO_SCALE);

  // Keep every tilted stamp fully inside the band; photos may tuck under an edge.
  const reach = (stampSize / 2) * Math.SQRT2 * 0.82;
  const minX = margin + reach;
  const maxX = band.width - margin - reach;
  const minY = band.top + margin + reach;
  const maxY = band.height - band.bottom - margin - reach;
  const cellWidth = usableWidth / grid.columns;
  const cellHeight = usableHeight / grid.rows;
  const random = seededRandom(seed);

  const cells: StampAnchor[] = [];
  for (let row = 0; row < grid.rows; row += 1) {
    const stagger = row % 2 === 1 ? cellWidth / 4 : -cellWidth / 4;
    for (let column = 0; column < grid.columns; column += 1) {
      const jitterX = (random() * 2 - 1) * JITTER * cellWidth;
      const jitterY = (random() * 2 - 1) * JITTER * cellHeight;
      const x = margin + cellWidth * (column + 0.5) + (grid.columns > 1 ? stagger : 0) + jitterX;
      const y = band.top + margin + cellHeight * (row + 0.5) + jitterY;
      const anchor = {
        x: Math.min(maxX, Math.max(minX, x)),
        y: Math.min(maxY, Math.max(minY, y)),
      };
      // Slide a stamp that would sit under the back button out to its right.
      if (
        band.corner &&
        anchor.x - reach < band.corner.width &&
        anchor.y - reach < band.corner.height
      ) {
        anchor.x = Math.min(maxX, band.corner.width + reach);
      }
      cells.push(anchor);
    }
  }

  const ordered = farthestFirst(cells, band.width / 2, band.top + bandHeight / 2).slice(
    0,
    capacity
  );
  return { stampSize, photoSize, anchors: ordered };
}
