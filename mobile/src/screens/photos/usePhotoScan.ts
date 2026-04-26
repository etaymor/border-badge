/**
 * usePhotoScan - Thin adapter that delegates the scan to `photoScanService`.
 *
 * The hook subscribes to `photoScanStore` and fans store updates back into the
 * existing callback shape (`onScanProgress`, `onScanComplete`, `onScanError`)
 * so callers (`usePhotoImportWorkflow`) keep the same surface area while the
 * scan itself lives in the singleton service and survives navigation.
 */

import { useCallback, useEffect, useRef } from 'react';

import {
  cancelScan as cancelServiceScan,
  consumeResult,
  hasResult as serviceHasResult,
  startScan as startServiceScan,
  type LocationCluster,
  type LocationClusterDisplay,
  type PhotoWithLocation,
  type ScanProgress,
  type TripCandidateDisplay,
} from '@services/photoImport';
import {
  selectPhotoScanFailure,
  selectPhotoScanHasResult,
  selectPhotoScanPhase,
  selectPhotoScanProgress,
  usePhotoScanStore,
  type PhotoScanFailureReason,
} from '@stores/photoScanStore';

/** Reason the scan did not succeed. Mirrors the historical shape consumers expect. */
export type ScanFailureReason = PhotoScanFailureReason;

export interface ScanResult {
  candidates: TripCandidateDisplay[];
  photoLookup: Map<string, PhotoWithLocation>;
  clusterLookup: Map<string, LocationCluster>;
  clusterDisplays: Map<string, LocationClusterDisplay>;
  importTime: number;
  isIncremental: boolean;
}

export type ScanOutcome =
  | { success: true }
  | { success: false; reason: ScanFailureReason; title: string; message: string }
  | { success: false; reason: null };

export interface UsePhotoScanOptions {
  homeCountry: string | null;
  filterCountryCode?: string;
  onScanProgress: (progress: ScanProgress | null) => void;
  onScanComplete: (result: ScanResult) => void;
  onScanError: () => void;
}

export function usePhotoScan({
  homeCountry,
  filterCountryCode,
  onScanProgress,
  onScanComplete,
  onScanError,
}: UsePhotoScanOptions) {
  // Refs hold the latest callbacks so subscription effect doesn't tear down on every render.
  const onScanProgressRef = useRef(onScanProgress);
  const onScanCompleteRef = useRef(onScanComplete);
  const onScanErrorRef = useRef(onScanError);
  onScanProgressRef.current = onScanProgress;
  onScanCompleteRef.current = onScanComplete;
  onScanErrorRef.current = onScanError;

  // Track which result generation (importTime) we've consumed so a re-mount that
  // observes phase==='completed' doesn't double-consume the same result.
  const consumedImportTimeRef = useRef<number | null>(null);

  // ----- Mount-time recovery -----
  // If the service already has a completed result waiting (because the screen
  // unmounted before consuming it), pull it on first mount.
  useEffect(() => {
    if (
      usePhotoScanStore.getState().phase === 'completed' &&
      usePhotoScanStore.getState().hasResult &&
      serviceHasResult()
    ) {
      const result = consumeResult();
      if (result && consumedImportTimeRef.current !== result.importTime) {
        consumedImportTimeRef.current = result.importTime;
        onScanCompleteRef.current(result);
      }
    }
    // Intentionally empty deps: only fires once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ----- Subscriptions -----

  // Progress fan-out
  useEffect(
    () =>
      usePhotoScanStore.subscribe((state, prev) => {
        if (selectPhotoScanProgress(state) !== selectPhotoScanProgress(prev)) {
          onScanProgressRef.current(state.progress);
        }
      }),
    []
  );

  // Phase transitions: completed → consume result; failed → onScanError.
  useEffect(
    () =>
      usePhotoScanStore.subscribe((state, prev) => {
        const phase = selectPhotoScanPhase(state);
        const prevPhase = selectPhotoScanPhase(prev);
        if (phase === prevPhase) return;

        if (phase === 'completed' && selectPhotoScanHasResult(state) && serviceHasResult()) {
          const result = consumeResult();
          if (result && consumedImportTimeRef.current !== result.importTime) {
            consumedImportTimeRef.current = result.importTime;
            onScanCompleteRef.current(result);
          }
        } else if (phase === 'failed' && selectPhotoScanFailure(state)) {
          onScanErrorRef.current();
        } else if (phase === 'idle') {
          // Idle resets after cancel — clear the consumed-import-time marker so a
          // fresh scan starting from the same instant cannot be incorrectly skipped.
          consumedImportTimeRef.current = null;
        }
      }),
    []
  );

  const startScan = useCallback(
    async (forceRefresh = false): Promise<ScanOutcome> => {
      const result = await startServiceScan({
        homeCountry,
        filterCountryCode,
        forceRefresh,
      });

      if (result.status === 'started' || result.status === 'already-running') {
        // Outcome resolves immediately; the actual scan completion is delivered
        // through the store subscription. Returning success here is consistent
        // with the old behavior — callers don't await `complete`.
        return { success: true };
      }

      if (result.reason === 'no-home-country') {
        return {
          success: false,
          reason: 'home-country',
          title: 'Set Home Country',
          message: 'Please set your home country in settings first.',
        };
      }
      // Future-proof for `no-permission` / `not-premium` reasons surfaced by the
      // service. Not produced by `start` today (homeCountry is the only sync gate),
      // but the discriminated union allows them.
      return {
        success: false,
        reason: 'scan-error',
        title: 'Scan Failed',
        message: 'Failed to start scan. Please try again.',
      };
    },
    [homeCountry, filterCountryCode]
  );

  const cancelScan = useCallback(() => {
    cancelServiceScan();
  }, []);

  return { startScan, cancelScan };
}

// Re-export shared types to avoid a churn-only consumer change.
export type { DiscoveredCountry } from '@services/photoImport';
