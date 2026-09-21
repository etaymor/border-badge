/**
 * BuildProgressSheet - the wizard's working phase.
 *
 * The navy hero hosts one stage card (`QuizWorkingStage`): the live scan
 * shelf while the library is being read, then the same card's slot grid once
 * photos start landing. The cream sheet under it is the shared scan body —
 * title, counter, one rotating line, and the first-scan action row.
 *
 * The build reads as ONE continuous process: `pickUris` is append-only from
 * the first find through the last upload, and the counter never restarts.
 * Leaving the scanning step passes `isComplete` for one render so the arrival
 * queue drains before the slot grid takes the card.
 */

import { useEffect, useState } from 'react';
import { Image } from 'expo-image';
import { View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { ScanSheetBody } from '@components/photos/ScanSheetBody';
import { ScanStage } from '@components/photos/ScanStage';
import { StageCard } from '@components/photos/StageCard';
import { SCAN_COPY } from '@constants/scanCopy';
import { useLeaseKeepsRunning } from '@hooks/useContinuationLeaseState';

import { DURATION_BASE } from '../components/motionTokens';
import { styles } from './quizCreationStyles';
import type { BuildView } from './useQuizCreationFlow';

interface QuizWorkingStageProps {
  build: BuildView;
  reduceMotion: boolean;
  isPaused: boolean;
}

export function QuizWorkingStage({ build, reduceMotion, isPaused }: QuizWorkingStageProps) {
  const { step, pickUris, uploading, uploadedCount } = build;
  const showCountryPreviews = step === 'scanning';
  const [discoveryLayerVisible, setDiscoveryLayerVisible] = useState(showCountryPreviews);

  useEffect(() => {
    setDiscoveryLayerVisible(showCountryPreviews);
  }, [showCountryPreviews]);

  return (
    <View style={styles.permissionHeroCardArea} testID="quiz-build-content-region">
      <StageCard>
        {discoveryLayerVisible ? (
          <ScanStage
            rows={build.countryPreviews}
            isComplete={!showCountryPreviews}
            isPaused={isPaused}
            reduceMotion={reduceMotion}
          />
        ) : (
          <View style={styles.slotStageHost}>
            <SlotGrid
              pickUris={pickUris}
              slotTotal={build.slotTotal}
              uploading={uploading}
              uploadedCount={uploadedCount}
              reduceMotion={reduceMotion}
            />
          </View>
        )}
      </StageCard>
    </View>
  );
}

interface BuildProgressSheetProps {
  build: BuildView;
  isFirstScan: boolean;
  reduceMotion: boolean;
  onLeave: () => void;
  onStop: () => void;
}

export function BuildProgressSheet({
  build,
  isFirstScan,
  reduceMotion,
  onLeave,
  onStop,
}: BuildProgressSheetProps) {
  const leaseKeepsRunning = useLeaseKeepsRunning();

  return (
    <View testID="quiz-progress">
      <ScanSheetBody
        title={SCAN_COPY.quiz.workingTitle}
        current={build.foundCount}
        total={build.foundTotal}
        barFraction={build.barFraction}
        lines={SCAN_COPY.shared.stageLines('quiz-build', { leased: leaseKeepsRunning })}
        reduceMotion={reduceMotion}
        showActions={isFirstScan && !build.uploading}
        onLeave={onLeave}
        onStop={onStop}
      />
    </View>
  );
}

interface SlotGridProps {
  pickUris: string[];
  slotTotal: number;
  uploading: boolean;
  uploadedCount: number;
  reduceMotion: boolean;
}

function SlotGrid({ pickUris, slotTotal, uploading, uploadedCount, reduceMotion }: SlotGridProps) {
  return (
    <View style={styles.slotGrid}>
      {Array.from({ length: slotTotal }, (_, index) => {
        const uri = pickUris[index];
        return (
          <View key={index} style={styles.slotWrapper}>
            <View style={styles.slot}>
              <View
                style={styles.slotPlaceholder}
                testID={uri ? undefined : `quiz-slot-empty-${index}`}
              >
                <SlotPlaceholderMark />
              </View>
              {uri ? (
                <Animated.View
                  entering={reduceMotion ? undefined : FadeIn.duration(DURATION_BASE)}
                  style={[
                    styles.slotPhotoLayer,
                    uploading && index >= uploadedCount && styles.slotPhotoPending,
                  ]}
                >
                  <Image
                    source={{ uri }}
                    style={styles.slotPhoto}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                    testID={`quiz-slot-photo-${index}`}
                  />
                </Animated.View>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

/**
 * A neutral slot placeholder: paper-beige fill with a minimal image-outline
 * mark drawn from plain views (rounded frame, a small sun, a peak). Never a
 * blurred or faded photo - unfound slots stay honestly empty.
 */
function SlotPlaceholderMark() {
  return (
    <View style={styles.slotMarkFrame}>
      <View style={styles.slotMarkSun} />
      <View style={styles.slotMarkPeak} />
    </View>
  );
}
