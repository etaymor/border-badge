/**
 * Scanning phase UI for the photo import screen.
 *
 * A live scan uses the same stage card and sheet as the quiz build: navy
 * hero, framed card, then title, counter, one rotating line, and — on a
 * first scan — Leave It Running plus Stop. Stop still confirms before it
 * cancels. A surfaced failure keeps the recovery / retry branch.
 */

import { Linking, StatusBar, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScanSheetBody } from '@components/photos/ScanSheetBody';
import { ScanStage } from '@components/photos/ScanStage';
import { StageCard } from '@components/photos/StageCard';
import { PhotoPermissionRecoverySheet } from '@components/photos/PhotoPermissionRecoverySheet';
import { GlassBackButton } from '@components/ui';
import type { ScanProgress } from '@services/photoImport';
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
  /** Leave the screen without stopping the job. */
  onLeave: () => void;
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
  onLeave,
  scanFailure,
  onRetryScan,
}: ScanningPhaseProps) {
  const insets = useSafeAreaInsets();
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

  const current = scanProgress?.current ?? 0;
  const total = scanProgress?.total ?? 0;

  return (
    <View style={styles.scanStageLayout} testID="photo-import-scan-stage">
      <StatusBar barStyle="light-content" />
      <View style={[styles.permissionHero, { paddingTop: insets.top }]}>
        <View style={styles.permissionHeroHeader}>
          <GlassBackButton variant="dark" onPress={onLeave} />
          <View style={styles.headerSpacer} />
        </View>
        <View style={styles.permissionHeroCardArea}>
          <StageCard>
            <ScanStage
              rows={countryPreviews}
              isComplete={isComplete}
              isPaused={isPaused}
              reduceMotion={reduceMotion}
            />
          </StageCard>
        </View>
      </View>
      <View style={[styles.permissionCarouselContainer, { paddingBottom: insets.bottom + 12 }]}>
        <ScanSheetBody
          title={SCAN_COPY.trips.stageTitle}
          current={current}
          total={total}
          barFraction={(scanProgress?.percentage ?? 0) / 100}
          lines={SCAN_COPY.shared.stageLines('trip-scan', { leased: leaseKeepsRunning })}
          reduceMotion={reduceMotion}
          showActions={!isIncremental}
          onLeave={onLeave}
          onStop={onCancelScan}
          leaveTestID="photo-import-leave"
          stopTestID="photo-import-stop"
        />
      </View>
    </View>
  );
}
