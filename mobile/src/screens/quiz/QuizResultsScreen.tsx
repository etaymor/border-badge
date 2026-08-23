/**
 * QuizResultsScreen - the payoff. Owner results, pre-share editing, share.
 *
 * The whole game funnels into this screen (Q8: no per-question verdicts),
 * so the reveal is staged on a photo-first hero: the first challenge photo
 * settles full-bleed under the navy scrim, the serif score rises into place
 * with the success haptic, the recap thumbnails populate with their corner
 * verdict marks, and the share controls fade in last. No count-up, no
 * trophy - the photo is the hero.
 *
 * - The country score is the score-to-beat (R4): always rendered from the
 *   freshest quiz detail (the backend rescales it after swap/remove).
 * - The recap keeps country names hidden until "Review Answers" is opened;
 *   the opened rows carry the serif reveal lines and the one sanctioned
 *   country-stamp artwork moment (small, post-answer only).
 * - Swap/remove are available only pre-share (R5), inside the opened review.
 *   A swap drops the local stored answer, so share stays hidden behind
 *   "Answer New Photo" until the owner has played the replacement (the
 *   backend enforces the same rule with QUIZ_OWNER_ANSWERS_INCOMPLETE).
 * - Share (R6) mints the slug, then presents the system share sheet. The
 *   challenge link travels in the share sheet's url slot (Q10) so
 *   destinations unfurl it into a rich preview - never buried inside the
 *   message text.
 */

import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
// expo-image, not react-native's Image: the swap picker shows up to
// SWAP_CANDIDATE_LIMIT (30) camera-roll ORIGINALS as 100pt thumbnails, and RN
// decodes each at its full 12MP source resolution regardless of display size.
// expo-image downsamples to the view and bounds its own cache.
import { Image } from 'expo-image';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeInUp } from 'react-native-reanimated';

import { Button } from '@components/ui/Button';
import { GlassIconButton } from '@components/ui/GlassIconButton';
import { Screen } from '@components/ui/Screen';
import { colors, withAlpha } from '@constants/colors';
import { fonts } from '@constants/typography';
import {
  confirmRevokeQuiz,
  useQuiz,
  useRemoveQuizQuestion,
  useRevokeQuiz,
  useShareQuiz,
  useSwapQuizQuestion,
} from '@hooks/useQuizzes';
import { useReducedMotion } from '@hooks/useReducedMotion';
import { useStableCallback } from '@hooks/useStableCallback';
import { QUIZ_MIN_PHOTOS, type GeoEligibleCandidate } from '@services/quiz/candidateSelection';
import {
  loadPlayState,
  loadSwapCandidates,
  type QuizPlayState,
  type StoredQuizAnswer,
} from '@services/quiz/quizPlay';
import type { RootStackScreenProps } from '@navigation/types';
import { Analytics } from '@services/analytics';

import { PhotoHero } from './components/PhotoHero';
import { TripCrossSellRow } from './components/TripCrossSellRow';
import { QuizTopBar } from './components/QuizTopBar';
import { VerdictMark } from './components/VerdictMark';
import { SerifScore } from './components/SerifScore';
import {
  DURATION_BASE,
  DURATION_FAST,
  DURATION_HERO,
  DURATION_SLOW,
} from './components/motionTokens';
import { presentChallengeShare, verdictsForShare } from './shareChallenge';
import { sortQuestionsByPosition } from './questionOrder';

type Props = RootStackScreenProps<'QuizResults'>;

/** Swap picker grid: three columns that fill the row exactly at any width. */
const CANDIDATE_COLUMNS = 3;
const CANDIDATE_GAP = 8;
const PICKER_GUTTER = 24;

/** Per-thumbnail delay so the recap populates rapidly, not all at once. */
const THUMB_STAGGER = DURATION_FAST / 2;

type RecapVerdict = 'correct' | 'incorrect' | 'unknown';

/** The recap thumbnail's corner verdict for a stored answer (null = unanswered). */
function verdictFor(answer: StoredQuizAnswer | undefined): RecapVerdict | null {
  if (!answer) return null;
  if (answer.verdictUnknown) return 'unknown';
  if (answer.placeCorrect) return 'correct';
  return 'incorrect';
}

export function QuizResultsScreen({ navigation, route }: Props) {
  // A restored navigation state can produce a param-less route (BUG-1):
  // degrade to the handled error state instead of throwing during render.
  const quizId = route.params?.quizId ?? '';
  const results = route.params?.results;
  const paramsMissing = !route.params?.quizId;
  const reduceMotion = useReducedMotion();
  const insets = useSafeAreaInsets();
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const candidateSize = Math.floor(
    (windowWidth - PICKER_GUTTER * 2 - CANDIDATE_GAP * (CANDIDATE_COLUMNS - 1)) / CANDIDATE_COLUMNS
  );

  const {
    data: quiz,
    isError: quizLoadFailed,
    isFetching: quizFetching,
    refetch,
  } = useQuiz(quizId);
  const swapMutation = useSwapQuizQuestion(quizId);
  const removeMutation = useRemoveQuizQuestion(quizId);
  const shareMutation = useShareQuiz(quizId);
  const revokeMutation = useRevokeQuiz(quizId);

  const [playState, setPlayState] = useState<QuizPlayState | null>(null);
  const [swapTargetId, setSwapTargetId] = useState<string | null>(null);
  const [swapCandidates, setSwapCandidates] = useState<GeoEligibleCandidate[] | null>(null);
  // Distinguishes a candidate-load failure from an empty library so the swap
  // modal can offer retry instead of the "no eligible photos" dead end.
  const [swapLoadFailed, setSwapLoadFailed] = useState(false);
  // Set on tap, before the mutation's isPending flips: the upload (resize +
  // storage PUT) is the long part, and a disabled grid with no overlay reads
  // as a dead tap. Same idea as QuizPlay's pendingAnswerKey.
  const [swappingCandidateId, setSwappingCandidateId] = useState<string | null>(null);
  // Country name -> ISO2, from the module-cached countries hook. Powers the
  // small stamp accents in the opened review; absent names (including the
  // pre-load window, when `countries` is still empty) just skip the art.
  // The local play state mirrors the seeding session's graded answers; it
  // drives the per-photo review and the "answer the swapped photo" gate.
  useEffect(() => {
    let cancelled = false;
    loadPlayState(quizId).then((state) => {
      if (!cancelled) setPlayState(state);
    });
    return () => {
      cancelled = true;
    };
  }, [quizId]);

  // Arriving fresh from play (results present) is the reveal moment: the
  // success haptic lands as the score settles into the hero.
  useEffect(() => {
    if (!results) return;
    const timer = setTimeout(
      () => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      },
      reduceMotion ? 0 : 350
    );
    return () => clearTimeout(timer);
  }, [results, reduceMotion]);

  const questions = useMemo(() => (quiz ? sortQuestionsByPosition(quiz.questions) : []), [quiz]);
  // `results` is absent when arriving from My Quizzes (no fresh play-through);
  // everything below then renders from the fetched quiz detail alone.
  const state = quiz?.state ?? results?.state;
  const scoreToBeat = quiz?.score_to_beat ?? results?.score_to_beat;
  const editable = state === 'awaiting_owner_play' || state === 'playable';
  const swapTarget = questions.find((question) => question.id === swapTargetId) ?? null;
  const canRemove = questions.length > QUIZ_MIN_PHOTOS;
  const unansweredCount = playState
    ? questions.filter((question) => !playState.answers[question.id]).length
    : 0;
  const needsAnswers = editable && unansweredCount > 0;

  // Track screen view once the quiz detail resolves - the score and state are
  // only trustworthy then. `arrived_from` is the same distinction the reveal
  // choreography already draws: fresh from a play-through, or opened from the
  // list. Must stay above the early return below; all hooks do.
  const viewFiredRef = useRef(false);
  useEffect(() => {
    if (viewFiredRef.current || !scoreToBeat) return;
    viewFiredRef.current = true;
    Analytics.viewQuizResults({
      quizId,
      arrivedFrom: results ? 'play' : 'list',
      state: state ?? 'unknown',
      questionCount: questions.length,
      scoreCorrect: scoreToBeat.correct,
      scoreTotal: scoreToBeat.total,
      editable,
      needsAnswers,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoreToBeat, state, questions.length, editable, needsAnswers]);

  const loadCandidates = useStableCallback(async () => {
    setSwapCandidates(null);
    setSwapLoadFailed(false);
    try {
      setSwapCandidates(await loadSwapCandidates(quizId));
    } catch {
      // A load failure is distinct from an empty library: keep candidates null
      // and flag the failure so the modal shows a retry, not "none found".
      setSwapLoadFailed(true);
    }
  });

  const openSwapPicker = useStableCallback(async (questionId: string) => {
    setSwapTargetId(questionId);
    await loadCandidates();
  });

  const resetSwapPicker = useStableCallback(() => {
    setSwapTargetId(null);
    setSwapCandidates(null);
    setSwapLoadFailed(false);
    setSwappingCandidateId(null);
  });

  const closeSwapPicker = useStableCallback(() => {
    // Leave the sheet up while a swap is in flight so the spinner stays the
    // acknowledgement. Dismissing mid-upload would look like a cancel, then
    // still bounce the owner into play on success.
    if (swappingCandidateId) return;
    resetSwapPicker();
  });

  const handlePickCandidate = useStableCallback((candidate: GeoEligibleCandidate) => {
    if (!swapTargetId || swappingCandidateId) return;
    // Immediate acknowledgement: overlay + status render on this state, not
    // on the mutation flag (which lags the first frame of the upload).
    setSwappingCandidateId(candidate.id);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    swapMutation.mutate(
      { questionId: swapTargetId, candidate },
      {
        onSuccess: () => {
          resetSwapPicker();
          // Force the owner through play for the new photo (R5): share stays
          // unavailable until the replacement is answered.
          navigation.navigate('QuizPlay', { quizId });
        },
        onError: () => {
          setSwappingCandidateId(null);
          Alert.alert('Error', 'Could not swap this photo. Please try another.');
        },
      }
    );
  });

  const handleRemove = useStableCallback((questionId: string) => {
    if (removeMutation.isPending) return;
    removeMutation.mutate(questionId);
  });

  const handleAnswerNew = useStableCallback(() => {
    navigation.navigate('QuizPlay', { quizId });
  });

  const handleShare = useStableCallback(async () => {
    if (!scoreToBeat) return; // Unreachable: share renders only with a score.
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    // Which half failed: minting the link, or opening the sheet with it. They
    // are different bugs, and only the first can carry a server error code.
    let stage: 'mint' | 'sheet' = 'mint';
    try {
      const shared = await shareMutation.mutateAsync();
      stage = 'sheet';
      // Read play state and questions at share time, not from the render
      // that opened the sheet: a tap can land before the recap's local
      // answers have committed, and that stale closure would drop the grid.
      const latestPlay = await loadPlayState(quizId);
      const latestQuestions =
        questions.length > 0
          ? questions
          : sortQuestionsByPosition((await refetch()).data?.questions ?? []);
      await presentChallengeShare(shared.share_url, {
        quizId,
        source: 'results',
        score: scoreToBeat,
        photoCount: latestQuestions.length || null,
        verdicts: verdictsForShare(
          latestQuestions.map((question) => question.id),
          latestPlay?.answers,
          scoreToBeat
        ),
      });
    } catch (error) {
      console.warn('[QuizResults] Share failed:', error instanceof Error ? error.message : error);
      // Surface the failure (e.g. a 409 QUIZ_OWNER_ANSWERS_INCOMPLETE after a
      // swap) instead of failing silently - prefer the server's own message.
      const detail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data
        ?.detail;
      const serverMessage =
        typeof detail === 'string'
          ? detail
          : detail && typeof detail === 'object' && 'message' in detail
            ? (detail as { message?: unknown }).message
            : null;
      // Only the machine-readable code travels to analytics; the message is
      // free server text and stays on the device.
      const errorCode =
        detail && typeof detail === 'object' && 'code' in detail
          ? (detail as { code?: unknown }).code
          : null;
      Analytics.quizShareFailed({
        quizId,
        source: 'results',
        stage,
        errorCode: typeof errorCode === 'string' ? errorCode : null,
      });
      Alert.alert(
        'Error',
        typeof serverMessage === 'string' && serverMessage.length > 0
          ? serverMessage
          : 'Could not share your challenge. Please try again.'
      );
    }
  });

  // Revoke (R15): the shared confirmation carries the honest disclosure
  // about the link, photo TTLs, and messaging-app preview caches.
  const handleRevoke = useStableCallback(() => {
    confirmRevokeQuiz(() => {
      revokeMutation.mutate(undefined, {
        onError: () => {
          Alert.alert('Error', 'Could not revoke the link. Please try again.');
        },
      });
    });
  });

  const handleBack = useStableCallback(() => {
    navigation.goBack();
  });

  /**
   * Open the suggestions list the trip continuation already filled in.
   * `skipToSuggestions` is what makes the promise good: no second scan, the
   * candidates are simply there.
   */
  const handleReviewTrips = useStableCallback(() => {
    navigation.navigate('Main', {
      screen: 'Passport',
      params: { screen: 'PhotoImport', params: { skipToSuggestions: true } },
    });
  });

  // Without navigation results, the score pair arrives with the quiz detail.
  if (!scoreToBeat) {
    // The fetch failed (or the route arrived without params) and there is no
    // results param to fall back on: show a recoverable error instead of a
    // spinner that would never resolve.
    if (paramsMissing || (quizLoadFailed && !quizFetching)) {
      return (
        <Screen>
          <View style={styles.errorState} testID="quiz-results-error">
            <Text style={styles.errorHeading}>Something Went Wrong</Text>
            <Text style={styles.body}>
              We could not load your challenge right now. Please try again.
            </Text>
            <Button title="Try Again" onPress={() => refetch()} testID="quiz-results-retry" />
            <Button title="Back" variant="ghost" onPress={handleBack} testID="quiz-results-back" />
          </View>
        </Screen>
      );
    }
    return (
      <Screen>
        <View style={styles.loading} testID="quiz-results-loading">
          <ActivityIndicator size="large" color={colors.sunsetGold} />
        </View>
      </Screen>
    );
  }

  // Reveal choreography runs only when arriving fresh from play, and never
  // under reduced motion: hero settles, score rises, thumbnails populate,
  // share controls fade in last.
  const animate = !!results && !reduceMotion;
  const heroEntering = animate ? FadeIn.duration(DURATION_HERO) : undefined;
  const scoreEntering = animate ? FadeInUp.duration(DURATION_SLOW).delay(DURATION_SLOW) : undefined;
  const sheetEntering = animate ? FadeIn.duration(DURATION_BASE).delay(DURATION_HERO) : undefined;
  const footerEntering = animate
    ? FadeIn.duration(DURATION_BASE).delay(DURATION_HERO + DURATION_SLOW)
    : undefined;

  // The hero photo: the first challenge photo. Absent only while the quiz
  // detail is still loading behind a results param - the navy ground holds.
  const heroUri = questions[0]?.image_url ?? null;
  const heroHeight = Math.round(windowHeight * 0.48);
  // The hero's bottom edge is a shallow downward arc: the clip container runs
  // twice the screen width with screen-width bottom radii, so only the gentle
  // center of the curve is on screen. Content stays centered, so the extra
  // width never shifts it.
  const heroArcStyle = {
    marginHorizontal: -Math.round(windowWidth * 0.5),
    borderBottomLeftRadius: windowWidth,
    borderBottomRightRadius: windowWidth,
  };

  const heroContent = (
    <View style={[styles.heroInner, { paddingTop: insets.top + 56 }]}>
      <Text style={styles.heroEyebrow}>Your Challenge</Text>
      <Text style={styles.heroTitle}>Score to beat</Text>
      <Animated.View entering={scoreEntering}>
        <SerifScore
          score={scoreToBeat.correct}
          total={scoreToBeat.total}
          size="large"
          testID="quiz-score-to-beat"
        />
      </Animated.View>
    </View>
  );

  return (
    <Screen safeArea={false}>
      <StatusBar barStyle="light-content" />
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
        <Animated.View
          entering={heroEntering}
          style={{ height: heroHeight }}
          testID="quiz-results-hero"
        >
          <View style={[styles.heroArcClip, heroArcStyle]}>
            {heroUri ? (
              <PhotoHero source={heroUri} scrim="bottom" style={styles.hero}>
                {heroContent}
              </PhotoHero>
            ) : (
              <View style={[styles.hero, styles.heroFallback]}>{heroContent}</View>
            )}
          </View>
        </Animated.View>

        <View style={styles.sheet}>
          <Animated.View entering={sheetEntering} style={styles.sheetHeading}>
            <Text style={styles.sheetTitle}>Think they can beat you?</Text>
            <Text style={styles.body}>
              {questions.length > 0
                ? `Send the same ${questions.length} photos to your friends.`
                : 'Send the same photos to your friends.'}
            </Text>
          </Animated.View>

          <View style={styles.recapGrid} testID="quiz-recap">
            {questions.map((question, index) => {
              const verdict = verdictFor(playState?.answers[question.id]);
              return (
                <Animated.View
                  key={question.id}
                  entering={
                    animate
                      ? FadeIn.duration(DURATION_FAST).delay(DURATION_HERO + index * THUMB_STAGGER)
                      : undefined
                  }
                  style={styles.recapCell}
                >
                  <Pressable
                    onPress={editable ? () => openSwapPicker(question.id) : undefined}
                    disabled={!editable}
                    accessibilityRole={editable ? 'button' : undefined}
                    accessibilityLabel={editable ? 'Swap this photo' : undefined}
                    style={({ pressed }) => [
                      styles.recapThumb,
                      pressed && editable && styles.pressedDim,
                    ]}
                    testID={`quiz-recap-thumb-${question.position}`}
                  >
                    <Image
                      source={{ uri: question.image_url }}
                      style={styles.recapPhoto}
                      contentFit="cover"
                      recyclingKey={question.id}
                      cachePolicy="memory-disk"
                      transition={150}
                    />
                    {verdict ? (
                      verdict === 'unknown' ? (
                        <View
                          style={styles.recapUnknownDot}
                          testID={`quiz-recap-thumb-${question.position}-verdict-unknown`}
                        />
                      ) : (
                        <VerdictMark
                          verdict={verdict}
                          size={22}
                          style={styles.recapVerdict}
                          testID={`quiz-recap-thumb-${question.position}-verdict-${verdict}`}
                        />
                      )
                    ) : null}
                  </Pressable>
                </Animated.View>
              );
            })}
          </View>

          <Animated.View entering={footerEntering} style={styles.footer}>
            {state === 'revoked' ? (
              <Text style={styles.revokedNote} testID="quiz-revoked-note">
                Link revoked. The photos are gone from our servers.
              </Text>
            ) : needsAnswers ? (
              <Button
                title="Answer New Photo"
                onPress={handleAnswerNew}
                style={styles.primaryCta}
                testID="quiz-answer-new"
              />
            ) : (
              <Button
                title="Challenge Your Friends"
                onPress={handleShare}
                loading={shareMutation.isPending}
                leftIcon={<Ionicons name="share-outline" size={20} color={colors.midnightNavy} />}
                style={styles.primaryCta}
                testID="quiz-share"
              />
            )}
            {state === 'shared' && (
              <Button
                title="Revoke Link"
                variant="destructive"
                onPress={handleRevoke}
                loading={revokeMutation.isPending}
                testID="quiz-revoke"
              />
            )}
            {/* BELOW the CTA, never above it: appended, so it can never shove
                the button the user is reaching for. Renders nothing unless the
                trip continuation actually produced trips. */}
            <TripCrossSellRow onReviewTrips={handleReviewTrips} testID="quiz-trip-crosssell" />
          </Animated.View>
        </View>
      </ScrollView>

      {/* Pinned above the scroll: the way out must not scroll away. */}
      <View style={styles.topBar} pointerEvents="box-none">
        <QuizTopBar onClose={handleBack} icon="back" testID="quiz-results-top-bar" />
      </View>

      <Modal visible={swapTargetId !== null} animationType="slide" onRequestClose={closeSwapPicker}>
        {/* RN renders a Modal outside the app's provider, so the bar inside it
            would measure zero insets and ride under the status bar. Its own
            provider measures the real ones. */}
        <SafeAreaProvider>
          <Screen safeArea={false}>
            <QuizTopBar
              title="Swap Photo"
              onClose={closeSwapPicker}
              icon="back"
              variant="light"
              testID="quiz-swap-top-bar"
              rightActions={
                canRemove && swapTarget && !swappingCandidateId ? (
                  <GlassIconButton
                    icon="trash-outline"
                    onPress={() => {
                      const questionId = swapTarget.id;
                      resetSwapPicker();
                      handleRemove(questionId);
                    }}
                    accessibilityLabel="Remove this photo from the challenge"
                    testID={`quiz-remove-${swapTarget.position}`}
                  />
                ) : null
              }
            />
            <View
              style={[styles.pickerContainer, { paddingBottom: insets.bottom + 16 }]}
              testID="quiz-swap-picker"
            >
              <Text style={styles.body} testID="quiz-swap-status" accessibilityLiveRegion="polite">
                {swappingCandidateId
                  ? 'Swapping photo…'
                  : 'You will answer it before the challenge can be shared.'}
              </Text>
              {swapLoadFailed ? (
                <View style={styles.pickerError} testID="quiz-swap-error">
                  <Text style={styles.body}>
                    We could not load your photos right now. Please try again.
                  </Text>
                  <Button title="Try Again" variant="ghost" onPress={loadCandidates} />
                </View>
              ) : swapCandidates === null ? (
                <View style={styles.pickerLoading}>
                  <ActivityIndicator size="large" color={colors.sunsetGold} />
                </View>
              ) : swapCandidates.length === 0 ? (
                <Text style={styles.body}>
                  No other eligible photos were found in your library.
                </Text>
              ) : (
                <ScrollView
                  style={styles.candidateScroll}
                  contentContainerStyle={styles.candidateGrid}
                >
                  {swapCandidates.map((candidate, index) => {
                    const isSwapping = swappingCandidateId === candidate.id;
                    return (
                      <Pressable
                        key={candidate.id}
                        onPress={() => handlePickCandidate(candidate)}
                        disabled={swappingCandidateId !== null}
                        accessibilityRole="button"
                        accessibilityLabel="Use this photo"
                        accessibilityState={{
                          disabled: swappingCandidateId !== null,
                          busy: isSwapping,
                        }}
                        style={({ pressed }) => [
                          styles.candidateCell,
                          swappingCandidateId !== null && !isSwapping && styles.candidateDimmed,
                          pressed && swappingCandidateId === null && styles.pressedDim,
                        ]}
                        testID={`quiz-swap-candidate-${index}`}
                      >
                        <Image
                          source={{ uri: candidate.uri }}
                          style={[
                            styles.candidateThumb,
                            { width: candidateSize, height: candidateSize },
                          ]}
                          contentFit="cover"
                          recyclingKey={candidate.id}
                          cachePolicy="memory-disk"
                        />
                        {isSwapping ? (
                          <View
                            style={styles.candidateOverlay}
                            pointerEvents="none"
                            testID={`quiz-swap-candidate-${index}-loading`}
                          >
                            <ActivityIndicator size="small" color={colors.sunsetGold} />
                          </View>
                        ) : null}
                      </Pressable>
                    );
                  })}
                </ScrollView>
              )}
            </View>
          </Screen>
        </SafeAreaProvider>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    justifyContent: 'center',
  },
  errorState: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 12,
  },
  errorHeading: {
    fontFamily: fonts.playfair.bold,
    fontSize: 28,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  hero: {
    flex: 1,
  },
  heroArcClip: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: colors.midnightNavy,
  },
  heroFallback: {
    backgroundColor: colors.midnightNavy,
  },
  heroInner: {
    flex: 1,
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingHorizontal: 24,
    // Clears the deepest point of the arc so the score never grazes the curve.
    paddingBottom: 36,
    gap: 4,
  },
  heroEyebrow: {
    fontFamily: fonts.body.bold,
    fontSize: 12,
    letterSpacing: 3,
    textTransform: 'uppercase',
    color: withAlpha(colors.warmCream, 0.85),
    textAlign: 'center',
  },
  heroTitle: {
    fontFamily: fonts.playfair.bold,
    fontSize: 32,
    lineHeight: 38,
    color: colors.warmCream,
    textAlign: 'center',
  },
  sheet: {
    paddingHorizontal: 24,
    paddingTop: 24,
    gap: 16,
  },
  sheetHeading: {
    gap: 6,
  },
  sheetTitle: {
    fontFamily: fonts.playfair.bold,
    fontSize: 28,
    lineHeight: 34,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  body: {
    fontFamily: fonts.body.regular,
    fontSize: 15,
    lineHeight: 22,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  recapGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -4,
  },
  recapCell: {
    width: '20%',
    aspectRatio: 1,
    padding: 4,
  },
  pressedDim: {
    opacity: 0.6,
  },
  recapThumb: {
    flex: 1,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: colors.backgroundCard,
  },
  recapPhoto: {
    ...StyleSheet.absoluteFillObject,
  },
  recapVerdict: {
    position: 'absolute',
    bottom: 5,
    right: 5,
  },
  recapUnknownDot: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.stormGray,
    borderWidth: 2,
    borderColor: colors.cloudWhite,
  },
  // The one sanctioned stamp moment: a small artwork accent, revealed only
  // after the answer is already spoken by the row text.
  footer: {
    gap: 8,
    marginTop: 10,
  },
  primaryCta: {
    minHeight: 52,
  },
  revokedNote: {
    fontFamily: fonts.body.regular,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  pickerContainer: {
    flex: 1,
    paddingHorizontal: PICKER_GUTTER,
    paddingTop: 4,
    gap: 12,
  },
  pickerLoading: {
    flex: 1,
    justifyContent: 'center',
  },
  pickerError: {
    flex: 1,
    justifyContent: 'center',
    gap: 12,
  },
  candidateScroll: {
    flex: 1,
  },
  candidateGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: CANDIDATE_GAP,
    paddingBottom: 8,
  },
  candidateCell: {
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: withAlpha(colors.midnightNavy, 0.08),
  },
  candidateThumb: {
    borderRadius: 8,
  },
  candidateOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.overlayMedium,
    justifyContent: 'center',
    alignItems: 'center',
  },
  candidateDimmed: {
    opacity: 0.4,
  },
});
