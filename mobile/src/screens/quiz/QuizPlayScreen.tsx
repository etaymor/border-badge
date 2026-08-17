/**
 * QuizPlayScreen - the owner plays their own Guess Where challenge (R4).
 *
 * The photo is the product, so the screen is a full-bleed dark stage: the
 * photo itself, blurred and dimmed, fills the frame as its own backdrop and
 * the sharp image sits contained on top (nothing is ever cropped). Options
 * layer over a bottom scrim. Questions transition like prints dealt onto a
 * table: the outgoing photo tosses away, the next deals in.
 *
 * Per photo: the four country options first, then (when the photo has a
 * usable capture date) the year memory question - both picks are graded in a
 * SINGLE /answer call because the backend grades each question at most once
 * per session. There is NO per-question verdict (Q8): the tapped option gets
 * a neutral gold acknowledgment and the game moves on; the score lands once,
 * on the results screen.
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
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StatusBar, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  FadeIn,
  FadeInDown,
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
import { ProgressSegments } from './components/ProgressSegments';

type Props = RootStackScreenProps<'QuizPlay'>;

type PlayPhase = 'loading' | 'country' | 'year' | 'completing' | 'error';

/** The backend 409s when this (session, question) pair was already graded. */
function isAlreadyAnsweredConflict(error: unknown): boolean {
  return (error as { response?: { status?: number } })?.response?.status === 409;
}

/** How long the gold acknowledgment holds before the next print deals in. */
const ACK_HOLD_MS = 420;

/**
 * Fail-safe for the answer lock. While `pendingAnswerKey` is set the tapped
 * option keeps its ring and EVERY option is disabled, and only reaching the
 * next question clears it - so any path that sets the lock without advancing
 * leaves the game frozen with the tapped option still lit and no way out but
 * killing the app. The API client times out at 10s, so anything still holding
 * the lock well past that is a bug on a path we have not enumerated: log it
 * and fall back to the retryable error state, which can resume.
 */
const ANSWER_WATCHDOG_MS = 15_000;

const DEAL_SPRING = { damping: 16, stiffness: 220, mass: 0.9 };

/** The incoming photo deals in like a print tossed onto the table. */
const dealIn: EntryExitAnimationFunction = () => {
  'worklet';
  return {
    initialValues: {
      opacity: 0,
      transform: [{ translateY: 28 }, { rotate: '-2.5deg' }, { scale: 0.92 }],
    },
    animations: {
      opacity: withTiming(1, { duration: 200 }),
      transform: [
        { translateY: withSpring(0, DEAL_SPRING) },
        { rotate: withSpring('0deg', DEAL_SPRING) },
        { scale: withSpring(1, DEAL_SPRING) },
      ],
    },
  };
};

/** The answered photo tosses away off the table. */
const tossOut: EntryExitAnimationFunction = () => {
  'worklet';
  return {
    initialValues: {
      opacity: 1,
      transform: [{ translateX: 0 }, { rotate: '0deg' }],
    },
    animations: {
      opacity: withTiming(0, { duration: 160 }),
      transform: [
        { translateX: withTiming(-140, { duration: 200 }) },
        { rotate: withTiming('-5deg', { duration: 200 }) },
      ],
    },
  };
};

export function QuizPlayScreen({ navigation, route }: Props) {
  // A restored navigation state can produce a param-less route (BUG-1):
  // degrade to the handled error phase instead of throwing during render.
  const quizId = route.params?.quizId;
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();

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
  const [pendingCountryIndex, setPendingCountryIndex] = useState<number | null>(null);
  // The tapped option keeps its gold ring while the answer is in flight and
  // through the acknowledgment hold - a neutral "got it", never a verdict.
  const [pendingAnswerKey, setPendingAnswerKey] = useState<string | null>(null);

  const sessionStartedRef = useRef(false);

  const questions = useMemo(
    () => (quiz ? [...quiz.questions].sort((a, b) => a.position - b.position) : []),
    [quiz]
  );
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
  // this, every advance paid for a cold download + decode, which is why the
  // wait after the year question was so much longer than the country->year
  // step (that one mounts no new image at all). Exactly one ahead: warming the
  // whole game would put every full-size bitmap in memory at once.
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
    setPendingCountryIndex(null);
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

  const submitAnswer = useStableCallback((optionIndex: number, year: number | null) => {
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
        selectedYear: year,
      },
      {
        onSuccess: (result: QuizAnswerResult) => {
          void applyAnswer(
            {
              questionId,
              selectedOptionIndex: optionIndex,
              selectedYear: year,
              placeCorrect: result.place_correct,
              yearCorrect: result.year_correct ?? null,
              correctOptionIndex: result.correct_option_index,
              correctOption: result.correct_option,
              correctYear: result.correct_year ?? null,
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
                selectedYear: year,
                placeCorrect: false,
                yearCorrect: null,
                correctOptionIndex: -1,
                correctOption: '',
                correctYear: null,
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
    if (activeQuestion?.year_options?.length) {
      setPendingCountryIndex(optionIndex);
      setPhase('year');
    } else {
      setPendingAnswerKey(`option-${optionIndex}`);
      submitAnswer(optionIndex, null);
    }
  });

  const handleSelectYear = useStableCallback((year: number) => {
    if (answerMutation.isPending || pendingAnswerKey !== null) return;
    if (pendingCountryIndex === null) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setPendingAnswerKey(`year-${year}`);
    submitAnswer(pendingCountryIndex, year);
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

  const showQuestion = (phase === 'country' || phase === 'year') && activeQuestion;
  const entering = reduceMotion ? FadeIn.duration(0) : dealIn;
  const exiting = reduceMotion ? FadeOut.duration(0) : tossOut;

  return (
    <View style={styles.stage}>
      <StatusBar barStyle="light-content" />

      {/* The photo, blurred, is its own backdrop - landscape shots get
          atmosphere instead of letterboxing. Crossfades between questions. */}
      {showQuestion && activeQuestion && (
        <Animated.View
          key={`backdrop-${activeQuestion.id}`}
          entering={FadeIn.duration(reduceMotion ? 0 : 350)}
          exiting={FadeOut.duration(reduceMotion ? 0 : 250)}
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
        <View style={styles.stageColumn}>
          <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
            <View style={styles.topBarRow}>
              <GlassBackButton onPress={handleBack} variant="dark" size="small" />
              <Text style={styles.progress} testID="quiz-play-progress">
                Photo {activeNumber} of {questions.length}
              </Text>
              {/* Spacer mirrors the back button so the label stays centered. */}
              <View style={styles.topBarSpacer} />
            </View>
            <ProgressSegments total={questions.length} filled={answeredCount} />
          </View>

          <View style={styles.photoFrame}>
            <Animated.View
              key={`photo-${activeQuestion.id}`}
              entering={entering}
              exiting={exiting}
              style={styles.photoWrap}
            >
              <Image
                source={{ uri: activeQuestion.image_url }}
                style={styles.photo}
                contentFit="contain"
                recyclingKey={activeQuestion.id}
                cachePolicy="memory-disk"
                testID="quiz-play-photo"
              />
            </Animated.View>
          </View>

          <LinearGradient
            colors={[withAlpha(colors.midnightNavy, 0), withAlpha(colors.midnightNavy, 0.9)]}
            style={[styles.bottomSheet, { paddingBottom: insets.bottom + 20 }]}
          >
            {phase === 'country' ? (
              <Animated.View key={`country-${activeQuestion.id}`} style={styles.optionsBlock}>
                <Text style={styles.prompt} testID="quiz-country-prompt">
                  where was this taken?
                </Text>
                <View style={styles.optionsGrid}>
                  {activeQuestion.options.map((option, index) => (
                    <GuessOption
                      key={option}
                      label={option}
                      selected={pendingAnswerKey === `option-${index}`}
                      disabled={answerMutation.isPending || pendingAnswerKey !== null}
                      entranceDelay={reduceMotion ? 0 : 120 + index * 50}
                      onPress={() => handleSelectCountry(index)}
                      style={styles.optionCell}
                      testID={`quiz-option-${index}`}
                    />
                  ))}
                </View>
              </Animated.View>
            ) : (
              <Animated.View
                key={`year-${activeQuestion.id}`}
                entering={reduceMotion ? undefined : FadeInDown.duration(250)}
                style={styles.optionsBlock}
              >
                <Text style={styles.prompt} testID="quiz-year-prompt">
                  what year was this?
                </Text>
                <View style={styles.optionsGrid}>
                  {(activeQuestion.year_options ?? []).map((year) => (
                    <GuessOption
                      key={year}
                      label={String(year)}
                      selected={pendingAnswerKey === `year-${year}`}
                      disabled={answerMutation.isPending || pendingAnswerKey !== null}
                      onPress={() => handleSelectYear(year)}
                      style={styles.optionCell}
                      testID={`quiz-year-${year}`}
                    />
                  ))}
                </View>
              </Animated.View>
            )}
          </LinearGradient>
        </View>
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
  stageColumn: {
    flex: 1,
  },
  topBar: {
    paddingHorizontal: 16,
    gap: 10,
  },
  topBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  topBarSpacer: {
    width: 36,
  },
  progress: {
    fontFamily: fonts.body.bold,
    fontSize: 13,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: withAlpha(colors.warmCream, 0.9),
  },
  photoFrame: {
    flex: 1,
    paddingVertical: 12,
  },
  photoWrap: {
    flex: 1,
  },
  photo: {
    flex: 1,
    width: '100%',
  },
  bottomSheet: {
    paddingHorizontal: 16,
    paddingTop: 40,
  },
  optionsBlock: {
    gap: 12,
  },
  prompt: {
    fontFamily: fonts.dawning.regular,
    fontSize: 26,
    lineHeight: 30,
    color: colors.sunsetGold,
    textAlign: 'center',
  },
  optionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
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
    height: 56,
    borderRadius: 16,
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
