/**
 * Shared transition configurations for react-native-screen-transitions
 *
 * These constants define the animation timing and spring physics used throughout
 * the app's screen transitions. Values are aligned with LiquidGlassTabBar.tsx
 * for consistency.
 */

// ============ SPRING CONSTANTS ============
// Reused from LiquidGlassTabBar.tsx for consistency across the app

/** Spring friction for animations (lower = more bouncy) */
export const SPRING_FRICTION = 8;

/** Spring tension for press-in / entering animations (higher = faster) */
export const SPRING_TENSION_IN = 400;

/** Spring tension for press-out / exiting animations */
export const SPRING_TENSION_OUT = 300;

// ============ REANIMATED SPRING CONFIGS ============
// Converted to stiffness/damping/mass for react-native-reanimated

/**
 * Default spring config for screen transitions
 * Uses moderate stiffness for smooth, premium feel
 * Mass reduced from 3 to 1.5 for faster settling (reduces jitter)
 */
export const SPRING_CONFIG_DEFAULT = {
  stiffness: 1000,
  damping: 500,
  mass: 1.5,
} as const;

/**
 * Gentle spring config for subtle animations
 * Lower stiffness for soft, organic feel
 */
export const SPRING_CONFIG_GENTLE = {
  stiffness: 800,
  damping: 600,
  mass: 3,
} as const;

/**
 * Bouncy spring config for celebration moments
 * Lower damping for more overshoot
 */
export const SPRING_CONFIG_BOUNCY = {
  stiffness: 900,
  damping: 300,
  mass: 2,
} as const;

// ============ TRANSITION SPECS ============

/**
 * Default transition spec for most screen transitions
 */
export const TRANSITION_SPEC_DEFAULT = {
  open: SPRING_CONFIG_DEFAULT,
  close: SPRING_CONFIG_DEFAULT,
} as const;

// ============ STAGGER CONSTANTS ============

/** Stagger delay between items in lists (ms) */
export const STAGGER_DELAY_DEFAULT = 50;

/** Maximum total duration for staggered animations (ms) */
export const STAGGER_MAX_DURATION = 1500;

// ============ SCALE CONSTANTS ============

/** Scale factor for previous screen during forward navigation */
export const SCALE_PREVIOUS_SCREEN = 0.95;

/** Scale factor for press feedback */
export const SCALE_PRESS = 0.96;

// ============ OPACITY CONSTANTS ============

/** Opacity for background elements during transitions */
export const OPACITY_BACKGROUND = 0.95;

// ============ TYPE EXPORTS ============

export type SpringConfig = {
  stiffness: number;
  damping: number;
  mass: number;
};

export type TransitionSpec = {
  open: SpringConfig;
  close: SpringConfig;
};
