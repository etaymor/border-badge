/**
 * Idle phase UI for the photo import screen.
 *
 * Shows privacy notice (first time), scan button, and refresh option.
 *
 * One scan serves two features - trips discovered from the camera roll and
 * Guess Where - so the first-run copy names both payoffs, and the privacy
 * bullets name both upload triggers. Entry points that promise both (e.g.
 * PhotoSyncCard on the passport home) land here, and the promise has to hold.
 */

import React from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';

import { Button } from '@components/ui';
import { PrivacyNotice } from '@components/photos/PrivacyNotice';
import { colors } from '@constants/colors';
import { SCAN_COPY } from '@constants/scanCopy';
import { Analytics } from '@services/analytics';
import { formatLastScanTime } from '../photoImportHelpers';
import { styles } from '../photoImportStyles';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const polaroidsIllustration = require('../../../../assets/illustations/polaroids-illustration.png');

export interface IdlePhaseProps {
  autoStart: boolean | undefined;
  lastImportTime: number | null;
  homeCountryName: string | undefined;
  onStartScan: (forceRefresh: boolean) => void;
  /**
   * Photos already in the cache, used for the magnitude and duration lines.
   * Absent (or 0) renders neither line rather than guessing at a number.
   */
  cachedPhotoCount?: number | null;
}

export function IdlePhase({
  autoStart,
  lastImportTime,
  homeCountryName,
  onStartScan,
  cachedPhotoCount,
}: IdlePhaseProps) {
  // This screen is where the "unlocks Guess Where challenges" promise is made,
  // so the tap is worth counting here rather than relying on the service-level
  // photo_import_scan_started, which fires too deep in the pipeline to know
  // what promised the scan.
  const startScan = (forceRefresh: boolean) => {
    Analytics.photoSyncScanTapped({ isRefresh: forceRefresh, isFirstRun: !lastImportTime });
    onStartScan(forceRefresh);
  };

  const isFirstRun = !lastImportTime;
  const scaleLine = SCAN_COPY.shared.scaleLine(cachedPhotoCount, isFirstRun);
  const durationLine = SCAN_COPY.shared.durationLine(cachedPhotoCount);

  return (
    <View style={styles.idleContainer}>
      {autoStart && lastImportTime ? (
        // Brief loading state while auto-start is initializing
        <>
          <ActivityIndicator size="large" color={colors.sunsetGold} />
          <Text style={styles.idleTitle}>Preparing...</Text>
          <Text style={styles.idleDescription}>
            {SCAN_COPY.trips.scanningTitle('scanning', true)}
          </Text>
        </>
      ) : (
        // Normal idle state for manual start
        <>
          <Image
            source={polaroidsIllustration}
            style={{ width: 120, height: 120 }}
            contentFit="contain"
          />
          {isFirstRun && (
            <PrivacyNotice homeCountryName={homeCountryName} testID="photo-import-privacy" />
          )}
          <Text style={styles.idleTitle}>
            {isFirstRun ? SCAN_COPY.trips.idleTitleFirst : SCAN_COPY.trips.idleTitleReturning}
          </Text>
          <Text style={styles.idleDescription}>
            {isFirstRun ? SCAN_COPY.trips.idleBodyFirst : SCAN_COPY.trips.idleBodyReturning}
          </Text>
          {/* Magnitude and duration appear ONCE, here, where they are context
              rather than a wait the user is watching tick down. */}
          {scaleLine ? (
            <Text style={styles.idleScaleLine} testID="photo-import-scale-line">
              {scaleLine}
            </Text>
          ) : null}
          {durationLine ? (
            <Text style={styles.idleScaleLine} testID="photo-import-duration-line">
              {durationLine}
            </Text>
          ) : null}
          {lastImportTime && (
            <Text style={styles.lastScanText}>
              Last scanned: {formatLastScanTime(lastImportTime)}
            </Text>
          )}
          <Button
            title={isFirstRun ? SCAN_COPY.trips.idleCtaFirst : SCAN_COPY.trips.idleCtaReturning}
            onPress={() => startScan(false)}
            style={styles.scanButton}
          />
          {lastImportTime && (
            <TouchableOpacity onPress={() => startScan(true)} style={styles.refreshLink}>
              <Ionicons name="refresh-outline" size={16} color={colors.sunsetGold} />
              <Text style={styles.refreshLinkText}>Refresh All Photos</Text>
            </TouchableOpacity>
          )}
        </>
      )}
    </View>
  );
}
