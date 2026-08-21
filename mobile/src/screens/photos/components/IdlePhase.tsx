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
import { colors } from '@constants/colors';
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
}

export function IdlePhase({
  autoStart,
  lastImportTime,
  homeCountryName,
  onStartScan,
}: IdlePhaseProps) {
  // This screen is where the "unlocks Guess Where challenges" promise is made,
  // so the tap is worth counting here rather than relying on the service-level
  // photo_import_scan_started, which fires too deep in the pipeline to know
  // what promised the scan.
  const startScan = (forceRefresh: boolean) => {
    Analytics.photoSyncScanTapped({ isRefresh: forceRefresh, isFirstRun: !lastImportTime });
    onStartScan(forceRefresh);
  };

  return (
    <View style={styles.idleContainer}>
      {autoStart && lastImportTime ? (
        // Brief loading state while auto-start is initializing
        <>
          <ActivityIndicator size="large" color={colors.sunsetGold} />
          <Text style={styles.idleTitle}>Preparing...</Text>
          <Text style={styles.idleDescription}>Checking for new photos...</Text>
        </>
      ) : (
        // Normal idle state for manual start
        <>
          <Image
            source={polaroidsIllustration}
            style={{ width: 120, height: 120 }}
            contentFit="contain"
          />
          {!lastImportTime && (
            <View style={styles.privacyNotice}>
              <Text style={styles.privacyTitle}>Your photos stay private</Text>
              <Text style={styles.privacyBullet}>
                {'\u2022'} Only GPS data from photos outside{' '}
                {homeCountryName ?? 'your home country'} is scanned
              </Text>
              <Text style={styles.privacyBullet}>
                {'\u2022'} Nothing is uploaded until you save a place or share a challenge
              </Text>
              <Text style={styles.privacyBullet}>
                {'\u2022'} The scan runs entirely on your device
              </Text>
            </View>
          )}
          <Text style={styles.idleTitle}>
            {lastImportTime ? 'Import Travel Photos' : 'Ready to scan'}
          </Text>
          <Text style={styles.idleDescription}>
            {lastImportTime
              ? 'Check for new photos since your last scan, or refresh to re-scan your entire library.'
              : 'One scan of your library builds trips from where your photos were taken, and unlocks Guess Where challenges.'}
          </Text>
          {lastImportTime && (
            <Text style={styles.lastScanText}>
              Last scanned: {formatLastScanTime(lastImportTime)}
            </Text>
          )}
          <Button
            title={lastImportTime ? 'Check for New Photos' : 'Start Scan'}
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
