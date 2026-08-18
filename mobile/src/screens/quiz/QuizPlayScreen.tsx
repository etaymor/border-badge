/**
 * QuizPlayScreen - the owner plays their own Guess Where challenge (R4).
 *
 * The photo is the product, so the screen is a full-bleed dark stage that
 * adapts to each photo's shape: portrait and square photos extend edge to
 * edge behind the controls (scrims keep the type legible), landscape photos
 * hold the top of the stage with a compact answer area below on the stage
 * color, and until a photo's decoded dimensions arrive it sits contained
 * over its own blurred, dimmed backdrop so nothing ever jumps. Questions
 * hand over like an editorial slideshow: the answered photo fades toward
 * navy, the next fades up and settles from a hair over full size.
 *
 * Per photo: four country options, one tap. There is NO per-question verdict
 * (Q8): the tapped option gets a neutral navy acknowledgment and the game
 * moves on; the score lands once, on the results screen.
 *
 * Resume: every graded verdict is persisted locally with the session id
 * (`quizPlay.recordAnswer`), so killing the app mid-play resumes at the next
 * ungraded question. After the last answer the screen completes the session
 * (seeding the score-to-beat on first completion) and replaces itself with
 * QuizResults, handing over the owner-only results payload.
 */

import * as Haptics from 'expo-haptics';
// expo-image, not react-native's Image: RN decodes at the asset's full
// resolution and blurs on the JS/main thread, so each 2048px question held two
// ~12MB bitmaps and a 10-photo game was being killed part-way through. Every
// other image surface in the app (including PolaroidThumb next door) already
// uses expo-image, which downsamples to the view and manages a bounded cache.
import { Image, type ImageLoadEventData } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  FadeIn,
  FadeOut,
  withSpring,
  withTiming,
  type EntryExitAnimationFunction,
} from 'react-native-reanimated';

import { Button } from '@components/ui/Button';
import { GlassBackButton } from '@components/ui/GlassBackButton';
import { colors, withAlpha } from '@constants/colors';
import { fonts } from '@constants/typography';
import { useAnswerQuizQuestion, useCompleteQuizPlay, useQuiz } from '@hooks/useQuizzes';
import { useReducedMotion } from '@hooks/useReducedMotion';
import { useStableCallback } from '@hooks/useStableCallback';
import {
  ensurePlaySession,
  recordAnswer,
  type QuizPlayState,
  type StoredQuizAnswer,
} from '@services/quiz/quizPlay';
import type { QuizAnswerResult } from '@hooks/useQuizzes';
import type { RootStackScreenProps } from '@navigation/types';

import { GuessOption } from './components/GuessOption';
import { BOTTOM_SCRIM_COLORS, BOTTOM_SCRIM_LOCATIONS } from './components/PhotoHero';
import {
  DURATION_BASE,
  DURATION_FAST,
  DURATION_HERO,
  DURATION_SLOW,
} from './components/motionTokens';
import { PhotoInspector } from './components/PhotoInspector';
import { ProgressSegments } from './components/ProgressSegments';
import { sortQuestionsByPosition } from './questionOrder';

type Props = RootStackScreenProps<'QuizPlay'>;

type PlayPhase = 'loading' | 'country' | 'completing' | 'error';

type PhotoOrientation = 'portrait' | 'landscape';

/**
 * Orientation from a photo's decoded dimensions. The play payload carries no
 * orientation field, so this is derived from the expo-image onLoad event;
 * square photos take the immersive portrait treatment. Returns null (keep the
 * contained fallback) until real dimensions exist.
 */
export function deriveOrientation(
  width: number | undefined,
  height: number | undefined
): PhotoOrientation | null {
  if (!width || !height || !Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width <= 0 || height <= 0) return null;
  return width > height ? 'landscape' : 'portrait';
}

/** The backend 409s when this (session, question) pair was already graded. */
function isAlreadyAnsweredConflict(error: unknown): boolean {
  return (error as { response?: { status?: number } })?.response?.status === 409;
}

/** How long the acknowledgment holds before the next photo fades up. */
const ACK_HOLD_MS = 420;

/**
 * Fail-safe for the answer lock. While `pendingAnswerKey` is set the tapped
 * option keeps its navy acknowledgment and EVERY option is disabled, and only
 * reaching the next question clears it - so any path that sets the lock
 * without advancing leaves the game frozen with the tapped option still lit
 * and no way out but killing the app. The API client times out at 10s, so
 * anything still holding the lock well past that is a bug on a path we have
 * not enumerated: log it and fall back to the retryable error state, which
 * can resume.
 */
const ANSWER_WATCHDOG_MS = 15_000;

/** Landscape photos hold this share of the stage height; answers sit below. */
const LANDSCAPE_PHOTO_RATIO = 0.62;

/** Layout fallbacks used only until onLayout reports the real chrome sizes. */
const HEADER_FALLBACK_HEIGHT = 84;
const SHEET_FALLBACK_HEIGHT = 300;

/**
 * The incoming photo fades up and settles from a hair over full size -
 * a critically damped spring on the hero clock, so there is no bounce and
 * nothing reads as a lateral card swipe.
 */
const photoIn: EntryExitAnimationFunction = () => {
  'worklet';
  return {
    initialValues: {
      opacity: 0,
      transform: [{ scale: 1.015 }],
    },
    animations: {
      opacity: withTiming(1, { duration: DURATION_BASE }),
      transform: [{ scale: withSpring(1, { duration: DURATION_HERO, dampingRatio: 1 }) }],
    },
  };
};

export function QuizPlayScreen({ navigation, route }: Props) {
  // A restored navigation state can produce a param-less route (BUG-1):
  // degrade to the handled error phase instead of throwing during render.
  const quizId = route.params?.quizId;
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const { height: windowHeight } = useWindowDimensions();

  const {
    data: quiz,
    isError: quizLoadFailed,
    isFetching: quizFetching,
    refetch,
  } = useQuiz(quizId);
  const answerMutation = useAnswerQuizQuestion(quizId ?? '');
  const completeMutation = useCompleteQuizPlay(quizId ?? '');

  const [phase, setPhase] = useState<PlayPhase>('loading');
  const [playState, setPlayState] = useState<QuizPlayState | null>(null);
  const [activeQuestionId, setActiveQuestionId] = useState<string | null>(null);
  // The tapped option keeps its navy acknowledgment while the answer is in
  // flight and through the hold - a neutral "got it", never a verdict.
  const [pendingAnswerKey, setPendingAnswerKey] = useState<string | null>(null);
  // Orientation per question id, learned from each photo's onLoad dimensions
  // (the payload has none). Until known, the contained fallback renders.
  const [orientationById, setOrientationById] = useState<Record<string, PhotoOrientation>>({});
  // Measured chrome, so the contained photo region sits exactly between the
  // tracker and the answer sheet without hardcoding either.
  const [headerHeight, setHeaderHeight] = useState(0);
  const [sheetHeight, setSheetHeight] = useState(0);
  // Tap-to-inspect (Unit 1.2). The inspector is an opaque overlay ABOVE the
  // play interface - nothing underneath unmounts, so selection, the answer
  // lock, and the watchdog are untouched by an open/close round-trip.
  const [inspecting, setInspecting] = useState(false);

  const sessionStartedRef = useRef(false);

  // An inspector left open through the post-answer hold must not survive the
  // handover: without this it would silently re-render with the NEXT photo
  // (mirrors the web guard in quiz-play.js renderQuestion).
  useEffect(() => {
    setInspecting(false);
  }, [activeQuestionId]);

  const questions = useMemo(() => (quiz ? sortQuestionsByPosition(quiz.questions) : []), [quiz]);
  const activeQuestion = questions.find((question) => question.id === activeQuestionId) ?? null;
  const activeNumber = activeQuestion
    ? questions.findIndex((question) => question.id === activeQuestion.id) + 1
    : 0;
  const answeredCount = playState ? Object.keys(playState.answers).length : 0;

  const completePlay = useStableCallback((state: QuizPlayState) => {
    if (!quizId) return;
    setPhase('completing');
    completeMutation.mutate(state.sessionId, {
      onSuccess: (results) => {
        navigation.replace('QuizResults', { quizId, results });
      },
      onError: () => setPhase('error'),
    });
  });

  // Ensure the (persisted or fresh) owner play session exactly once.
  useEffect(() => {
    if (sessionStartedRef.current) return;
    sessionStartedRef.current = true;
    if (!quizId) {
      setPhase('error');
      return;
    }
    ensurePlaySession(quizId)
      .then(setPlayState)
      .catch(() => setPhase('error'));
  }, [quizId]);

  // Once questions + session are known, resume at the next ungraded question -
  // or complete immediately when every question is already graded.
  useEffect(() => {
    if (phase !== 'loading' || !quiz || !playState) return;
    const next = questions.find((question) => !playState.answers[question.id]);
    if (next) {
      setActiveQuestionId(next.id);
      setPhase('country');
    } else if (questions.length > 0) {
      completePlay(playState);
    }
  }, [phase, quiz, questions, playState, completePlay]);

  // Warm the NEXT photo while the player is still answering this one. Without
  // this, every advance paid for a cold download + decode, which is the whole
  // reason an advance used to stall. Exactly one ahead: warming the whole game
  // would put every full-size bitmap in memory at once.
  useEffect(() => {
    if (!activeQuestionId) return;
    const index = questions.findIndex((question) => question.id === activeQuestionId);
    const nextUrl = questions[index + 1]?.image_url;
    if (!nextUrl) return;
    Image.prefetch([nextUrl]).catch(() => {
      // A failed warm-up is invisible: the photo simply loads on mount.
    });
  }, [activeQuestionId, questions]);

  // Surface a quiz-load failure only once the fetch has settled: during a
  // retry's refetch, isError stays true while in flight, and flipping back to
  // 'error' then would make retry a no-op.
  useEffect(() => {
    if (quizLoadFailed && !quizFetching && phase === 'loading') setPhase('error');
  }, [quizLoadFailed, quizFetching, phase]);

  const goToNext = useStableCallback((state: QuizPlayState) => {
    setPendingAnswerKey(null);
    const next = questions.find((question) => !state.answers[question.id]);
    if (next) {
      setActiveQuestionId(next.id);
      setPhase('country');
    } else {
      completePlay(state);
    }
  });

  // Record a graded answer and move the game forward. A failed local write
  // must NOT strand play (BUG-1): react-query never awaits mutate callbacks,
  // so a rejection here would otherwise float away with the phase unchanged
  // and every subsequent tap re-answering into a 409. The server has already
  // graded the answer - carry it in memory and let the next successful save
  // persist the full answers map (state is rebuilt immutably each time).
  const applyAnswer = useStableCallback(async (stored: StoredQuizAnswer, holdAck: boolean) => {
    if (!playState) {
      // Releasing the lock matters more than the lost answer: holding it here
      // would disable every option for the rest of the session.
      setPendingAnswerKey(null);
      return;
    }
    let nextState: QuizPlayState;
    try {
      nextState = await recordAnswer(playState, stored);
    } catch (error) {
      console.warn('[QuizPlay] Failed to persist graded answer; continuing in memory', error);
      nextState = {
        ...playState,
        answers: { ...playState.answers, [stored.questionId]: stored },
      };
    }
    setPlayState(nextState);
    if (holdAck && !reduceMotion) {
      setTimeout(() => goToNext(nextState), ACK_HOLD_MS);
    } else {
      goToNext(nextState);
    }
  });

  const submitAnswer = useStableCallback((optionIndex: number) => {
    if (!playState || !activeQuestion) {
      // The caller already lit the tapped option; never leave it lit and
      // disabled with no request in flight to clear it.
      setPendingAnswerKey(null);
      return;
    }
    const questionId = activeQuestion.id;
    answerMutation.mutate(
      {
        sessionId: playState.sessionId,
        questionId,
        selectedOptionIndex: optionIndex,
      },
      {
        onSuccess: (result: QuizAnswerResult) => {
          void applyAnswer(
            {
              questionId,
              selectedOptionIndex: optionIndex,
              placeCorrect: result.place_correct,
              correctOptionIndex: result.correct_option_index,
              correctOption: result.correct_option,
            },
            true
          );
        },
        onError: (error) => {
          if (isAlreadyAnsweredConflict(error)) {
            // The server graded this question in an earlier run whose verdict
            // never persisted locally. Mark it answered with an unknown
            // verdict and continue - there is nothing to re-grade.
            void applyAnswer(
              {
                questionId,
                selectedOptionIndex: optionIndex,
                placeCorrect: false,
                correctOptionIndex: -1,
                correctOption: '',
                verdictUnknown: true,
              },
              false
            );
          } else {
            setPendingAnswerKey(null);
            setPhase('error');
          }
        },
      }
    );
  });

  const handleSelectCountry = useStableCallback((optionIndex: number) => {
    if (answerMutation.isPending || pendingAnswerKey !== null) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setPendingAnswerKey(`option-${optionIndex}`);
    submitAnswer(optionIndex);
  });

  // The watchdog: nothing may hold the answer lock indefinitely. The warn names
  // which branch stalled, so a recurrence is diagnosable from the device log
  // instead of reproducible only by feel.
  const recoverFromStalledAnswer = useStableCallback(() => {
    console.warn(
      `[QuizPlay] answer stalled, recovering: key=${pendingAnswerKey} phase=${phase} ` +
        `mutation=${answerMutation.isPending ? 'pending' : 'idle'} ` +
        `question=${activeQuestion?.id ?? 'none'} session=${playState ? 'yes' : 'no'}`
    );
    setPendingAnswerKey(null);
    setPhase('error');
  });

  useEffect(() => {
    if (pendingAnswerKey === null) return;
    const timer = setTimeout(recoverFromStalledAnswer, ANSWER_WATCHDOG_MS);
    return () => clearTimeout(timer);
  }, [pendingAnswerKey, recoverFromStalledAnswer]);

  const handleRetry = useStableCallback(() => {
    if (!quizId) return;
    setPhase('loading');
    refetch();
    if (!playState) {
      ensurePlaySession(quizId)
        .then(setPlayState)
        .catch(() => setPhase('error'));
    }
  });

  const handleBack = useStableCallback(() => {
    navigation.goBack();
  });

  const handleInspectPhoto = useStableCallback(() => setInspecting(true));
  const handleCloseInspector = useStableCallback(() => setInspecting(false));

  const handlePhotoLoad = useStableCallback((event: ImageLoadEventData) => {
    const next = deriveOrientation(event.source?.width, event.source?.height);
    const questionId = activeQuestion?.id;
    if (!next || !questionId) return;
    setOrientationById((prev) =>
      prev[questionId] === next ? prev : { ...prev, [questionId]: next }
    );
  });

  const handleHeaderLayout = useStableCallback((event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.height;
    setHeaderHeight((prev) => (prev === next ? prev : next));
  });

  const handleSheetLayout = useStableCallback((event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.height;
    setSheetHeight((prev) => (prev === next ? prev : next));
  });

  const showQuestion = phase === 'country' && activeQuestion;
  const entering = reduceMotion ? FadeIn.duration(0) : photoIn;
  // No lateral toss: the answered photo simply fades toward the navy stage.
  const exiting = reduceMotion ? FadeOut.duration(0) : FadeOut.duration(DURATION_FAST);

  const orientation = activeQuestion ? (orientationById[activeQuestion.id] ?? null) : null;
  const measuredHeader = headerHeight || insets.top + HEADER_FALLBACK_HEIGHT;
  const measuredSheet = sheetHeight || SHEET_FALLBACK_HEIGHT;
  const landscapePhotoHeight = Math.round(windowHeight * LANDSCAPE_PHOTO_RATIO);

  // Portrait/square photos own the whole stage; landscape photos hold the top
  // ~62% edge to edge; unknown dimensions keep the contained treatment so the
  // frame never jumps while a photo is still decoding.
  const photoLayerStyle =
    orientation === 'portrait'
      ? styles.photoLayerFull
      : orientation === 'landscape'
        ? [styles.photoLayer, { top: measuredHeader, height: landscapePhotoHeight }]
        : [
            styles.photoLayer,
            styles.photoLayerContained,
            { top: measuredHeader, bottom: measuredSheet },
          ];

  const answerContent =
    showQuestion && activeQuestion ? (
      <Animated.View
        key={`country-${activeQuestion.id}`}
        entering={reduceMotion ? undefined : FadeIn.duration(DURATION_BASE).delay(DURATION_FAST)}
        exiting={reduceMotion ? undefined : FadeOut.duration(DURATION_FAST)}
        style={styles.optionsBlock}
      >
        <Text style={styles.prompt} testID="quiz-country-prompt">
          Where in the world was this?
        </Text>
        <View style={styles.optionsGrid}>
          {activeQuestion.options.map((option, index) => (
            <GuessOption
              key={option}
              label={option}
              selected={pendingAnswerKey === `option-${index}`}
              disabled={answerMutation.isPending || pendingAnswerKey !== null}
              entranceDelay={reduceMotion ? 0 : DURATION_BASE + index * 50}
              onPress={() => handleSelectCountry(index)}
              style={styles.optionCell}
              testID={`quiz-option-${index}`}
            />
          ))}
        </View>
      </Animated.View>
    ) : null;

  return (
    <View style={styles.stage}>
      <StatusBar barStyle="light-content" />

      {/* The photo, blurred, is its own backdrop - contained shots get
          atmosphere instead of letterboxing. Crossfades between questions. */}
      {showQuestion && activeQuestion && (
        <Animated.View
          key={`backdrop-${activeQuestion.id}`}
          entering={FadeIn.duration(reduceMotion ? 0 : DURATION_SLOW)}
          exiting={FadeOut.duration(reduceMotion ? 0 : DURATION_BASE)}
          style={StyleSheet.absoluteFill}
        >
          <Image
            source={{ uri: activeQuestion.image_url }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            blurRadius={42}
            // Same recyclingKey as the sharp copy: one decode serves both.
            recyclingKey={activeQuestion.id}
            cachePolicy="memory-disk"
          />
          <View style={styles.backdropDim} />
        </Animated.View>
      )}

      {(phase === 'loading' || phase === 'completing') && (
        <View style={[styles.centered, { paddingTop: insets.top }]} testID="quiz-play-loading">
          <View style={styles.skeletonPhoto} />
          <View style={styles.skeletonRow}>
            <View style={styles.skeletonOption} />
            <View style={styles.skeletonOption} />
          </View>
          <ActivityIndicator size="small" color={colors.sunsetGold} />
          {phase === 'completing' && <Text style={styles.loadingLabel}>Tallying your score</Text>}
        </View>
      )}

      {phase === 'error' && (
        <View style={[styles.centered, { paddingTop: insets.top }]} testID="quiz-play-error">
          <Text style={styles.errorTitle}>Something Went Wrong</Text>
          <Text style={styles.errorBody}>
            We could not load your challenge. Answered photos stay answered.
          </Text>
          <Button title="Try Again" onPress={handleRetry} />
          <Button title="Back" variant="ghost" onDark onPress={handleBack} />
        </View>
      )}

      {showQuestion && activeQuestion && (
        <>
          <Animated.View
            key={`photo-${activeQuestion.id}`}
            entering={entering}
            exiting={exiting}
            pointerEvents="none"
            style={photoLayerStyle}
          >
            <Image
              source={{ uri: activeQuestion.image_url }}
              style={styles.photo}
              contentFit={orientation === 'portrait' ? 'cover' : 'contain'}
              onLoad={handlePhotoLoad}
              recyclingKey={activeQuestion.id}
              cachePolicy="memory-disk"
              testID="quiz-play-photo"
            />
          </Animated.View>

          <View
            style={styles.controls}
            pointerEvents="box-none"
            // While the inspector covers the interface, hide it from assistive
            // tech too - it stays mounted so every bit of state survives.
            accessibilityElementsHidden={inspecting}
            importantForAccessibility={inspecting ? 'no-hide-descendants' : 'auto'}
            testID="quiz-play-controls"
          >
            <View
              style={[styles.topBar, { paddingTop: insets.top + 8 }]}
              onLayout={handleHeaderLayout}
            >
              {/* Top scrim: keeps the tracker legible when a portrait photo
                  extends behind it; invisible over the navy stage. */}
              <LinearGradient
                colors={[withAlpha(colors.midnightNavy, 0.55), withAlpha(colors.midnightNavy, 0)]}
                style={StyleSheet.absoluteFill}
                pointerEvents="none"
              />
              <View style={styles.topBarRow}>
                <GlassBackButton onPress={handleBack} variant="dark" size="small" />
                <ProgressSegments
                  total={questions.length}
                  filled={answeredCount}
                  label={`${activeNumber} OF ${questions.length}`}
                  style={styles.tracker}
                  testID="quiz-play-progress"
                />
                {/* Spacer mirrors the back button so the tracker stays centered. */}
                <View style={styles.topBarSpacer} />
              </View>
            </View>

            {/* The photo region between the tracker and the answers: a tap
                here (and only here - answer taps land on the sheet below)
                opens the full-photo inspector. */}
            <Pressable
              style={styles.controlsSpacer}
              onPress={handleInspectPhoto}
              accessibilityRole="button"
              accessibilityLabel="View the photo full screen"
              testID="quiz-photo-inspect"
            />

            {orientation === 'landscape' ? (
              <View
                style={[
                  styles.answerAreaSolid,
                  { top: measuredHeader + landscapePhotoHeight, paddingBottom: insets.bottom + 16 },
                ]}
                testID="quiz-answer-solid"
              >
                {answerContent}
              </View>
            ) : (
              <LinearGradient
                colors={BOTTOM_SCRIM_COLORS}
                locations={BOTTOM_SCRIM_LOCATIONS}
                style={[styles.bottomSheet, { paddingBottom: insets.bottom + 20 }]}
                onLayout={handleSheetLayout}
                testID="quiz-answer-scrim"
              >
                {answerContent}
              </LinearGradient>
            )}
          </View>

          {/* Tap-to-inspect overlay: the full photo on the navy stage with
              pinch-to-zoom. Conditional on showQuestion, so completing or
              erroring tears it down with the rest of the stage. */}
          {inspecting && (
            <PhotoInspector
              uri={activeQuestion.image_url}
              recyclingKey={activeQuestion.id}
              onClose={handleCloseInspector}
            />
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  stage: {
    flex: 1,
    backgroundColor: colors.midnightNavy,
  },
  backdropDim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: withAlpha(colors.midnightNavy, 0.45),
  },
  controls: {
    ...StyleSheet.absoluteFillObject,
  },
  controlsSpacer: {
    flex: 1,
  },
  topBar: {
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  topBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  topBarSpacer: {
    width: 36,
  },
  tracker: {
    flex: 1,
  },
  photoLayer: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
  photoLayerContained: {
    paddingVertical: 12,
  },
  photoLayerFull: {
    ...StyleSheet.absoluteFillObject,
  },
  photo: {
    flex: 1,
    width: '100%',
  },
  // The tall paddingTop is the fade itself: the eased scrim needs room to
  // dissolve the photo into solid navy before the serif prompt begins.
  bottomSheet: {
    paddingHorizontal: 20,
    paddingTop: 108,
  },
  answerAreaSolid: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.midnightNavy,
    paddingHorizontal: 20,
    paddingTop: 16,
    justifyContent: 'flex-end',
  },
  optionsBlock: {
    gap: 14,
  },
  prompt: {
    fontFamily: fonts.playfair.bold,
    fontSize: 32,
    lineHeight: 40,
    color: colors.warmCream,
    textAlign: 'center',
    paddingHorizontal: 12,
  },
  optionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 9,
  },
  optionCell: {
    flexBasis: '48%',
    flexGrow: 1,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'stretch',
    paddingHorizontal: 24,
    gap: 16,
  },
  skeletonPhoto: {
    height: 320,
    borderRadius: 16,
    backgroundColor: withAlpha(colors.warmCream, 0.08),
  },
  skeletonRow: {
    flexDirection: 'row',
    gap: 10,
  },
  skeletonOption: {
    flex: 1,
    height: 48,
    borderRadius: 14,
    backgroundColor: withAlpha(colors.warmCream, 0.08),
  },
  loadingLabel: {
    fontFamily: fonts.body.regular,
    fontSize: 16,
    color: withAlpha(colors.warmCream, 0.85),
    textAlign: 'center',
  },
  errorTitle: {
    fontFamily: fonts.playfair.bold,
    fontSize: 28,
    color: colors.warmCream,
    textAlign: 'center',
  },
  errorBody: {
    fontFamily: fonts.body.regular,
    fontSize: 16,
    lineHeight: 24,
    color: withAlpha(colors.warmCream, 0.8),
    textAlign: 'center',
  },
});
