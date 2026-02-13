/**
 * Idle phase UI for the photo import screen.
 *
 * Shows privacy notice (first time), scan button, and refresh option.
 */

import React from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';

import { Button } from '@components/ui';
import { colors } from '@constants/colors';
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
                {'\u2022'} Nothing is uploaded until you choose to save a place
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
              : 'Scan your photo library to find travel photos and create entries automatically based on where they were taken.'}
          </Text>
          {lastImportTime && (
            <Text style={styles.lastScanText}>
              Last scanned: {formatLastScanTime(lastImportTime)}
            </Text>
          )}
          <Button
            title={lastImportTime ? 'Check for New Photos' : 'Start Scan'}
            onPress={() => onStartScan(false)}
            style={styles.scanButton}
          />
          {lastImportTime && (
            <TouchableOpacity onPress={() => onStartScan(true)} style={styles.refreshLink}>
              <Ionicons name="refresh-outline" size={16} color={colors.sunsetGold} />
              <Text style={styles.refreshLinkText}>Refresh All Photos</Text>
            </TouchableOpacity>
          )}
        </>
      )}
    </View>
  );
}
