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

import { CountryDiscoveryRows } from '@components/photos/CountryDiscoveryRows';
import { PhotoPermissionRecoverySheet } from '@components/photos/PhotoPermissionRecoverySheet';
import type { ScanProgress } from '@services/photoImport';
import { colors } from '@constants/colors';
import { SCAN_COPY } from '@constants/scanCopy';
import { useLeaseKeepsRunning } from '@hooks/useContinuationLeaseState';
import { useReducedMotion } from '@hooks/useReducedMotion';
import {
  selectScanCountryPreviews,
  selectScanPhase,
  useLibraryJobStore,
} from '@stores/libraryJobStore';
import { styles } from '../photoImportStyles';

export interface ScanningPhaseProps {
  scanProgress: ScanProgress | null;
  isIncremental: boolean;
  isPaused?: boolean;
  onCancelScan: () => void;
  /** Set when the service surfaces a recoverable failure mid-scan. */
  scanFailure?: { title: string; message: string; reason?: string } | null;
  /** Called when the user taps Retry from the failed-state branch. */
  onRetryScan?: () => void;
}

export function ScanningPhase({
  scanProgress,
  isIncremental,
  isPaused = false,
  onCancelScan,
  scanFailure,
  onRetryScan,
}: ScanningPhaseProps) {
  // Tier-gated hint: only while a continued-processing lease is actually held.
  const leaseKeepsRunning = useLeaseKeepsRunning();
  const reduceMotion = useReducedMotion();
  const countryPreviews = useLibraryJobStore(selectScanCountryPreviews);
  const jobPhase = useLibraryJobStore(selectScanPhase);
  const isComplete = jobPhase === 'completed' || jobPhase === 'failed';

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
      <View style={styles.discoveryRowsRegion}>
        <CountryDiscoveryRows
          rows={countryPreviews}
          isComplete={isComplete}
          isPaused={isPaused}
          reduceMotion={reduceMotion}
        />
      </View>
      <TouchableOpacity onPress={onCancelScan} style={styles.cancelButton}>
        <Text style={styles.cancelText}>Cancel</Text>
      </TouchableOpacity>
    </View>
  );
}
