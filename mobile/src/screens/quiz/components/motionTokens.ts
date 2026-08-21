/**
 * Motion duration tokens for the quiz surfaces (ms). Fixed values so every
 * quiz screen animates on the same clock; naming follows the tone of
 * navigation/transitionConfig.ts constants.
 */

/** Micro-interactions: press feedback, selection acknowledgments. */
export const DURATION_FAST = 120;

/** Standard element transitions: fades, option entrances. */
export const DURATION_BASE = 240;

/** Larger movements: sheet slides, phase changes. */
export const DURATION_SLOW = 350;

/** Hero moments: results reveal, score lockup entrance. */
export const DURATION_HERO = 600;
