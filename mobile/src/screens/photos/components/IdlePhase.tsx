/**
 * Idle phase for the photo import screen.
 *
 * The same navy stage as the carousel and the live scan. A first run holds
 * beat 3 on its last frame; a return visit holds the reading grid still.
 * Allow Full Access already consented, so this screen is only the start
 * button for someone who arrived with access already granted.
 */

import { ActivityIndicator, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrivacyLockGlyph } from '@components/photos/PrivacyLockGlyph';
import { StageHero } from '@components/photos/StageHero';
import PassportBeat from '@components/photos/permissionBeats/PassportBeat';
import { Button, GlassBackButton } from '@components/ui';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { SCAN_COPY } from '@constants/scanCopy';
import { useReducedMotion } from '@hooks/useReducedMotion';
import { Analytics } from '@services/analytics';

import { formatLastScanTime } from '../photoImportHelpers';
import { styles } from '../photoImportStyles';

export interface IdlePhaseProps {
  autoStart: boolean | undefined;
  lastImportTime: number | null;
  homeCountry?: string | null;
  onStartScan: (forceRefresh: boolean) => void;
  onLeave: () => void;
  /**
   * Photos already in the cache. Absent or 0 omits the magnitude line
   * rather than guessing at a number.
   */
  cachedPhotoCount?: number | null;
}

export function IdlePhase({
  autoStart,
  lastImportTime,
  homeCountry,
  onStartScan,
  onLeave,
  cachedPhotoCount,
}: IdlePhaseProps) {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const isFirstRun = !lastImportTime;
  const magnitude = SCAN_COPY.shared.scaleAndDurationLine(cachedPhotoCount);

  const startScan = (forceRefresh: boolean) => {
    Analytics.photoSyncScanTapped({ isRefresh: forceRefresh, isFirstRun: !lastImportTime });
    onStartScan(forceRefresh);
  };

  if (autoStart && lastImportTime) {
    return (
      <View style={[styles.idleContainer, sheetStyles.preparing]}>
        <ActivityIndicator size="large" color={colors.sunsetGold} />
        <Text style={styles.idleTitle}>Preparing...</Text>
        <Text style={styles.idleDescription}>
          {SCAN_COPY.trips.scanningTitle('scanning', true)}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.scanStageLayout} testID="photo-import-idle">
      <StatusBar barStyle="light-content" />
      <StageHero
        titleless
        header={
          <View style={[styles.permissionHeroHeader, { paddingTop: insets.top }]}>
            <GlassBackButton variant="dark" onPress={onLeave} />
            <View style={styles.headerSpacer} />
          </View>
        }
      >
        <PassportBeat isActive={false} reduceMotion={reduceMotion} homeCountry={homeCountry} />
      </StageHero>
      <View style={[styles.permissionCarouselContainer, { paddingBottom: insets.bottom + 12 }]}>
        <View style={sheetStyles.body}>
          <Text style={sheetStyles.title}>
            {isFirstRun ? SCAN_COPY.trips.idleTitleFirst : SCAN_COPY.trips.idleTitleReturning}
          </Text>
          {isFirstRun && magnitude ? (
            <Text style={sheetStyles.detail} testID="photo-import-scale-line">
              {magnitude}
            </Text>
          ) : null}
          {!isFirstRun && lastImportTime ? (
            <Text style={sheetStyles.detail} testID="photo-import-last-scanned">
              {SCAN_COPY.trips.lastScannedLine(formatLastScanTime(lastImportTime))}
            </Text>
          ) : null}
          <Button
            title={isFirstRun ? SCAN_COPY.trips.idleCtaFirst : SCAN_COPY.trips.idleCtaReturning}
            onPress={() => startScan(false)}
            style={styles.scanButton}
          />
          {isFirstRun ? (
            <View style={sheetStyles.footer} testID="photo-import-lock-footer">
              <PrivacyLockGlyph testID="photo-import-lock" />
              <Text style={sheetStyles.footerText}>
                {SCAN_COPY.permission.carousel.footerNotice}
              </Text>
            </View>
          ) : (
            <Pressable
              onPress={() => startScan(true)}
              accessibilityRole="button"
              hitSlop={8}
              style={sheetStyles.refresh}
              testID="photo-import-refresh"
            >
              <Text style={styles.refreshLinkText}>Refresh All Photos</Text>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}

const sheetStyles = StyleSheet.create({
  preparing: {
    backgroundColor: colors.warmCream,
  },
  body: {
    alignItems: 'center',
    gap: 14,
    paddingTop: 8,
  },
  title: {
    fontFamily: fonts.playfair.bold,
    fontSize: 26,
    lineHeight: 32,
    color: colors.midnightNavy,
    textAlign: 'center',
  },
  detail: {
    fontFamily: fonts.body.regular,
    fontSize: 15,
    lineHeight: 22,
    color: colors.stormGray,
    textAlign: 'center',
  },
  footer: {
    minHeight: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingHorizontal: 8,
  },
  footerText: {
    flexShrink: 1,
    fontFamily: fonts.body.regular,
    fontSize: 13,
    lineHeight: 18,
    color: colors.stormGray,
    textAlign: 'center',
  },
  refresh: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
});
