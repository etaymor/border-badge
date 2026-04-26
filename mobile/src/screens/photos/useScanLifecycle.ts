/**
 * useScanLifecycle - Encapsulates scan-related side effects for PhotoImportScreen.
 *
 * Manages:
 * - Keep-awake activation while the screen is focused AND scanning
 * - Scan failure alerts
 * - Back-navigation soft-block while scanning ("Continue in background / Cancel")
 * - Cancel-scan confirmation (elapsed > 30 s) shared with the banner
 *
 * Notably does NOT abort the scan on unmount — the singleton service owns
 * the scan and survives navigation now (see U1/U3 of the background-scan plan).
 */

import { useCallback, useEffect, useRef } from 'react';
import { Alert } from 'react-native';

import { useIsFocused } from '@react-navigation/native';

import { confirmCancelScan } from './cancelScanConfirmation';

export interface UseScanLifecycleOptions {
  /** Current workflow phase (e.g. 'idle', 'scanning', 'candidates', 'suggestions') */
  phase: string;
  /** Cancels the running scan */
  cancelScan: () => void;
  /** Non-null when the scan ended with a user-facing failure */
  scanFailure: { title: string; message: string } | null;
  /** Clears the current scanFailure value */
  clearScanFailure: () => void;
  /** When true the screen was opened with auto-start; affects post-failure navigation */
  autoStart: boolean | undefined;
  /** The screen's navigation object (used for goBack and beforeRemove listener) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  navigation: any;
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

  // Ref that tracks scanning state synchronously to avoid stale closures.
  const scanningRef = useRef(false);
  useEffect(() => {
    scanningRef.current = phase === 'scanning';
  }, [phase]);

  // Show alert when scan finds no photos or no trips, navigate back on dismiss.
  useEffect(() => {
    if (!scanFailure) return;
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
  }, [scanFailure, clearScanFailure, autoStart, navigation]);

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

  // Soften back navigation while scanning: leaving the screen is fine — the
  // scan continues in the background. Offer cancel as the destructive option.
  useEffect(() => {
    const unsubscribe = navigation.addListener(
      'beforeRemove',
      (e: { preventDefault: () => void; data: { action: unknown } }) => {
        if (!scanningRef.current) return;

        e.preventDefault();
        Alert.alert(
          'Scan in Progress',
          'Your scan will keep running in the background. You can return to this screen any time to view results.',
          [
            { text: 'Keep Scanning', style: 'cancel' },
            {
              text: 'Continue in Background',
              onPress: () => navigation.dispatch(e.data.action),
            },
            {
              text: 'Cancel Scan',
              style: 'destructive',
              onPress: () => {
                confirmCancelScan(scanStartTimeRef.current, () => {
                  if (scanningRef.current) {
                    cancelScan();
                  }
                  navigation.dispatch(e.data.action);
                });
              },
            },
          ]
        );
      }
    );
    return unsubscribe;
  }, [navigation, cancelScan]);

  // Cancel with confirmation when scan has been running >30 seconds.
  const handleCancelScan = useCallback(() => {
    confirmCancelScan(scanStartTimeRef.current, cancelScan);
  }, [cancelScan]);

  return { handleCancelScan };
}
