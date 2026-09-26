/**
 * Motion for the onboarding intro beats.
 *
 * Each beat is driven by one linear entrance clock (see `useIntroBeatClock`),
 * following the photo-permission rule of one clock per beat so nothing can
 * drift. Every element derives its progress from that clock with the worklets
 * below. Clock values:
 *
 * - `INTRO_CLOCK_STILL` (-1): final frame (Reduce Motion, or resumed after blur)
 * - `0`: the "before" pose (an inactive neighbour peeking in)
 * - `0 -> entranceMs`: playing
 *
 * Every helper returns its finished value for a negative clock, so a beat that
 * reads only these helpers gets its Reduce Motion frame for free.
 */

import { PERMISSION_CLOCK_STILL } from '@components/photos/permissionBeats/usePermissionBeatFade';

export const INTRO_CLOCK_STILL = PERMISSION_CLOCK_STILL;

/** Pause after a page settles before its entrance starts. */
export const INTRO_SETTLE_DELAY = 120;

/** Idle half-cycles (reversing). Even, so the idle ends back at rest. Never -1. */
export const INTRO_IDLE_REPEATS = 6;

export type IntroBeatKey = 'trips' | 'share' | 'passport' | 'guess_where';

export interface IntroBeatTiming {
  /** Length of the one-shot entrance. */
  entranceMs: number;
  /** Half-cycle of the gentle idle after the entrance; 0 means no idle. */
  idleHalfMs: number;
}

export const INTRO_BEAT_TIMING: Record<IntroBeatKey, IntroBeatTiming> = {
  trips: { entranceMs: 3100, idleHalfMs: 0 },
  share: { entranceMs: 3700, idleHalfMs: 0 },
  passport: { entranceMs: 2200, idleHalfMs: 0 },
  guess_where: { entranceMs: 2500, idleHalfMs: 0 },
};

/** Beat 1 cues (ms on the entrance clock). */
export const TRIPS_MOTION = {
  checkStart: 150,
  checkStagger: 90,
  checkPop: 320,
  lift: [700, 380],
  tagIn: [980, 160],
  tagResolve: [1450, 200],
  focusOut: [1850, 260],
  gridDim: [1800, 320],
  cardIn: [1900, 360],
  rowStart: 2150,
  rowStagger: 150,
  rowPop: 320,
  share: [2750, 320],
} as const;

/**
 * Beat 2 cues. Each step of the share gets its own beat so it reads at a
 * glance: tap share, sheet rises and holds, tap Atlasi, sheet drops, the saved
 * card springs up, the pin lands, the check confirms.
 */
export const SHARE_MOTION = {
  cardIn: [0, 420],
  fanOut: [120, 480],
  shareTap: [750, 260],
  sheetUp: [1050, 420],
  atlasiTap: [1750, 240],
  sheetDown: [2150, 320],
  savedIn: [2350, 520],
  pinDrop: [2800, 420],
  savedCheck: [3300, 320],
} as const;

/** Beat 3 cues. */
export const PASSPORT_MOTION = {
  stampStagger: 130,
  counterStart: 150,
  counterDuration: 1600,
  countries: 24,
  worldPercent: 11,
} as const;

/** Beat 4 cues. */
export const GUESS_MOTION = {
  cardIn: [0, 300],
  chipStart: 250,
  chipStagger: 80,
  chipDuration: 240,
  thinkFirst: [900, 160],
  thinkSecond: [1090, 160],
  select: [1300, 120],
  correct: [1650, 250],
  score: [1950, 300],
} as const;

/** Clamped 0..1 progress of the segment starting at `start`; 1 when still. */
export function segmentAt(t: number, start: number, duration: number): number {
  'worklet';
  if (t < 0) return 1;
  if (duration <= 0) return t >= start ? 1 : 0;
  const p = (t - start) / duration;
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  return p;
}

export function easeOutCubic(x: number): number {
  'worklet';
  return 1 - Math.pow(1 - x, 3);
}

export function easeInCubic(x: number): number {
  'worklet';
  return x * x * x;
}

export function easeInOutCubic(x: number): number {
  'worklet';
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/** Back-out ease with a small overshoot (same curve as the permission pops). */
export function backOut(x: number): number {
  'worklet';
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

/** Pop progress (0 -> ~1.1 -> 1) for a segment; 1 when still. */
export function popAt(t: number, start: number, duration: number): number {
  'worklet';
  const p = segmentAt(t, start, duration);
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  return backOut(p);
}

/** Slam phases of a stamp landing (ms after the land cue). */
export const STAMP_SLAM_MS = 160;
export const STAMP_SQUASH_MS = 80;
export const STAMP_SETTLE_MS = 180;
export const STAMP_LAND_MS = STAMP_SLAM_MS + STAMP_SQUASH_MS + STAMP_SETTLE_MS;
const STAMP_SLAM_FROM = 1.9;
const STAMP_SQUASH_TO = 0.94;

/**
 * Scale of a stamp landing at `start`: slams down from 1.9x, squashes to 0.94,
 * then settles to exactly 1 with a small overshoot. 0 before the cue so the
 * stamp stays hidden; 1 when still.
 */
export function stampLandScaleAt(t: number, start: number): number {
  'worklet';
  if (t < 0) return 1;
  const local = t - start;
  if (local < 0) return 0;
  if (local < STAMP_SLAM_MS) {
    const p = easeInCubic(local / STAMP_SLAM_MS);
    return STAMP_SLAM_FROM + (1 - STAMP_SLAM_FROM) * p;
  }
  if (local < STAMP_SLAM_MS + STAMP_SQUASH_MS) {
    const p = easeOutCubic((local - STAMP_SLAM_MS) / STAMP_SQUASH_MS);
    return 1 + (STAMP_SQUASH_TO - 1) * p;
  }
  if (local < STAMP_LAND_MS) {
    const p = backOut((local - STAMP_SLAM_MS - STAMP_SQUASH_MS) / STAMP_SETTLE_MS);
    return STAMP_SQUASH_TO + (1 - STAMP_SQUASH_TO) * p;
  }
  return 1;
}

/**
 * A point along a thrown arc from (0,0) to (dx,dy) at progress `p`. x eases
 * in-out while y eases in, so the path bows like something tossed.
 */
export function arcAt(p: number, dx: number, dy: number): { x: number; y: number } {
  'worklet';
  return { x: dx * easeInOutCubic(p), y: dy * easeInCubic(p) };
}

/** Eased counter value for beat 3 at clock `t` (reaches `target` exactly). */
export function counterValueAt(t: number, target: number): number {
  'worklet';
  const p = segmentAt(t, PASSPORT_MOTION.counterStart, PASSPORT_MOTION.counterDuration);
  return target * easeOutCubic(p);
}

/** The stage trails the page (0.65x) so it reads as depth behind the text. */
export const STAGE_LAG = 0.35;

/**
 * Horizontal parallax offset for a page's visual, where `p` is the page's
 * position relative to the viewport in pages (0 = settled, -1 = next page
 * waiting on the right, 1 = previous page off to the left).
 *
 * The visual trails its page by STAGE_LAG as a drag begins, and the offset
 * eases back to zero a full page away, so a neighbour never rests on-screen.
 * (A plain `p * lag` pulled the next beat a third of the way into view.)
 */
export function stageParallaxX(p: number, pageWidth: number): number {
  'worklet';
  const clamped = Math.max(-1, Math.min(1, p));
  return clamped * (1 - Math.abs(clamped)) * pageWidth * STAGE_LAG;
}
