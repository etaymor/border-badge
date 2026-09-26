export const PERMISSION_BEAT_LOOP_HOLD = 1600;
export const PERMISSION_BEAT_FADE_OUT = 300;
export const PERMISSION_CHECK_STAGGER = 140;
export const PERMISSION_PILL_STAGGER = 220;
export const PERMISSION_SHELF_STAGGER = 220;
export const PERMISSION_POP_DURATION = 320;

export function permissionBeatVisibleMs(count: number, stagger: number): number {
  'worklet';
  if (count <= 0) return PERMISSION_BEAT_LOOP_HOLD;
  return (count - 1) * stagger + PERMISSION_POP_DURATION + PERMISSION_BEAT_LOOP_HOLD;
}
