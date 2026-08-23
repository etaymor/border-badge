/**
 * usePhotoScan - Thin adapter that delegates the scan to `photoScanService`.
 *
 * The hook subscribes to the `trip-scan` slice of `libraryJobStore` and fans
 * store updates back into the existing callback shape (`onScanProgress`,
 * `onScanComplete`, `onScanError`) so callers (`usePhotoImportWorkflow`) keep
 * the same surface area while the scan itself runs on the library job runtime
 * and survives navigation.
 */

import { useCallback, useEffect, useRef } from 'react';

import { useIsFocused } from '@react-navigation/native';

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
  isAlertScanFailure,
  type PhotoScanFailureReason,
} from '@services/photoImport/photoScanTypes';
import {
  selectScanFailure,
  selectScanHasResult,
  selectScanPhase,
  selectScanProgress,
  useLibraryJobStore,
} from '@stores/libraryJobStore';

/** Reason the scan did not succeed. Mirrors the historical shape consumers expect. */
export type ScanFailureReason = PhotoScanFailureReason;

export interface ScanResult {
  candidates: TripCandidateDisplay[];
  photoLookup: Map<string, PhotoWithLocation>;
  clusterLookup: Map<string, LocationCluster>;
  clusterDisplays: Map<string, LocationClusterDisplay>;
  importTime: number;
  isIncremental: boolean;
  autoDismissedClusterIds?: Set<string>;
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

  // Mount-time and phase-transition consume both gate on focus so two
  // simultaneously-mounted PhotoImport screens (cross-tab) don't both try to
  // consume the singleton result — only the focused one wins.
  const isFocused = useIsFocused();
  const isFocusedRef = useRef(isFocused);
  isFocusedRef.current = isFocused;

  const completeWithResult = useCallback(
    (result: ScanResult) => {
      const candidates = filterCountryCode
        ? result.candidates.filter((candidate) => candidate.countryCode === filterCountryCode)
        : result.candidates;
      onScanCompleteRef.current({ ...result, candidates });
    },
    [filterCountryCode]
  );

  // ----- Mount-time recovery -----
  // If the service already has a completed result waiting (because the screen
  // unmounted before consuming it), pull it on first mount. Gate on focus so
  // a non-focused tab that also mounts PhotoImport doesn't race the focused
  // tab to call consumeResult — `useIsFocused` lets the non-focused mount
  // re-run this effect once it gains focus.
  // NOTE: filterCountryCode is intentionally not in the dep array — the result
  // map is owned by the service and its candidate filter is applied in
  // completeWithResult(). Re-running on filter change would not change which
  // result is consumed.
  useEffect(() => {
    if (!isFocused) return;
    const slice = useLibraryJobStore.getState().jobs['trip-scan'];
    if (slice.phase === 'completed' && slice.hasResult && serviceHasResult()) {
      const result = consumeResult();
      if (result && consumedImportTimeRef.current !== result.importTime) {
        consumedImportTimeRef.current = result.importTime;
        completeWithResult(result);
      }
    }
  }, [isFocused, completeWithResult]);

  // ----- Subscriptions -----

  // Progress fan-out
  useEffect(
    () =>
      useLibraryJobStore.subscribe((state, prev) => {
        if (selectScanProgress(state) !== selectScanProgress(prev)) {
          onScanProgressRef.current(selectScanProgress(state));
        }
      }),
    []
  );

  // Phase transitions: completed → consume result (focused tab only);
  // failed → onScanError (only for alert-style reasons).
  useEffect(
    () =>
      useLibraryJobStore.subscribe((state, prev) => {
        const phase = selectScanPhase(state);
        const prevPhase = selectScanPhase(prev);
        if (phase === prevPhase) return;

        if (phase === 'completed' && selectScanHasResult(state) && serviceHasResult()) {
          // Cross-tab guard: only the focused tab consumes the singleton result.
          if (!isFocusedRef.current) return;
          const result = consumeResult();
          if (result && consumedImportTimeRef.current !== result.importTime) {
            consumedImportTimeRef.current = result.importTime;
            completeWithResult(result);
          }
        } else if (phase === 'failed') {
          // Only fire onScanError for alert-style reasons (no-photos, no-trips,
          // home-country, scan-error). Runtime-level reasons (stuck, stale,
          // no-permission, subscription-expired) keep the screen in 'scanning'
          // so the workflow's mirror effect renders the inline retry button.
          const failure = selectScanFailure(state);
          if (failure && isAlertScanFailure(failure.reason)) {
            onScanErrorRef.current();
          }
        } else if (phase === 'idle') {
          // Idle resets after cancel — clear the consumed-import-time marker so a
          // fresh scan starting from the same instant cannot be incorrectly skipped.
          consumedImportTimeRef.current = null;
        }
      }),
    [completeWithResult]
  );

  const startScan = useCallback(
    async (forceRefresh = false): Promise<ScanOutcome> => {
      const result = await startServiceScan({
        homeCountry,
        filterCountryCode,
        forceRefresh,
      });

      if (
        result.status === 'started' ||
        result.status === 'already-running' ||
        // Queued behind a running quiz build. The runtime drains the queue when
        // that job settles, so this is a wait, not a failure — the screen stays
        // in 'scanning' and the banner explains what it is waiting on.
        result.status === 'queued'
      ) {
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
      // `no-permission` / `not-premium` are surfaced by the runtime rather than
      // by `startScan`'s own synchronous check, but the discriminated union
      // allows them and they land here rather than in an unhandled branch.
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
