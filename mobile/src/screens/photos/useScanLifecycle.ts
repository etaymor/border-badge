/**
 * useScanLifecycle - Encapsulates scan-related side effects for PhotoImportScreen.
 *
 * Manages:
 * - Keep-awake during scanning
 * - Scan failure alerts
 * - Back-navigation guard while scanning
 * - Cancel-scan confirmation (elapsed > 30 s)
 */

import { useCallback, useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

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
  /** Call this from the Cancel button – shows a confirmation alert when the scan has been running >30 s */
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
  // Ref that tracks scanning state synchronously to avoid stale closures in beforeRemove
  const scanningRef = useRef(false);
  const phaseRef = useRef(phase);
  useEffect(() => {
    scanningRef.current = phase === 'scanning';
    phaseRef.current = phase;
  }, [phase]);

  // Show alert when scan finds no photos or no trips, navigate back on dismiss.
  // Capture phase at alert-show time to avoid TOCTOU race: if the user starts
  // a new scan while the alert is visible, phaseRef would have changed by the
  // time they press OK, incorrectly skipping navigation.
  useEffect(() => {
    if (!scanFailure) return;
    const phaseWhenShown = phaseRef.current;
    Alert.alert(scanFailure.title, scanFailure.message, [
      {
        text: 'OK',
        onPress: () => {
          clearScanFailure();
          if (autoStart && phaseWhenShown === 'idle') {
            navigation.goBack();
          }
        },
      },
    ]);
  }, [scanFailure, clearScanFailure, autoStart, navigation]);

  // Keep screen awake during scanning
  useEffect(() => {
    if (phase === 'scanning') {
      activateKeepAwakeAsync('photo-scan').catch((err) => {
        if (__DEV__) console.warn('[PhotoImport] Failed to activate keep-awake:', err);
      });
    } else {
      deactivateKeepAwake('photo-scan');
    }
    return () => {
      deactivateKeepAwake('photo-scan');
    };
  }, [phase]);

  // Abort scan on unmount (e.g., app backgrounding) when navigation guards don't fire
  const cancelScanRef = useRef(cancelScan);
  cancelScanRef.current = cancelScan;
  useEffect(() => {
    return () => {
      if (scanningRef.current) {
        cancelScanRef.current();
      }
    };
  }, []);

  // Track scan start time for cancel confirmation
  const scanStartTimeRef = useRef<number | null>(null);
  useEffect(() => {
    if (phase === 'scanning') {
      scanStartTimeRef.current = Date.now();
    } else {
      scanStartTimeRef.current = null;
    }
  }, [phase]);

  // Block back navigation during scanning with confirmation.
  // Uses scanningRef to avoid stale closure when phase updates on the same tick.
  useEffect(() => {
    const unsubscribe = navigation.addListener(
      'beforeRemove',
      (e: { preventDefault: () => void; data: { action: unknown } }) => {
        if (!scanningRef.current) return;

        e.preventDefault();
        Alert.alert('Scan in Progress', "If you leave now, you'll need to restart the scan.", [
          { text: 'Keep Scanning', style: 'cancel' },
          {
            text: 'Stop Scan',
            style: 'destructive',
            onPress: () => {
              // Guard: scan may have completed while the alert was visible
              if (scanningRef.current) {
                cancelScan();
              }
              navigation.dispatch(e.data.action);
            },
          },
        ]);
      }
    );
    return unsubscribe;
  }, [navigation, cancelScan]);

  // Cancel with confirmation when scan has been running >30 seconds
  const handleCancelScan = useCallback(() => {
    const elapsed = scanStartTimeRef.current ? Date.now() - scanStartTimeRef.current : 0;
    if (elapsed > 30000) {
      Alert.alert('Cancel Scan?', 'Your scan is in progress. Are you sure you want to cancel?', [
        { text: 'Keep Scanning', style: 'cancel' },
        { text: 'Cancel Scan', style: 'destructive', onPress: cancelScan },
      ]);
    } else {
      cancelScan();
    }
  }, [cancelScan]);

  return { handleCancelScan };
}
