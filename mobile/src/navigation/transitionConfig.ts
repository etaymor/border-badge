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
 */
export const SPRING_CONFIG_DEFAULT = {
  stiffness: 1000,
  damping: 500,
  mass: 3,
} as const;

/**
 * Snappy spring config for micro-interactions
 * Higher stiffness for quick, responsive feedback
 */
export const SPRING_CONFIG_SNAPPY = {
  stiffness: 1200,
  damping: 400,
  mass: 2,
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

/**
 * Snappy transition spec for quick navigations
 */
export const TRANSITION_SPEC_SNAPPY = {
  open: SPRING_CONFIG_SNAPPY,
  close: SPRING_CONFIG_SNAPPY,
} as const;

/**
 * Modal transition spec - slightly gentler for modal presentations
 */
export const TRANSITION_SPEC_MODAL = {
  open: SPRING_CONFIG_GENTLE,
  close: SPRING_CONFIG_GENTLE,
} as const;

// ============ TIMING CONSTANTS ============

/** Duration for micro-interactions (ms) */
export const DURATION_MICRO = 150;

/** Duration for standard transitions (ms) */
export const DURATION_STANDARD = 300;

/** Duration for elaborate transitions (ms) */
export const DURATION_ELABORATE = 450;

/** Duration for celebration animations (ms) */
export const DURATION_CELEBRATION = 800;

// ============ STAGGER CONSTANTS ============

/** Stagger delay between items in lists (ms) */
export const STAGGER_DELAY_DEFAULT = 50;

/** Stagger delay for quick sequences (ms) */
export const STAGGER_DELAY_FAST = 30;

/** Maximum total duration for staggered animations (ms) */
export const STAGGER_MAX_DURATION = 1500;

// ============ SCALE CONSTANTS ============

/** Scale factor for previous screen during forward navigation */
export const SCALE_PREVIOUS_SCREEN = 0.95;

/** Scale factor for press feedback */
export const SCALE_PRESS = 0.96;

/** Scale factor for long press feedback */
export const SCALE_LONG_PRESS = 0.94;

/** Subtle scale for background elements during shared element transitions */
export const SCALE_BACKGROUND_SUBTLE = 0.98;

// ============ OPACITY CONSTANTS ============

/** Opacity for background elements during transitions */
export const OPACITY_BACKGROUND = 0.95;

/** Opacity for overlay during modal presentations */
export const OPACITY_OVERLAY = 0.5;

// ============ GESTURE CONSTANTS ============

/** Velocity threshold for gesture-driven dismissal */
export const GESTURE_VELOCITY_THRESHOLD = 500;

/** Distance threshold for gesture activation (px) */
export const GESTURE_RESPONSE_DISTANCE = 50;

// ============ SHARED ELEMENT CONSTANTS ============

/** Border radius for trip cards */
export const BORDER_RADIUS_CARD = 16;

/** Border radius for full-screen views */
export const BORDER_RADIUS_FULLSCREEN = 0;

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
