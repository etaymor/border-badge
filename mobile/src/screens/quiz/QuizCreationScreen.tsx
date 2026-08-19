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
 * The service keeps sole ownership of sequencing: one createQuiz.mutate call
 * drives refresh + classify + build exactly as before, and the rendered
 * status follows ACTUAL progress events - the pre-flight only chooses the
 * initial step, so a fresh->stale race between pre-flight and mutate cannot
 * desync the UI.
 *
 * Every phase shares one layout shell: a hero region up top (the most recent
 * find during the build, the intro poster before it, a plain navy field for
 * the utility states) over a warm-cream sheet that carries the copy and
 * actions. During the working phase the sheet renders the live build: a
 * serif found-counter, a gold progress bar, and a slot grid where each find
 * lands as a crisp thumbnail over a neutral placeholder - photos the user
 * recognizes, not a frozen spinner, across the up-to-90-second wait.
 *
 * The build reads as ONE continuous process, because it is: the service locks
 * each photo into its slot as it is found (`pickLedger`), so `pickUris` is
 * append-only from the first find through the last upload. This screen holds
 * up its end - one meter spanning both steps (the hunt fills the first
 * HUNT_BAR_SHARE, the upload the rest) and a counter that never restarts.
 * Both used to reset at the hunt/upload handover, on top of a photo list that
 * changed underneath them, which read as the build crashing and starting
 * over.
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
 */

import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, StatusBar, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn } from 'react-native-reanimated';

import { Button } from '@components/ui/Button';
import { colors, withAlpha } from '@constants/colors';
import { fonts } from '@constants/typography';
import { usePhotoPermissionStatus } from '@hooks/usePhotoPermissions';
import { useCreateQuiz } from '@hooks/useQuizzes';
import { useReducedMotion } from '@hooks/useReducedMotion';
import { useStableCallback } from '@hooks/useStableCallback';
import {
  getLibraryFreshness,
  type LibraryFreshness,
} from '@services/photoImport/photoLibrarySyncStatus';
import { QUIZ_MAX_PHOTOS } from '@services/quiz/candidateSelection';
import { loadDraftState } from '@services/quiz/quizCreation';
import type {
  QuizCreationOutcome,
  QuizCreationProgress,
  QuizCreationStep,
} from '@services/quiz/quizCreation';
import type { RootStackScreenProps } from '@navigation/types';

import { PhotoHero } from './components/PhotoHero';
import { QuizTopBar } from './components/QuizTopBar';
import { DURATION_BASE } from './components/motionTokens';
import { introPoster } from './sampleAssets';

type Props = RootStackScreenProps<'QuizCreation'>;

type ScreenPhase =
  | 'checking-permission'
  | 'intro'
  | 'resume-draft'
  | 'permission-request'
  | 'permission-denied'
  | 'working'
  | 'thin-library'
  | 'service-error'
  | 'interrupted';

// The `checking` counter is PHOTOS FOUND against the game size, not images
// checked: the hunt keeps drawing batches until the game is full, so a
// per-batch counter restarted at zero over and over.
const WORKING_STATUS: Record<QuizCreationStep, string> = {
  scanning: 'Checking for new photos',
  checking: 'Finding your travel photos',
  building: 'Building your challenge',
};

/**
 * Share of the one progress meter that belongs to the photo hunt; the upload
 * fills the rest. The split is what lets a single bar span two steps whose
 * counts mean different things without ever moving backwards.
 */
const HUNT_BAR_SHARE = 0.7;

/**
 * Name the rule that actually failed. The backend has always returned a
 * per-image rejection reason; until it was surfaced here, every decline read
 * "too few passed those checks" whether the photos had people in them, were
 * indoors, or the vision service returned nothing at all.
 */
function thinLibraryReason(outcome: QuizCreationOutcome | null): string {
  if (outcome?.status !== 'thin-library' || !outcome.hasGeoCandidates) {
    return 'We could not find geotagged travel photos in your library.';
  }
  switch (outcome.dominantReason) {
    case 'people_present':
      return 'Most of the ones we checked had people in them.';
    case 'indoor':
      return 'Most of the ones we checked were taken indoors.';
    case 'category_not_allowed':
      return 'Most of the ones we checked were not scenery or landmarks.';
    case 'prepare_failed':
      return 'Most of the ones we checked could not be opened - they may still be in iCloud.';
    case 'unclassifiable':
    case 'service_error':
      return 'We could not read most of the ones we checked. Try again in a moment.';
    default:
      return 'We found travel photos, but too few passed those checks.';
  }
}

function formatSyncedAgo(lastSuccessAt: number | null): string | null {
  if (!lastSuccessAt) return null;
  const minutes = Math.max(1, Math.round((Date.now() - lastSuccessAt) / 60_000));
  if (minutes < 60) return `synced ${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return `synced ${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
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

export function QuizCreationScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const {
    status: permissionStatus,
    isLoading: permissionLoading,
    requestPermission,
  } = usePhotoPermissionStatus();
  const createQuiz = useCreateQuiz();

  const [phase, setPhase] = useState<ScreenPhase>('checking-permission');
  const [progress, setProgress] = useState<QuizCreationProgress | null>(null);
  const [outcome, setOutcome] = useState<QuizCreationOutcome | null>(null);
  const [freshness, setFreshness] = useState<LibraryFreshness | null>(null);
  const [draftHeroUri, setDraftHeroUri] = useState<string | null>(null);
  // The resumable draft's photos, so Resume can paint the grid immediately.
  const [draftPickUris, setDraftPickUris] = useState<string[]>([]);
  const [draftUploadCounts, setDraftUploadCounts] = useState<{
    uploaded: number;
    total: number;
  } | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const preflightRef = useRef(false);

  const limitedAccess = permissionStatus === 'limited';

  const handleOutcome = useStableCallback((result: QuizCreationOutcome) => {
    setOutcome(result);
    switch (result.status) {
      case 'created':
        // REPLACE, not navigate: the wizard is done. Left on the stack, backing
        // out of play landed the player on this screen's finished loading
        // state instead of where they started. Replacing also makes plain
        // goBack() correct from every entry point (My Challenges keeps its
        // place in the stack; the wizard does not).
        navigation.replace('QuizPlay', { quizId: result.quizId });
        break;
      case 'thin-library':
        setPhase('thin-library');
        break;
      case 'service-error':
        setPhase('service-error');
        break;
      case 'interrupted':
        setPhase('interrupted');
        break;
      case 'cancelled':
        // The user backed out; the draft (if any) stays resumable.
        break;
    }
  });

  const handleProgress = useStableCallback((update: QuizCreationProgress) => {
    setProgress(update);
  });

  const startCreation = useStableCallback(() => {
    setPhase('working');
    setOutcome(null);
    const scanExpected = !freshness?.fresh;
    // Resuming a draft already has its photos: seed the grid with them rather
    // than blanking it until the first upload tick arrives. A fresh start (or
    // a retry after a decline) has nothing to show, and must not show the
    // previous attempt's finds.
    setProgress(
      draftPickUris.length > 0
        ? {
            step: 'building',
            current: 0,
            total: draftPickUris.length,
            pickUris: draftPickUris,
          }
        : { step: scanExpected ? 'scanning' : 'checking' }
    );
    const controller = new AbortController();
    abortRef.current = controller;
    createQuiz.mutate(
      { onProgress: handleProgress, signal: controller.signal },
      {
        onSuccess: handleOutcome,
        onError: () => {
          // Unexpected failure: surface the retryable branch, never the decline.
          setOutcome({ status: 'service-error', stage: 'classify' });
          setPhase('service-error');
        },
      }
    );
  });

  // Pre-flight once the permission state is known: a picks-bearing draft
  // goes to the resume confirm, everything else to the freshness-aware
  // intro. Permission prompting stays behind the intro CTA.
  useEffect(() => {
    if (permissionLoading || preflightRef.current) return;
    preflightRef.current = true;

    if (permissionStatus === 'denied') {
      setPhase('permission-denied');
      return;
    }

    let cancelled = false;
    (async () => {
      const [draft, currentFreshness] = await Promise.all([
        loadDraftState().catch(() => null),
        permissionStatus === 'granted' || permissionStatus === 'limited'
          ? getLibraryFreshness().catch(() => null)
          : Promise.resolve(null),
      ]);
      if (cancelled) return;
      setFreshness(currentFreshness);
      if (draft && draft.picks.length > 0) {
        setDraftUploadCounts({
          uploaded: draft.picks.filter((pick) => pick.uploaded).length,
          total: draft.picks.length,
        });
        setDraftHeroUri(draft.picks[0]?.uri ?? null);
        setDraftPickUris(draft.picks.map((pick) => pick.uri));
        setPhase('resume-draft');
      } else if (permissionStatus === 'granted' || permissionStatus === 'limited') {
        setPhase('intro');
      } else {
        setPhase('permission-request');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [permissionLoading, permissionStatus]);

  // Abandoning the screen mid-flight keeps the persisted draft resumable (KTD7).
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const handleRequestPermission = useStableCallback(async () => {
    const granted = await requestPermission();
    if (granted === 'granted' || granted === 'limited') {
      const currentFreshness = await getLibraryFreshness().catch(() => null);
      setFreshness(currentFreshness);
      setPhase('intro');
    } else {
      setPhase('permission-denied');
    }
  });

  const handleCancel = useStableCallback(() => {
    abortRef.current?.abort();
    navigation.goBack();
  });

  const handleBack = useStableCallback(() => {
    navigation.goBack();
  });

  // One close button for every phase: mid-build it must abort the controller
  // first (the persisted draft stays resumable - KTD7), otherwise the run
  // would keep classifying behind a screen the user has left.
  const handleClose = useStableCallback(() => {
    if (phase === 'working') {
      handleCancel();
      return;
    }
    handleBack();
  });

  const handleOpenSettings = useStableCallback(() => {
    Linking.openSettings();
  });

  const syncedAgo = formatSyncedAgo(freshness?.lastSuccessAt ?? null);
  const freshnessLine = freshness?.fresh
    ? freshness.reason === 'writer-active'
      ? 'Your library is syncing right now - we will use the freshest photos.'
      : `Your photo library is ready${syncedAgo ? ` - ${syncedAgo}` : ''}${
          freshness.cachedPhotoCount > 0
            ? ` - ${freshness.cachedPhotoCount.toLocaleString()} photos`
            : ''
        }.`
    : 'We will check your library for new photos first.';

  // Live build state (service contract: pickUris = the locked game in slot
  // order, APPEND-ONLY across the whole run; hero = the most recent find;
  // absent on scanning emissions).
  const step: QuizCreationStep = progress?.step ?? 'checking';
  const pickUris = progress?.pickUris ?? [];
  const lastPickUri = pickUris.length > 0 ? pickUris[pickUris.length - 1] : null;
  const uploading = step === 'building';
  const uploadedCount = uploading ? (progress?.current ?? 0) : 0;
  const withinStep =
    progress?.total && progress.total > 0 && progress.current !== undefined
      ? Math.min(1, Math.max(0, progress.current / progress.total))
      : 0;
  // ONE meter across both steps. The hunt owns the first HUNT_BAR_SHARE, the
  // upload the rest, so the handover - where the count restarts at zero
  // against a different total - cannot make the bar jump backwards.
  const barFraction = uploading
    ? HUNT_BAR_SHARE + (1 - HUNT_BAR_SHARE) * withinStep
    : HUNT_BAR_SHARE * withinStep;
  // The counter always reads FOUND photos. During the upload the hunt is over
  // and every slot is filled, so it reads n of n - complete, and still.
  const foundCount = uploading ? pickUris.length : (progress?.current ?? 0);
  const foundTotal = uploading ? pickUris.length : (progress?.total ?? QUIZ_MAX_PHOTOS);
  const showCounter = foundTotal > 0;
  // Hunting shows the game-size grid; once the hunt is over the real game
  // size is known, so the still-empty placeholders (never a found photo) go.
  const slotTotal = uploading ? pickUris.length : QUIZ_MAX_PHOTOS;

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
        <Text style={styles.heroNeutralCopy}>{WORKING_STATUS[step]}</Text>
      </View>
    );
  } else if (phase === 'intro') {
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
            <Text style={styles.title}>New Challenge</Text>
            <Text style={styles.body}>
              5-10 photos from your trips. Play once to set the score, then share.
            </Text>
            <Text style={styles.freshnessLine} testID="quiz-freshness-line">
              {freshnessLine}
            </Text>
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
          <View style={styles.sheetContent} testID="quiz-permission-request">
            <Text style={styles.title}>Your Photos, Their Guesses</Text>
            <Text style={styles.body}>A challenge is built from your own travel photos.</Text>
            <Text style={styles.hint}>
              We read them on your device and upload only the ones your challenge uses.
            </Text>
            <Button title="Allow Photo Access" onPress={handleRequestPermission} />
          </View>
        )}

        {phase === 'permission-denied' && (
          <View style={styles.sheetContent} testID="quiz-permission-denied">
            <Text style={styles.title}>Photo Access Needed</Text>
            <Text style={styles.body}>Turn on photo access in Settings, then come back.</Text>
            <Button title="Open Settings" onPress={handleOpenSettings} />
          </View>
        )}

        {phase === 'working' && (
          <View style={styles.sheetContent} testID="quiz-progress">
            <Text style={styles.title}>Building Your Challenge</Text>
            <Text style={styles.statusLine} testID="quiz-working-status">
              {WORKING_STATUS[step]}
            </Text>

            {showCounter && (
              <Text style={styles.counter} testID="quiz-found-counter">
                {foundCount}
                <Text style={styles.counterOf}> of </Text>
                {foundTotal}
              </Text>
            )}

            {/* The only number that moves during a classification batch: one
                batch can take most of a minute, and without this the whole
                screen sits still through it. */}
            {step === 'checking' && progress?.examined ? (
              <Text style={styles.examinedLine} testID="quiz-examined-line">
                {progress.examined.toLocaleString()} photos checked
              </Text>
            ) : null}

            <View style={styles.barTrack} testID="quiz-progress-track">
              <View style={[styles.barFill, { width: `${barFraction * 100}%` }]} />
            </View>

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

            <Text style={styles.privacyLine} testID="quiz-privacy-line">
              Your photos stay private until you share the challenge.
            </Text>

            <Button title="Cancel" variant="ghost" onPress={handleCancel} testID="quiz-cancel" />
          </View>
        )}

        {phase === 'thin-library' &&
          (limitedAccess ? (
            <View style={styles.sheetContent} testID="quiz-thin-limited">
              <Text style={styles.title}>Limited Photo Access</Text>
              <Text style={styles.body}>
                We can only see the photos you selected, and that was not enough.
              </Text>
              <Text style={styles.hint}>
                Allow more of your library - especially outdoor shots from your trips.
              </Text>
              <Button title="Allow More Photos" onPress={handleOpenSettings} />
              <Button title="Try Again" variant="outline" onPress={startCreation} />
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

const styles = StyleSheet.create({
  stage: {
    flex: 1,
    backgroundColor: colors.midnightNavy,
  },
  heroRegion: {
    flex: 1,
    minHeight: 200,
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  heroFill: {
    flex: 1,
    backgroundColor: colors.midnightNavy,
    overflow: 'hidden',
  },
  heroNeutral: {
    flex: 1,
    backgroundColor: colors.midnightNavy,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 32,
    // Keep centered content clear of the sheet's rounded overlap.
    paddingBottom: 24,
  },
  heroFooter: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingBottom: 44,
  },
  heroEyebrow: {
    fontFamily: fonts.body.bold,
    fontSize: 12,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: colors.sunsetGold,
    textAlign: 'center',
  },
  heroNeutralCopy: {
    fontFamily: fonts.body.regular,
    fontSize: 15,
    lineHeight: 22,
    color: withAlpha(colors.warmCream, 0.85),
    textAlign: 'center',
  },
  sheet: {
    backgroundColor: colors.warmCream,
    borderTopLeftRadius: 36,
    borderTopRightRadius: 36,
    marginTop: -28,
    paddingTop: 32,
    paddingHorizontal: 24,
  },
  sheetContent: {
    gap: 14,
  },
  title: {
    fontFamily: fonts.playfair.bold,
    fontSize: 28,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  body: {
    fontFamily: fonts.body.regular,
    fontSize: 16,
    lineHeight: 24,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  freshnessLine: {
    fontFamily: fonts.body.semiBold,
    fontSize: 13,
    lineHeight: 19,
    color: withAlpha(colors.midnightNavy, 0.6),
    textAlign: 'center',
  },
  statusLine: {
    fontFamily: fonts.body.regular,
    fontSize: 15,
    lineHeight: 22,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: -6,
  },
  counter: {
    fontFamily: fonts.playfair.bold,
    fontSize: 40,
    lineHeight: 48,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  counterOf: {
    fontFamily: fonts.playfair.regular,
    fontSize: 22,
    color: colors.stormGray,
  },
  examinedLine: {
    fontFamily: fonts.body.regular,
    fontSize: 13,
    lineHeight: 19,
    color: colors.stormGray,
    textAlign: 'center',
    marginTop: -8,
  },
  barTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: withAlpha(colors.sunsetGold, 0.25),
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: colors.sunsetGold,
  },
  slotGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -5,
  },
  slotWrapper: {
    width: '20%',
    aspectRatio: 1,
    padding: 5,
  },
  slot: {
    flex: 1,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: colors.paperBeige,
    borderWidth: 1,
    borderColor: withAlpha(colors.stormGray, 0.18),
  },
  slotPlaceholder: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.paperBeige,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotMarkFrame: {
    width: 28,
    height: 28,
    borderWidth: 1.5,
    borderColor: withAlpha(colors.stormGray, 0.4),
    borderRadius: 6,
    overflow: 'hidden',
  },
  slotMarkSun: {
    position: 'absolute',
    top: 5,
    left: 5,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: withAlpha(colors.stormGray, 0.4),
  },
  slotMarkPeak: {
    position: 'absolute',
    bottom: -1,
    right: 3,
    width: 0,
    height: 0,
    borderLeftWidth: 9,
    borderRightWidth: 9,
    borderBottomWidth: 11,
    borderLeftColor: colors.transparent,
    borderRightColor: colors.transparent,
    borderBottomColor: withAlpha(colors.stormGray, 0.35),
  },
  slotPhotoLayer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.warmCream,
  },
  slotPhotoPending: {
    opacity: 0.55,
  },
  slotPhoto: {
    flex: 1,
  },
  privacyLine: {
    fontFamily: fonts.body.regular,
    fontSize: 13,
    lineHeight: 19,
    color: colors.stormGray,
    textAlign: 'center',
  },
  hint: {
    fontFamily: fonts.body.regular,
    fontSize: 13,
    lineHeight: 19,
    color: colors.textTertiary,
    textAlign: 'center',
  },
});
