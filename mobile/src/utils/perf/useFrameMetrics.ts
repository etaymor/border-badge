/**
 * React wiring for the frame-metrics harness (U1).
 *
 * Registers a Reanimated `useFrameCallback` (UI-thread inter-frame gaps) and a
 * `requestAnimationFrame` loop (JS-thread gaps), feeding both into the shared
 * {@link getFrameMetricsController}. When the harness is not armed
 * ({@link isPerfMetricsEnabled} is false — always the case in production), the
 * frame callback is created inactive and the rAF loop never schedules, so there
 * is no runtime cost.
 */

import { useEffect } from 'react';
import { runOnJS, useFrameCallback } from 'react-native-reanimated';

import { isPerfMetricsEnabled } from './frameMetrics';
import { getFrameMetricsController } from './frameMetricsController';

/**
 * Mount once near the app root. Safe to call unconditionally — it self-disables
 * unless the harness is armed. Kept as a hook (not conditional) to satisfy the
 * rules of hooks; the *work* is what's gated, not the hook call.
 */
export function useFrameMetrics(): void {
  const enabled = isPerfMetricsEnabled();

  // UI-thread frame gaps via Reanimated. autostart=false so nothing runs unless
  // armed; the worklet forwards each frame timestamp to the JS controller.
  const frameCallback = useFrameCallback((frameInfo) => {
    'worklet';
    runOnJS(recordUiFrame)(frameInfo.timeSinceFirstFrame);
  }, false);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    frameCallback.setActive(true);

    // JS-thread frame gaps via rAF.
    let rafId: number | null = null;
    const tick = (): void => {
      getFrameMetricsController().recordJsFrame(global.performance?.now?.() ?? Date.now());
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    return () => {
      frameCallback.setActive(false);
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
    };
    // frameCallback identity is stable across renders (Reanimated hook contract).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
}

// Module-scope indirection so the worklet's runOnJS target is a stable function.
function recordUiFrame(timeMs: number): void {
  getFrameMetricsController().recordUiFrame(timeMs);
}
