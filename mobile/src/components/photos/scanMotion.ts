import { SPRING_CONFIG_BOUNCY } from '@navigation/transitionConfig';
import { DURATION_SLOW } from '@screens/quiz/components/motionTokens';

export const SCAN_ROW_ARRIVAL_DURATION = DURATION_SLOW;
export const SCAN_SLOT_FLY_IN_DURATION = DURATION_SLOW;
export const SCAN_SLOT_FLY_IN_STAGGER = Math.round(DURATION_SLOW / 3);
export const SCAN_MIN_ARRIVAL_GAP = DURATION_SLOW + SCAN_SLOT_FLY_IN_STAGGER;

export const SCAN_SLOT_FLY_IN_SPRING_CONFIG = {
  ...SPRING_CONFIG_BOUNCY,
} as const;
