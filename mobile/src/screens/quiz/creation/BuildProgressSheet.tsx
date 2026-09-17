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
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { CountryDiscoveryRows } from '@components/photos/CountryDiscoveryRows';
import { Button } from '@components/ui/Button';
import { SCAN_COPY } from '@constants/scanCopy';
import { useLeaseKeepsRunning } from '@hooks/useContinuationLeaseState';

import { DURATION_BASE, DURATION_FAST } from '../components/motionTokens';
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
  const showCountryPreviews = step === 'scanning';
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

      {step === 'scanning' && durationLine ? (
        <Text style={styles.examinedLine} testID="quiz-working-duration">
          {durationLine}
        </Text>
      ) : null}

      <View style={styles.barTrack} testID="quiz-progress-track">
        <View style={[styles.barFill, { width: `${barFraction * 100}%` }]} />
      </View>

      <View style={styles.buildContentRegion} testID="quiz-build-content-region">
        {showCountryPreviews ? (
          <Animated.View
            style={styles.buildContentLayer}
            entering={reduceMotion ? undefined : FadeIn.duration(DURATION_FAST)}
            exiting={reduceMotion ? undefined : FadeOut.duration(DURATION_FAST)}
          >
            <CountryDiscoveryRows
              rows={build.countryPreviews}
              isComplete={false}
              reduceMotion={reduceMotion}
            />
          </Animated.View>
        ) : (
          <Animated.View
            style={styles.buildContentLayer}
            entering={reduceMotion ? undefined : FadeIn.duration(DURATION_FAST)}
            exiting={reduceMotion ? undefined : FadeOut.duration(DURATION_FAST)}
          >
            <SlotGrid
              pickUris={pickUris}
              slotTotal={build.slotTotal}
              uploading={uploading}
              uploadedCount={uploadedCount}
              reduceMotion={reduceMotion}
            />
          </Animated.View>
        )}
      </View>

      {/* THE EXPLAINERS BELONG TO THE FIRST SCAN, AND ONLY TO IT.
          All of this used to render on every build, so someone creating
          their fifth challenge - no scan, nothing to explain, twenty
          seconds of work - got a wall of text about a library scan that
          was not running. It answers a question only a first-time user
          has. `isFirstScan` is the never-synced case, which is exactly
          "the first round". */}
      {isFirstScan && !uploading ? (
        <>
          <Text style={styles.privacyLine} testID="quiz-privacy-line">
            {SCAN_COPY.quiz.workingPrivacy[0]}
          </Text>
          {/* One STATEMENT about trips, never a button - nothing competes
              with the challenge the user is waiting for. */}
          <Text style={styles.privacyLine} testID="quiz-trips-line">
            {SCAN_COPY.quiz.workingPrivacy[1]}
          </Text>
          <Text style={styles.privacyLine} testID="quiz-persistence-line">
            {leaseKeepsRunning
              ? SCAN_COPY.shared.persistenceParagraphWhileLeased('quiz-build')
              : SCAN_COPY.shared.persistenceParagraph}
          </Text>
        </>
      ) : null}

      {/* Same gate: the leave/stop pair exists to teach that a first,
          long scan survives leaving the screen. A repeat build is over in
          seconds, so the pair is noise - and "Stop" next to a nearly-full
          grid reads as a way to lose it. The header back control still
          leaves from every phase. */}
      {isFirstScan && !uploading ? (
        <>
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
        </>
      ) : null}
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
