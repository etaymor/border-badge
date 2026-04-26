/**
 * PersistentScanBanner - Global scan progress affordance pinned above the tab bar.
 *
 * Subscribes to `photoScanStore` and renders one of:
 * - hidden (idle)
 * - "Starting scan…" with spinner (scanning, 0% progress)
 * - "Scanning photos · NN%" with bar + Cancel (scanning, >0% progress)
 * - "Scan complete — tap to continue" (auto-dismisses after 30s)
 * - "Scan stopped — tap to retry" (failed, recoverable)
 * - "No travel photos found — tap for details" (failed, no-trips → routes to screen)
 *
 * Visibility is also gated by the focused leaf route — when the user is on a
 * screen in `HIDDEN_TAB_BAR_SCREENS` (PhotoImport, ShareCapture, EntryForm,
 * TripForm, …), the banner hides too. One rule covers both cases. The list
 * lives in `@navigation/hiddenTabBarScreens` so MainTabNavigator and this
 * banner share a single source of truth.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';

import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { HIDDEN_TAB_BAR_SCREENS } from '@navigation/hiddenTabBarScreens';
import { confirmCancelScan } from '@screens/photos/cancelScanConfirmation';
import {
  cancelScan as cancelServiceScan,
  consumeResult,
  getLastStartOptions,
  getScanStartedAt,
  startScan as startServiceScan,
} from '@services/photoImport';
import {
  selectPhotoScanFailure,
  selectPhotoScanHasResult,
  selectPhotoScanPhase,
  selectPhotoScanProgress,
  usePhotoScanStore,
} from '@stores/photoScanStore';
import { useOnboardingStore, selectHomeCountry } from '@stores/onboardingStore';

const COMPLETED_AUTO_DISMISS_MS = 30_000;

interface PersistentScanBannerProps {
  focusedLeaf?: string;
  navigation: BottomTabBarProps['navigation'];
}

export function PersistentScanBanner({ focusedLeaf, navigation }: PersistentScanBannerProps) {
  const phase = usePhotoScanStore(selectPhotoScanPhase);
  const progress = usePhotoScanStore(selectPhotoScanProgress);
  const scanFailure = usePhotoScanStore(selectPhotoScanFailure);
  const hasResult = usePhotoScanStore(selectPhotoScanHasResult);
  const homeCountry = useOnboardingStore(selectHomeCountry);

  const insets = useSafeAreaInsets();

  const [isCancelling, setIsCancelling] = useState(false);

  // Auto-dismiss the completed state after 30s of inactivity.
  useEffect(() => {
    if (phase !== 'completed') return;
    const timer = setTimeout(() => {
      // Drop the result if the user never tapped through, then return store to idle.
      consumeResult();
      usePhotoScanStore.setState({ phase: 'idle', hasResult: false });
    }, COMPLETED_AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  const isHiddenRoute = useMemo(
    () =>
      focusedLeaf ? (HIDDEN_TAB_BAR_SCREENS as readonly string[]).includes(focusedLeaf) : false,
    [focusedLeaf]
  );

  const handleNavigateToPhotoImport = useCallback(() => {
    navigation.navigate('Passport', { screen: 'PhotoImport' });
  }, [navigation]);

  const handleCancel = useCallback(() => {
    // Pass the actual scan start time so the >30s confirmation alert fires
    // (banner used to pass null which always skipped the confirmation).
    confirmCancelScan(getScanStartedAt(), () => {
      setIsCancelling(true);
      cancelServiceScan();
      // Snap back so the next scan doesn't see stale UI state.
      setTimeout(() => setIsCancelling(false), 500);
    });
  }, []);

  const handleRetry = useCallback(() => {
    if (!homeCountry) {
      Alert.alert('Set Home Country', 'Please set your home country in settings to start a scan.');
      return;
    }
    // Replay the last scan's options so retry preserves filterCountryCode etc.
    // Falls back to a minimal options object on first-ever retry (no history).
    const opts = getLastStartOptions() ?? { homeCountry };
    void startServiceScan(opts);
  }, [homeCountry]);

  // ---- Visibility ----
  if (phase === 'idle') return null;
  if (isHiddenRoute) return null;

  const containerStyle = [
    styles.container,
    { bottom: insets.bottom + 60 }, // sit above the bottom tab bar height
  ];

  // ---- Failed states ----
  if (phase === 'failed' && scanFailure) {
    if (scanFailure.reason === 'no-trips') {
      return (
        <TouchableOpacity
          style={containerStyle}
          onPress={handleNavigateToPhotoImport}
          accessibilityRole="button"
          accessibilityLabel="No travel photos found, tap for details"
        >
          <Text style={styles.label}>No travel photos found — tap for details</Text>
        </TouchableOpacity>
      );
    }
    return (
      <View style={containerStyle}>
        <TouchableOpacity
          style={styles.tappableArea}
          onPress={handleRetry}
          accessibilityRole="button"
          accessibilityLabel="Scan stopped, tap to retry"
        >
          <Text style={styles.label}>Scan stopped — tap to retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ---- Completed ----
  if (phase === 'completed' && hasResult) {
    return (
      <TouchableOpacity
        style={containerStyle}
        onPress={handleNavigateToPhotoImport}
        accessibilityRole="button"
        accessibilityLabel="Scan complete, tap to continue"
      >
        <Text style={styles.label}>Scan complete — tap to continue</Text>
      </TouchableOpacity>
    );
  }

  // ---- Scanning ----
  if (phase === 'scanning') {
    const percentage = progress?.percentage ?? 0;
    return (
      <View style={containerStyle} accessibilityLiveRegion="polite" accessibilityRole="progressbar">
        <TouchableOpacity
          style={styles.tappableArea}
          onPress={handleNavigateToPhotoImport}
          accessibilityRole="button"
          accessibilityLabel="View scan in progress"
        >
          {percentage === 0 ? (
            <View style={styles.row}>
              <ActivityIndicator size="small" color={colors.sunsetGold} />
              <Text style={styles.label}>Starting scan…</Text>
            </View>
          ) : (
            <>
              <Text style={styles.label}>
                {isCancelling ? 'Cancelling…' : `Scanning photos · ${percentage}%`}
              </Text>
              <View style={styles.progressBar}>
                <View style={[styles.progressFill, { width: `${percentage}%` }]} />
              </View>
            </>
          )}
        </TouchableOpacity>
        {!isCancelling && (
          <TouchableOpacity
            onPress={handleCancel}
            style={styles.cancelButton}
            accessibilityRole="button"
            accessibilityLabel="Cancel scan"
          >
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 12,
    right: 12,
    backgroundColor: colors.white,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 6,
    zIndex: 100,
  },
  tappableArea: {
    minHeight: 44,
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  label: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 14,
    color: colors.midnightNavy,
  },
  progressBar: {
    marginTop: 6,
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.sunsetGold,
  },
  cancelButton: {
    marginTop: 6,
    alignSelf: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  cancelText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 13,
    color: colors.adobeBrick,
  },
});
