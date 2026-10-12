/**
 * What the photo import screen holds on screen while an auto-start is pending.
 *
 * An `autoStart` route used to render idle (the stamp collage, while
 * `lastImportTime` loaded), then a cream "Preparing..." view, then the scan
 * stage — three different UIs inside a second. A pending auto-start now holds
 * the stage it is about to show, so idle -> scanning is one continuous view.
 *
 * - `stage`: permission status still unknown, so a bare navy stage (the
 *   carousel may yet replace it).
 * - `scan`: the scan stage the auto-start is about to start.
 * - `loading`: skipToSuggestions goes to cached suggestions, not a scan.
 * - `none`: no hold; the screen renders its phase as usual.
 *
 * The hold only lasts until the phase first leaves idle, so a cancelled scan
 * falls back to the real idle screen instead of a hold that never resolves.
 */

import { useState } from 'react';

import type { ImportPhase } from './photoImportTypes';

export type AutoStartHold = 'none' | 'stage' | 'scan' | 'loading';

export interface UseAutoStartHoldOptions {
  autoStart?: boolean;
  skipToSuggestions?: boolean;
  homeCountry?: string | null;
  phase: ImportPhase;
  permissionUi: 'none' | 'preheat' | 'recovery';
  permissionReady: boolean;
}

export function useAutoStartHold({
  autoStart,
  skipToSuggestions,
  homeCountry,
  phase,
  permissionUi,
  permissionReady,
}: UseAutoStartHoldOptions): AutoStartHold {
  const [leftIdle, setLeftIdle] = useState(false);
  if (phase !== 'idle' && !leftIdle) {
    setLeftIdle(true);
  }

  // Mirrors useAutoStartWorkflow's guard: without a home country (and not
  // skipping to suggestions) the auto-start never runs, so nothing to hold.
  const willAutoStart = Boolean(autoStart) && Boolean(homeCountry || skipToSuggestions);
  if (!willAutoStart || permissionUi !== 'none') return 'none';
  if (phase === 'scanning') return skipToSuggestions ? 'none' : 'scan';
  if (phase !== 'idle' || leftIdle) return 'none';
  if (skipToSuggestions) return 'loading';
  return permissionReady ? 'scan' : 'stage';
}
