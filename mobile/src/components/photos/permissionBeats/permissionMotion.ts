import { SPRING_CONFIG_BOUNCY } from '@navigation/transitionConfig';
import { DURATION_BASE, DURATION_HERO } from '@screens/quiz/components/motionTokens';

export const PERMISSION_BEAT_LOOP_HOLD = DURATION_HERO * 2;
export const PERMISSION_BEAT_RESET_DURATION = DURATION_BASE;
export const PERMISSION_CHECK_STAGGER = Math.round(DURATION_BASE * 0.6);
export const PERMISSION_PILL_STAGGER = Math.round(DURATION_BASE * 0.8);

export const PERMISSION_POP_SPRING_CONFIG = {
  ...SPRING_CONFIG_BOUNCY,
} as const;
