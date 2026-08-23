/**
 * PersistentScanBanner - Hairline progress affordance pinned to the top of the
 * screen, shared by every long-running library job.
 *
 * Renders a thin 3px bar under the status bar:
 * - hidden (idle)
 * - sunset-gold fill (running, animated by progress percentage)
 * - moss-green full bar (completed)
 * - adobe-brick full bar (failed)
 *
 * Tapping navigates to wherever that job's detail lives. Visibility is gated
 * by the focused leaf route, so it hides on screens in HIDDEN_TAB_BAR_SCREENS.
 *
 * TWO JOBS, ONE BAR. The trip scan and the Guess Where build cannot run at the
 * same time (they contend for the same photo cache), so one bar is enough — but
 * it has to say WHICH job is running, because "your challenge is ready" and
 * "photo scan complete" send the user to completely different places. That
 * choice is `selectActiveJob`'s, not this component's: both kinds now report
 * through `libraryJobStore`, so there is one phase to read rather than two to
 * reconcile.
 */

import React, { useCallback, useEffect, useMemo } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import type { NavigationProp } from '@react-navigation/native';

import type { RootStackParamList } from '@navigation/types';

import { colors, withAlpha } from '@constants/colors';
import { SCAN_COPY } from '@constants/scanCopy';
import { useLeaseKeepsRunning } from '@hooks/useContinuationLeaseState';
import { HIDDEN_TAB_BAR_SCREENS } from '@navigation/hiddenTabBarScreens';
import { consumeResult } from '@services/photoImport';
import { patchJobSlice, selectActiveJob, useLibraryJobStore } from '@stores/libraryJobStore';

const COMPLETED_AUTO_DISMISS_MS = 30_000;
const BAR_HEIGHT = 3;
const HIT_SLOP = { top: 0, bottom: 18, left: 0, right: 0 };

interface PersistentScanBannerProps {
  focusedLeaf?: string;
  navigation: BottomTabBarProps['navigation'];
}

type BarState = 'running' | 'completed' | 'failed';

interface BarView {
  kind: 'trip-scan' | 'quiz-build';
  state: BarState;
  percentage: number;
  label: string;
  hint: string;
}

export function PersistentScanBanner({ focusedLeaf, navigation }: PersistentScanBannerProps) {
  // Subscribe to the `jobs` map, not to `selectActiveJob` directly: that
  // selector builds a fresh view object on every call, and zustand v5 feeds
  // the selector straight to `useSyncExternalStore`, which would see a new
  // snapshot on every render. `jobs` is a stable reference between writes.
  const jobs = useLibraryJobStore((s) => s.jobs);
  const active = useMemo(() => selectActiveJob({ jobs }), [jobs]);
  // Tier-gated: true only while a continued-processing lease is actually
  // running. `pending` / `expired` / grace render today's hint unchanged.
  const leaseKeepsRunning = useLeaseKeepsRunning();

  const insets = useSafeAreaInsets();

  // The trip scan's result is cheap to recompute, so letting the bar expire
  // also drops it. The quiz build is deliberately NOT auto-consumed: its
  // outcome is a finished challenge, and discarding one after a green flash
  // would lose real work. Its bar hides, the result waits for a screen.
  const scanCompleted = active?.kind === 'trip-scan' && active.phase === 'completed';
  useEffect(() => {
    if (!scanCompleted) return;
    const timer = setTimeout(() => {
      consumeResult();
      patchJobSlice('trip-scan', { phase: 'idle', hasResult: false });
    }, COMPLETED_AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [scanCompleted]);

  const isHiddenRoute = useMemo(
    () =>
      focusedLeaf ? (HIDDEN_TAB_BAR_SCREENS as readonly string[]).includes(focusedLeaf) : false,
    [focusedLeaf]
  );

  const view = useMemo<BarView | null>(() => {
    if (!active) return null;

    if (active.phase === 'running' || active.phase === 'waiting') {
      const copyState = active.phase === 'waiting' ? 'waiting' : 'running';
      const hint = SCAN_COPY.banner.hint(active.kind, copyState);
      return {
        kind: active.kind,
        state: 'running',
        percentage: active.percentage,
        label: SCAN_COPY.banner.label(active.kind, copyState, active.percentage),
        hint:
          leaseKeepsRunning && active.phase === 'running'
            ? `${hint}. ${SCAN_COPY.shared.leaveHintWhileLeased(active.kind)}`
            : hint,
      };
    }

    if (active.phase === 'completed' && active.hasResult) {
      return {
        kind: active.kind,
        state: 'completed',
        percentage: 100,
        label: SCAN_COPY.banner.label(active.kind, 'completed', 100),
        hint: SCAN_COPY.banner.hint(active.kind, 'completed'),
      };
    }

    if (active.phase === 'failed' && active.failure) {
      return {
        kind: active.kind,
        state: 'failed',
        percentage: 100,
        label: SCAN_COPY.banner.label(active.kind, 'failed', 100, active.failure.reason),
        hint: SCAN_COPY.banner.hint(active.kind, 'failed'),
      };
    }

    return null;
  }, [active, leaseKeepsRunning]);

  const handlePress = useCallback(() => {
    if (!view) return;
    if (view.kind === 'trip-scan') {
      navigation.navigate('Passport', { screen: 'PhotoImport' });
      return;
    }
    // QuizPlay / QuizCreation live on the ROOT stack, but this bar is rendered
    // from the tab navigator's tabBar slot — so its `navigation` cannot resolve
    // them. Hop to the parent before navigating.
    const root = (navigation.getParent() ??
      navigation) as unknown as NavigationProp<RootStackParamList>;
    const route = active?.resultRoute;
    const quizId = route?.params?.quizId;
    if (route?.screen === 'QuizPlay' && typeof quizId === 'string') {
      root.navigate('QuizPlay', { quizId });
      return;
    }
    root.navigate('QuizCreation', { entryPoint: 'scan_banner' });
  }, [view, navigation, active?.resultRoute]);

  if (!view) return null;
  if (isHiddenRoute) return null;

  const fillWidth = view.state === 'running' ? Math.max(view.percentage, 4) : 100;
  const fillColor =
    view.state === 'completed'
      ? colors.success
      : view.state === 'failed'
        ? colors.adobeBrick
        : colors.sunsetGold;

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
        accessibilityLabel={view.label}
        accessibilityHint={view.hint}
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
