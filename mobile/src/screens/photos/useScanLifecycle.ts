/**
 * useScanLifecycle - Encapsulates scan-related side effects for PhotoImportScreen.
 *
 * Manages:
 * - Keep-awake activation while the screen is focused AND scanning
 * - Scan failure alerts
 * - Cancel-scan confirmation (elapsed > 30 s) shared with the banner
 *
 * Notably does NOT abort the scan on unmount — the singleton service owns
 * the scan and survives navigation now (see U1/U3 of the background-scan plan).
 * Back-navigation while scanning is allowed silently; the persistent banner
 * surfaces progress on other screens.
 */

import { useCallback, useEffect, useRef } from 'react';
import { Alert } from 'react-native';

import { useIsFocused } from '@react-navigation/native';

import type { PassportStackScreenProps } from '@navigation/types';
import { isAlertScanFailure, type PhotoScanFailureReason } from '@stores/photoScanStore';

import type { ImportPhase } from './photoImportTypes';
import { confirmCancelScan } from './cancelScanConfirmation';

export interface UseScanLifecycleOptions {
  /** Current workflow phase. Mirrors `usePhotoImportWorkflow`'s phase. */
  phase: ImportPhase;
  /** Cancels the running scan */
  cancelScan: () => void;
  /**
   * Non-null when the scan ended with a user-facing failure. The optional
   * `reason` field gates the alert: only legacy "alert-and-back" reasons
   * (no-photos / no-trips / home-country / scan-error) trigger the alert;
   * service-level reasons (stuck, stale, no-permission, subscription-expired)
   * render the failed-state branch in ScanningPhase with a Retry button instead.
   */
  scanFailure: { title: string; message: string; reason?: PhotoScanFailureReason } | null;
  /** Clears the current scanFailure value */
  clearScanFailure: () => void;
  /** When true the screen was opened with auto-start; affects post-failure navigation */
  autoStart: boolean | undefined;
  /** The screen's navigation object (used for goBack and beforeRemove listener) */
  navigation: PassportStackScreenProps<'PhotoImport'>['navigation'];
}

interface UseScanLifecycleResult {
  /** Call from the Cancel button — confirms when the scan has been running >30 s */
  handleCancelScan: () => void;
}

export function useScanLifecycle({
  phase,
  cancelScan,
  scanFailure,
  clearScanFailure,
  autoStart,
  navigation,
}: UseScanLifecycleOptions): UseScanLifecycleResult {
  const isFocused = useIsFocused();

  // Show alert when scan finds no photos or no trips (legacy "alert-and-back"
  // failures), navigate back on dismiss when autoStart was true. Service-level
  // failures (stuck, stale, no-permission, subscription-expired) render
  // in-screen via ScanningPhase's failed-state branch instead.
  const isAlertReason = !scanFailure?.reason || isAlertScanFailure(scanFailure.reason);
  useEffect(() => {
    if (!scanFailure) return;
    if (!isAlertReason) return;
    Alert.alert(scanFailure.title, scanFailure.message, [
      {
        text: 'OK',
        onPress: () => {
          clearScanFailure();
          if (autoStart) {
            navigation.goBack();
          }
        },
      },
    ]);
  }, [scanFailure, isAlertReason, clearScanFailure, autoStart, navigation]);

  // Keep screen awake while the user is actively watching the scan.
  // The scan now survives navigation, so keep-awake is no longer load-bearing
  // for correctness — but holding it while the screen is focused avoids the
  // iOS idle-timeout → screen-lock → suspend cycle that would otherwise force
  // a resume.
  // Lazy require to avoid loading native module at app startup (PassportNavigator
  // statically imports PhotoImportScreen, which would eagerly evaluate this module).
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const KeepAwake = require('expo-keep-awake');
    if (phase === 'scanning' && isFocused) {
      KeepAwake.activateKeepAwakeAsync('photo-scan').catch((err: unknown) => {
        if (__DEV__) console.warn('[PhotoImport] Failed to activate keep-awake:', err);
      });
    } else {
      KeepAwake.deactivateKeepAwake('photo-scan');
    }
    return () => {
      KeepAwake.deactivateKeepAwake('photo-scan');
    };
  }, [phase, isFocused]);

  // Track scan start time for cancel confirmation
  const scanStartTimeRef = useRef<number | null>(null);
  useEffect(() => {
    if (phase === 'scanning') {
      if (scanStartTimeRef.current === null) {
        scanStartTimeRef.current = Date.now();
      }
    } else {
      scanStartTimeRef.current = null;
    }
  }, [phase]);

  // Cancel with confirmation when scan has been running >30 seconds.
  const handleCancelScan = useCallback(() => {
    confirmCancelScan(scanStartTimeRef.current, cancelScan);
  }, [cancelScan]);

  return { handleCancelScan };
}
