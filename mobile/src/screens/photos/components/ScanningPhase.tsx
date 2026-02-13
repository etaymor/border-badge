/**
 * Scanning phase UI for the photo import screen.
 *
 * Shows progress bar, country discovery feed, and cancel button.
 */

import React from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';

import type { ScanProgress } from '@services/photoImport';
import { colors } from '@constants/colors';
import { getFlagEmoji } from '@utils/flags';
import { styles } from '../photoImportStyles';

export interface ScanningPhaseProps {
  scanProgress: ScanProgress | null;
  isIncremental: boolean;
  onCancelScan: () => void;
}

export function ScanningPhase({ scanProgress, isIncremental, onCancelScan }: ScanningPhaseProps) {
  return (
    <View style={styles.scanningContainer}>
      <ActivityIndicator size="large" color={colors.sunsetGold} />
      <Text style={styles.scanningTitle}>
        {scanProgress?.phase === 'geocoding'
          ? 'Identifying Countries...'
          : isIncremental
            ? 'Checking for New Photos...'
            : 'Scanning Photos...'}
      </Text>
      <Text style={styles.scanningProgress}>
        {scanProgress?.current ?? 0} / {scanProgress?.total ?? 0}
        {scanProgress?.phase === 'scanning' &&
          scanProgress?.gpsPhotoCount !== undefined &&
          ` (${scanProgress.gpsPhotoCount} with GPS)`}
      </Text>
      <View style={styles.progressBar}>
        <View style={[styles.progressFill, { width: `${scanProgress?.percentage ?? 0}%` }]} />
      </View>
      <Text style={styles.scanningHint}>
        Please keep the app open while we scan your photos. This usually takes 1-3 minutes.
      </Text>
      {scanProgress?.discoveredCountries && scanProgress.discoveredCountries.length > 0 && (
        <View style={styles.discoveryFeed}>
          {scanProgress.discoveredCountries.slice(-5).map((country) => (
            <Text key={country.code} style={styles.discoveryItem}>
              Found photos from {getFlagEmoji(country.code)}
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
