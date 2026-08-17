/**
 * PersistentScanBanner - Hairline progress affordance pinned to the top of the screen.
 *
 * Subscribes to `photoScanStore` and renders a thin 3px progress bar under the
 * status bar:
 * - hidden (idle)
 * - sunset-gold fill (scanning, animated by progress percentage)
 * - moss-green full bar (completed, auto-dismisses after 30s)
 * - adobe-brick full bar (failed)
 *
 * Tapping the bar navigates to PhotoImport for details / cancel / retry. The
 * bar is overlay-positioned with a small invisible hit-slop so it stays out
 * of the page's visual layout — no text or buttons that could overlap screen
 * controls.
 *
 * Visibility is also gated by the focused leaf route — when the user is on a
 * screen in `HIDDEN_TAB_BAR_SCREENS` (PhotoImport, ShareCapture, EntryForm,
 * TripForm, …), the bar hides too.
 */

import React, { useCallback, useEffect, useMemo } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';

import { colors, withAlpha } from '@constants/colors';
import { HIDDEN_TAB_BAR_SCREENS } from '@navigation/hiddenTabBarScreens';
import { consumeResult } from '@services/photoImport';
import {
  selectPhotoScanFailure,
  selectPhotoScanHasResult,
  selectPhotoScanPhase,
  selectPhotoScanProgress,
  usePhotoScanStore,
} from '@stores/photoScanStore';

const COMPLETED_AUTO_DISMISS_MS = 30_000;
const BAR_HEIGHT = 3;
const HIT_SLOP = { top: 0, bottom: 18, left: 0, right: 0 };

interface PersistentScanBannerProps {
  focusedLeaf?: string;
  navigation: BottomTabBarProps['navigation'];
}

export function PersistentScanBanner({ focusedLeaf, navigation }: PersistentScanBannerProps) {
  const phase = usePhotoScanStore(selectPhotoScanPhase);
  const progress = usePhotoScanStore(selectPhotoScanProgress);
  const scanFailure = usePhotoScanStore(selectPhotoScanFailure);
  const hasResult = usePhotoScanStore(selectPhotoScanHasResult);

  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (phase !== 'completed') return;
    const timer = setTimeout(() => {
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

  const handlePress = useCallback(() => {
    navigation.navigate('Passport', { screen: 'PhotoImport' });
  }, [navigation]);

  if (phase === 'idle') return null;
  if (isHiddenRoute) return null;

  let fillWidth = 0;
  let fillColor: string = colors.sunsetGold;
  let accessibilityLabel = '';

  if (phase === 'scanning') {
    const percentage = progress?.percentage ?? 0;
    fillWidth = Math.max(percentage, 4);
    fillColor = colors.sunsetGold;
    accessibilityLabel =
      percentage === 0
        ? 'Photo scan starting, tap for details'
        : `Photo scan in progress, ${percentage}%, tap for details`;
  } else if (phase === 'completed' && hasResult) {
    fillWidth = 100;
    fillColor = colors.success;
    accessibilityLabel = 'Photo scan complete, tap to continue';
  } else if (phase === 'failed' && scanFailure) {
    fillWidth = 100;
    fillColor = colors.adobeBrick;
    accessibilityLabel =
      scanFailure.reason === 'no-trips'
        ? 'No travel photos found, tap for details'
        : 'Photo scan stopped, tap to retry';
  } else {
    return null;
  }

  return (
    <View
      style={[styles.wrapper, { top: insets.top }]}
      pointerEvents="box-none"
      accessibilityLiveRegion="polite"
      accessibilityRole="progressbar"
    >
      <TouchableOpacity
        style={styles.touchTarget}
        onPress={handlePress}
        hitSlop={HIT_SLOP}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        activeOpacity={0.7}
      >
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${fillWidth}%`, backgroundColor: fillColor }]} />
        </View>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 100,
  },
  touchTarget: {
    width: '100%',
  },
  track: {
    height: BAR_HEIGHT,
    width: '100%',
    backgroundColor: withAlpha(colors.midnightNavy, 0.06),
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
  },
});
