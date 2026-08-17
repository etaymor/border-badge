/**
 * Shared cancel-scan confirmation helper.
 *
 * Both the in-screen Cancel button and the persistent banner cancel affordance
 * route through this so they have identical UX. Above 30 seconds of elapsed
 * scan time, we surface a "are you sure" alert; under 30s we cancel directly.
 */

import { Alert } from 'react-native';

const CANCEL_CONFIRM_THRESHOLD_MS = 30_000;

/**
 * Show the cancel-scan confirmation if the scan has been running long enough
 * to be worth protecting. Calls `onConfirm` directly when the elapsed time is
 * below the threshold or after the user confirms.
 *
 * Pass `scanStartedAt` as the timestamp the scan began, or null when the
 * caller doesn't track it (banner case) — null falls back to "skip the
 * confirmation" because the banner can't know exactly when the scan started.
 */
export function confirmCancelScan(scanStartedAt: number | null, onConfirm: () => void): void {
  const elapsed = scanStartedAt != null ? Date.now() - scanStartedAt : 0;
  if (elapsed > CANCEL_CONFIRM_THRESHOLD_MS) {
    Alert.alert('Cancel Scan?', 'Your scan is in progress. Are you sure you want to cancel?', [
      { text: 'Keep Scanning', style: 'cancel' },
      { text: 'Cancel Scan', style: 'destructive', onPress: onConfirm },
    ]);
  } else {
    onConfirm();
  }
}
