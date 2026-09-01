/**
 * Scanning phase UI for the photo import screen.
 *
 * Shows progress bar, country discovery feed, and cancel button. When the
 * service has surfaced a failure, renders the failed-state branch with a
 * Retry button that delegates back to startScan. Permission denials use the
 * shared recovery sheet instead of a generic Scan Failed alert.
 */

import React from 'react';
import { ActivityIndicator, Linking, Text, TouchableOpacity, View } from 'react-native';

import { PhotoPermissionRecoverySheet } from '@components/photos/PhotoPermissionRecoverySheet';
import type { ScanProgress } from '@services/photoImport';
import { colors } from '@constants/colors';
import { SCAN_COPY } from '@constants/scanCopy';
import { useLeaseKeepsRunning } from '@hooks/useContinuationLeaseState';
import { styles } from '../photoImportStyles';

export interface ScanningPhaseProps {
  scanProgress: ScanProgress | null;
  isIncremental: boolean;
  onCancelScan: () => void;
  /** Set when the service surfaces a recoverable failure mid-scan. */
  scanFailure?: { title: string; message: string; reason?: string } | null;
  /** Called when the user taps Retry from the failed-state branch. */
  onRetryScan?: () => void;
}

export function ScanningPhase({
  scanProgress,
  isIncremental,
  onCancelScan,
  scanFailure,
  onRetryScan,
}: ScanningPhaseProps) {
  // Tier-gated hint: only while a continued-processing lease is actually held.
  const leaseKeepsRunning = useLeaseKeepsRunning();

  if (scanFailure) {
    if (scanFailure.reason === 'no-permission') {
      return (
        <View style={styles.scanningContainer} testID="photo-import-permission-recovery">
          <PhotoPermissionRecoverySheet
            variant="denied"
            onOpenSettings={() => {
              Linking.openURL('app-settings:').catch(() => undefined);
            }}
            onRetry={onRetryScan}
          />
        </View>
      );
    }

    return (
      <View style={styles.scanningContainer}>
        <Text style={styles.scanFailedTitle}>{scanFailure.title}</Text>
        <Text style={styles.scanFailedMessage}>{scanFailure.message}</Text>
        {onRetryScan && (
          <TouchableOpacity onPress={onRetryScan} style={styles.retryButton}>
            <Text style={styles.retryText}>Retry Scan</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  return (
    <View style={styles.scanningContainer}>
      <ActivityIndicator size="large" color={colors.sunsetGold} />
      <Text style={styles.scanningTitle}>
        {SCAN_COPY.trips.scanningTitle(scanProgress?.phase, isIncremental)}
      </Text>
      <Text style={styles.scanningProgress}>
        {SCAN_COPY.trips.scanningProgress(
          scanProgress?.current ?? 0,
          scanProgress?.total ?? 0,
          scanProgress?.phase === 'scanning' ? scanProgress?.gpsPhotoCount : undefined
        )}
      </Text>
      <View style={styles.progressBar}>
        <View style={[styles.progressFill, { width: `${scanProgress?.percentage ?? 0}%` }]} />
      </View>
      <Text style={styles.scanningHint}>
        {leaseKeepsRunning
          ? SCAN_COPY.shared.persistenceParagraphWhileLeased('trip-scan')
          : SCAN_COPY.shared.persistenceParagraph}
      </Text>
      {scanProgress?.discoveredCountries && scanProgress.discoveredCountries.length > 0 && (
        // Announced live: this is the longest wait in the app, and the finds
        // are the only evidence anything is happening. The country NAME, not
        // a bare flag - VoiceOver announces regional-indicator pairs
        // inconsistently, so a flag-only line reads as a truncated sentence.
        <View style={styles.discoveryFeed} accessibilityLiveRegion="polite">
          {scanProgress.discoveredCountries.slice(-5).map((country) => (
            <Text key={country.code} style={styles.discoveryItem}>
              {SCAN_COPY.trips.discovery(country.name ?? country.code)}
            </Text>
          ))}
        </View>
      )}
      <TouchableOpacity onPress={onCancelScan} style={styles.cancelButton}>
        <Text style={styles.cancelText}>Cancel</Text>
      </TouchableOpacity>
    </View>
  );
}
