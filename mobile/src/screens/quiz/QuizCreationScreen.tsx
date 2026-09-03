/**
 * QuizCreationScreen - the Guess Where creation wizard (Q5).
 *
 * A stepper instead of a single blocking screen: an intro step confirms what
 * is about to happen (pre-flighted against the shared library freshness, so
 * a warm cache promises no scan), then the build runs with only the steps
 * that actually exist. The photo-scan step is SKIPPED entirely when the
 * cache is fresh (P1: ensureFreshLibrary emits no scanning progress then) -
 * repeat creations no longer feel as heavy as the first.
 *
 * The `quiz-build` JOB keeps sole ownership of sequencing and of the run
 * itself: this screen starts it and then renders whatever the job's store
 * slice says. That is why leaving mid-build no longer destroys it, and why
 * coming back reattaches to a partly-filled grid instead of restarting.
 *
 * Every phase shares one layout shell: a hero region up top (the most recent
 * find during the build, the intro poster before it, a plain navy field for
 * the utility states) over a warm-cream sheet that carries the copy and
 * actions.
 *
 * Owns every state of the creation flow:
 * - intro (freshness-aware confirm) and resume-draft confirm (pre-flighted
 *   via loadDraftState instead of discovered after an interruption)
 * - permission request / denied (Settings link) / limited-access awareness
 * - staged progress, never a frozen spinner
 * - thin-library decline with guidance (AE2), with a distinct "allow more
 *   photos" branch when access is limited
 * - retryable service failure, DISTINCT from the thin-library decline
 * - interrupted upload with resume/abandon (abandon keeps the resumable
 *   draft - KTD7)
 *
 * On success navigates to QuizPlay for the owner play-through.
 *
 * WHAT LIVES WHERE. The phase machine, the pre-flight and the build
 * arithmetic are in `creation/useQuizCreationFlow`; the working phase is
 * `creation/BuildProgressSheet`; the stylesheet is
 * `creation/quizCreationStyles`. This file is the shell and the confirm/decline
 * sheets - the parts that are purely about what the user sees.
 */

import { ActivityIndicator, StatusBar, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PhotoPermissionRecoverySheet } from '@components/photos/PhotoPermissionRecoverySheet';
import { PrivacyNotice } from '@components/photos/PrivacyNotice';
import { Button } from '@components/ui/Button';
import { colors } from '@constants/colors';
import { SCAN_COPY } from '@constants/scanCopy';
import { useReducedMotion } from '@hooks/useReducedMotion';
import type { RootStackScreenProps } from '@navigation/types';

import { PhotoHero } from './components/PhotoHero';
import { QuizTopBar } from './components/QuizTopBar';
import { BuildProgressSheet } from './creation/BuildProgressSheet';
import { thinLibraryReason } from './creation/quizCreationCopy';
import { styles } from './creation/quizCreationStyles';
import { useQuizCreationFlow } from './creation/useQuizCreationFlow';
import { introPoster } from './sampleAssets';

type Props = RootStackScreenProps<'QuizCreation'>;

export function QuizCreationScreen({ navigation, route }: Props) {
  const entryPoint = route.params?.entryPoint ?? 'unknown';
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();

  const {
    phase,
    outcome,
    limitedAccess,
    freshnessLine,
    isFirstScan,
    scaleLine,
    durationLine,
    draftHeroUri,
    draftUploadCounts,
    build,
    startCreation,
    handleRequestPermission,
    handleCancel,
    handleBack,
    handleClose,
    handleOpenSettings,
  } = useQuizCreationFlow({ entryPoint, navigation });

  // Hero region per phase: real photos as soon as any are known, the bundled
  // intro poster for the confirm steps, a plain navy field for utility
  // states - and NEVER fake imagery while the hunt is still empty-handed.
  const posterHero = (
    <PhotoHero source={introPoster} scrim="bottom" style={styles.heroFill}>
      <View style={styles.heroFooter}>
        <Text style={styles.heroEyebrow}>Guess Where</Text>
      </View>
    </PhotoHero>
  );

  const neutralHero = (
    <View style={[styles.heroNeutral, { paddingTop: insets.top }]}>
      <Text style={styles.heroEyebrow}>Guess Where</Text>
    </View>
  );

  const { lastPickUri } = build;
  let hero = neutralHero;
  if (phase === 'working') {
    hero = lastPickUri ? (
      <PhotoHero
        source={lastPickUri}
        scrim="bottom"
        style={styles.heroFill}
        testID="quiz-working-hero"
      />
    ) : (
      <View style={[styles.heroNeutral, { paddingTop: insets.top }]} testID="quiz-hero-empty">
        <Text style={styles.heroEyebrow}>Guess Where</Text>
      </View>
    );
  } else if (phase === 'intro' || phase === 'permission-request') {
    hero = posterHero;
  } else if (phase === 'resume-draft') {
    hero = draftHeroUri ? (
      <PhotoHero
        source={draftHeroUri}
        scrim="bottom"
        style={styles.heroFill}
        testID="quiz-draft-hero"
      />
    ) : (
      posterHero
    );
  } else if (phase === 'interrupted') {
    hero = lastPickUri ? (
      <PhotoHero source={lastPickUri} scrim="bottom" style={styles.heroFill} />
    ) : (
      posterHero
    );
  }

  if (phase === 'checking-permission') {
    return (
      <View style={styles.stage}>
        <StatusBar barStyle="light-content" />
        <View style={styles.heroNeutral} testID="quiz-permission-loading">
          <ActivityIndicator size="large" color={colors.sunsetGold} />
        </View>
        <View style={styles.topBar} pointerEvents="box-none">
          <QuizTopBar onClose={handleBack} icon="back" testID="quiz-creation-top-bar" />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.stage}>
      <StatusBar barStyle="light-content" />
      <View style={styles.heroRegion}>{hero}</View>
      <View style={styles.topBar} pointerEvents="box-none">
        <QuizTopBar onClose={handleClose} icon="back" testID="quiz-creation-top-bar" />
      </View>

      <View style={[styles.sheet, { paddingBottom: insets.bottom + 20 }]}>
        {phase === 'intro' && (
          <View style={styles.sheetContent} testID="quiz-intro-step">
            <Text style={styles.title}>{SCAN_COPY.quiz.introTitle}</Text>
            <Text style={styles.body}>{SCAN_COPY.quiz.introBody}</Text>
            <Text style={styles.freshnessLine} testID="quiz-freshness-line">
              {freshnessLine}
            </Text>
            {/* Magnitude appears ONCE, here, where it is context rather than a
                wait. A first scan is the only run that needs both lines. */}
            {isFirstScan && scaleLine ? (
              <Text style={styles.freshnessDetail} testID="quiz-scale-line">
                {scaleLine}
              </Text>
            ) : null}
            {isFirstScan && durationLine ? (
              <Text style={styles.freshnessDetail} testID="quiz-duration-line">
                {durationLine}
              </Text>
            ) : null}
            <Button title="Build My Challenge" onPress={startCreation} testID="quiz-build-start" />
          </View>
        )}

        {phase === 'resume-draft' && (
          <View style={styles.sheetContent} testID="quiz-resume-draft">
            <Text style={styles.title}>An Unfinished Challenge</Text>
            <Text style={styles.body}>
              {draftUploadCounts
                ? `${draftUploadCounts.uploaded} of ${draftUploadCounts.total} photos already made it up. `
                : ''}
              Your picks are saved.
            </Text>
            <Button title="Resume" onPress={startCreation} testID="quiz-resume-start" />
            <Button title="Finish Later" variant="ghost" onPress={handleBack} />
          </View>
        )}

        {phase === 'permission-request' && (
          <View
            style={[styles.sheetContent, styles.permissionSheetContent]}
            testID="quiz-permission-request"
          >
            <Text style={styles.title}>{SCAN_COPY.quiz.permissionTitle}</Text>
            <Text style={styles.body}>{SCAN_COPY.quiz.permissionBody}</Text>
            {/* The literal same component the trips door renders. The hint
                that used to sit here was a weaker paraphrase of two of these
                bullets; deleting it is the point - one source, one phrasing. */}
            <PrivacyNotice variant="sheet" testID="quiz-privacy-notice" />
            <Button title={SCAN_COPY.quiz.permissionCta} onPress={handleRequestPermission} />
          </View>
        )}

        {phase === 'permission-denied' && (
          <View style={styles.sheetContent} testID="quiz-permission-denied">
            <PhotoPermissionRecoverySheet
              variant="denied"
              onOpenSettings={handleOpenSettings}
            />
          </View>
        )}

        {phase === 'working' && (
          <BuildProgressSheet
            build={build}
            isFirstScan={isFirstScan}
            durationLine={durationLine}
            reduceMotion={reduceMotion}
            onLeave={handleBack}
            onStop={handleCancel}
          />
        )}

        {phase === 'thin-library' &&
          (limitedAccess ? (
            <View style={styles.sheetContent} testID="quiz-thin-limited">
              <PhotoPermissionRecoverySheet
                variant="limited"
                onOpenSettings={handleOpenSettings}
                onContinueLimited={startCreation}
              />
            </View>
          ) : (
            <View style={styles.sheetContent} testID="quiz-thin-library">
              <Text style={styles.title}>Not Enough Photos Yet</Text>
              <Text style={styles.body}>
                A challenge needs 5 photos that are geotagged, outdoors, and people-free.
              </Text>
              <Text style={styles.hint} testID="quiz-thin-reason">
                {thinLibraryReason(outcome)}
              </Text>
              <Button title="Try Again" onPress={startCreation} />
            </View>
          ))}

        {phase === 'service-error' && (
          <View style={styles.sheetContent} testID="quiz-service-error">
            <Text style={styles.title}>Something Went Wrong</Text>
            <Text style={styles.body}>
              We could not check your photos right now. Your library is fine.
            </Text>
            <Button title="Retry" onPress={startCreation} />
          </View>
        )}

        {phase === 'interrupted' && (
          <View style={styles.sheetContent} testID="quiz-interrupted">
            <Text style={styles.title}>Upload Interrupted</Text>
            <Text style={styles.body}>
              {outcome?.status === 'interrupted'
                ? `${outcome.uploadedCount} of ${outcome.totalCount} photos made it up. `
                : ''}
              Resuming picks up where it stopped.
            </Text>
            <Button title="Resume" onPress={startCreation} />
            <Button title="Finish Later" variant="ghost" onPress={handleBack} />
          </View>
        )}
      </View>
    </View>
  );
}
