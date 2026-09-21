export const PERMISSION_BEAT_LOOP_HOLD = 1600;
export const PERMISSION_BEAT_FADE_OUT = 300;
export const PERMISSION_CHECK_STAGGER = 140;
export const PERMISSION_PILL_STAGGER = 220;
export const PERMISSION_SHELF_STAGGER = 220;
export const PERMISSION_POP_DURATION = 320;

/** Duration-based so the fade-out starts the instant the last pop has settled. */
export const PERMISSION_POP_SPRING_CONFIG = {
  duration: PERMISSION_POP_DURATION,
  dampingRatio: 0.7,
} as const;

export function permissionBeatVisibleMs(count: number, stagger: number): number {
  if (count <= 0) return PERMISSION_BEAT_LOOP_HOLD;
  return (count - 1) * stagger + PERMISSION_POP_DURATION + PERMISSION_BEAT_LOOP_HOLD;
}

/** Delay after a pop settles before that item resets, while the frame is invisible. */
export function permissionBeatResetDelay(order: number, count: number, stagger: number): number {
  return (
    Math.max(0, count - 1 - order) * stagger + PERMISSION_BEAT_LOOP_HOLD + PERMISSION_BEAT_FADE_OUT
  );
}
