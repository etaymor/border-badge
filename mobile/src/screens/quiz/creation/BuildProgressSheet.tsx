/**
 * BuildProgressSheet - the wizard's working phase: what a user stares at for
 * up to ninety seconds.
 *
 * The build reads as ONE continuous process, because it is: the job locks each
 * photo into its slot as it is found (`pickLedger`), so `pickUris` is
 * append-only from the first find through the last upload. This component
 * holds up its end - one meter spanning both steps and a counter that never
 * restarts. Both used to reset at the hunt/upload handover, on top of a photo
 * list that changed underneath them, which read as the build crashing and
 * starting over.
 */

import { Image } from 'expo-image';
import { Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { Button } from '@components/ui/Button';
import { SCAN_COPY } from '@constants/scanCopy';
import { useLeaseKeepsRunning } from '@hooks/useContinuationLeaseState';

import { DURATION_BASE } from '../components/motionTokens';
import { styles } from './quizCreationStyles';
import type { BuildView } from './useQuizCreationFlow';

interface BuildProgressSheetProps {
  build: BuildView;
  isFirstScan: boolean;
  durationLine: string;
  reduceMotion: boolean;
  onLeave: () => void;
  onStop: () => void;
}

export function BuildProgressSheet({
  build,
  isFirstScan,
  durationLine,
  reduceMotion,
  onLeave,
  onStop,
}: BuildProgressSheetProps) {
  const { step, pickUris, uploading, uploadedCount, barFraction } = build;
  // Tier-gated hint: only while a continued-processing lease is actually held.
  const leaseKeepsRunning = useLeaseKeepsRunning();

  return (
    <View style={styles.sheetContent} testID="quiz-progress">
      <Text style={styles.title}>{SCAN_COPY.quiz.workingTitle}</Text>
      <Text style={styles.statusLine} testID="quiz-working-status">
        {SCAN_COPY.quiz.workingStatus(step, { isFirstScan })}
      </Text>

      {build.showCounter && (
        <Text style={styles.counter} testID="quiz-found-counter">
          {build.foundCount}
          <Text style={styles.counterOf}> of </Text>
          {build.foundTotal}
        </Text>
      )}

      {/* The only number that moves during a classification batch: one
          batch can take most of a minute, and without this the whole
          screen sits still through it.

          It carries NO denominator on purpose. Sitting directly under
          the serif `n of m` counter, an implied total made `4,500 of
          53,282` read as "you must wait for 53,282" - so the line is
          open-ended and states the early exit instead. */}
      {step === 'checking' && build.examined ? (
        <Text style={styles.examinedLine} testID="quiz-examined-line">
          {SCAN_COPY.quiz.examinedLine(build.examined)}
        </Text>
      ) : null}
      {step === 'scanning' && durationLine ? (
        <Text style={styles.examinedLine} testID="quiz-working-duration">
          {durationLine}
        </Text>
      ) : null}

      <View style={styles.barTrack} testID="quiz-progress-track">
        <View style={[styles.barFill, { width: `${barFraction * 100}%` }]} />
      </View>

      <View style={styles.slotGrid}>
        {Array.from({ length: build.slotTotal }, (_, index) => {
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
                  // The warm-cream layer mounts with the photo: the slot
                  // brightens for a beat while the thumbnail fades in.
                  // During the upload a slot stays dimmed until its own
                  // photo is up - the grid itself is the upload meter.
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

      {/* Two lines, not the full bullets: the working phase is not a
          consent moment and they would crowd the slot grid. One
          STATEMENT about trips, never a button - nothing competes with
          the challenge the user is waiting for. */}
      <Text style={styles.privacyLine} testID="quiz-privacy-line">
        {SCAN_COPY.quiz.workingPrivacy[0]}
      </Text>
      <Text style={styles.privacyLine} testID="quiz-trips-line">
        {SCAN_COPY.quiz.workingPrivacy[1]}
      </Text>
      <Text style={styles.privacyLine} testID="quiz-persistence-line">
        {leaseKeepsRunning
          ? SCAN_COPY.shared.persistenceParagraphWhileLeased('quiz-build')
          : SCAN_COPY.shared.persistenceParagraph}
      </Text>

      {/* Leaving is now the safe, ordinary action - the build outlives
          this screen - so the ghost button says so, and stopping is the
          deliberate one behind the confirm. */}
      <Button
        title={SCAN_COPY.quiz.leaveCta}
        variant="ghost"
        onPress={onLeave}
        testID="quiz-leave-running"
      />
      <Button
        title={SCAN_COPY.quiz.stopCta}
        variant="ghost"
        onPress={onStop}
        testID="quiz-cancel"
      />
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
