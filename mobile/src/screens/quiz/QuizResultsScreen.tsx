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
 * - The memory (year) score is OWNER-ONLY (AE3): it exists only in the
 *   completion payload passed via navigation params and is labeled private.
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

import * as Haptics from 'expo-haptics';
// expo-image, not react-native's Image: the swap picker shows up to
// SWAP_CANDIDATE_LIMIT (30) camera-roll ORIGINALS as 100pt thumbnails, and RN
// decodes each at its full 12MP source resolution regardless of display size.
// expo-image downsamples to the view and bounds its own cache.
import { Image } from 'expo-image';
import { useEffect, useMemo, useState } from 'react';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeInUp } from 'react-native-reanimated';

import { Button } from '@components/ui/Button';
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
import { getAllCountries } from '@services/countriesDb';
import { loadPlayState, loadSwapCandidates, type QuizPlayState } from '@services/quiz/quizPlay';
import type { RootStackScreenProps } from '@navigation/types';

import { getStampImage } from '../../assets/stampImages';

import { PhotoHero } from './components/PhotoHero';
import { PolaroidThumb, type PolaroidVerdict } from './components/PolaroidThumb';
import { RowAction } from './components/RowAction';
import { SerifScore } from './components/SerifScore';
import {
  DURATION_BASE,
  DURATION_FAST,
  DURATION_HERO,
  DURATION_SLOW,
} from './components/motionTokens';
import { presentChallengeShare } from './shareChallenge';

type Props = RootStackScreenProps<'QuizResults'>;

/** Per-thumbnail delay so the recap populates rapidly, not all at once. */
const THUMB_STAGGER = DURATION_FAST / 2;

export function QuizResultsScreen({ navigation, route }: Props) {
  // A restored navigation state can produce a param-less route (BUG-1):
  // degrade to the handled error state instead of throwing during render.
  const quizId = route.params?.quizId ?? '';
  const results = route.params?.results;
  const paramsMissing = !route.params?.quizId;
  const reduceMotion = useReducedMotion();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();

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
  const [reviewOpen, setReviewOpen] = useState(false);
  const [swapTargetId, setSwapTargetId] = useState<string | null>(null);
  const [swapCandidates, setSwapCandidates] = useState<GeoEligibleCandidate[] | null>(null);
  // Distinguishes a candidate-load failure from an empty library so the swap
  // modal can offer retry instead of the "no eligible photos" dead end.
  const [swapLoadFailed, setSwapLoadFailed] = useState(false);
  // Country name -> ISO2, resolved from the local countries DB. Powers the
  // small stamp accents in the opened review; absent names just skip the art.
  const [countryCodeByName, setCountryCodeByName] = useState<Record<string, string> | null>(null);

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

  useEffect(() => {
    let cancelled = false;
    getAllCountries()
      .then((countries) => {
        if (cancelled) return;
        setCountryCodeByName(
          Object.fromEntries(countries.map((country) => [country.name.toLowerCase(), country.code]))
        );
      })
      .catch(() => {
        // Purely decorative lookup: on failure the review simply has no stamps.
      });
    return () => {
      cancelled = true;
    };
  }, []);

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

  const questions = useMemo(
    () => (quiz ? [...quiz.questions].sort((a, b) => a.position - b.position) : []),
    [quiz]
  );
  // `results` is absent when arriving from My Quizzes (no fresh play-through);
  // everything below then renders from the fetched quiz detail alone.
  const state = quiz?.state ?? results?.state;
  const scoreToBeat = quiz?.score_to_beat ?? results?.score_to_beat;
  const editable = state === 'awaiting_owner_play' || state === 'playable';
  const canRemove = questions.length > QUIZ_MIN_PHOTOS;
  const unansweredCount = playState
    ? questions.filter((question) => !playState.answers[question.id]).length
    : 0;
  const needsAnswers = editable && unansweredCount > 0;

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

  const closeSwapPicker = useStableCallback(() => {
    setSwapTargetId(null);
    setSwapCandidates(null);
    setSwapLoadFailed(false);
  });

  const handlePickCandidate = useStableCallback((candidate: GeoEligibleCandidate) => {
    if (!swapTargetId || swapMutation.isPending) return;
    swapMutation.mutate(
      { questionId: swapTargetId, candidate },
      {
        onSuccess: () => {
          closeSwapPicker();
          // Force the owner through play for the new photo (R5): share stays
          // unavailable until the replacement is answered.
          navigation.navigate('QuizPlay', { quizId });
        },
        onError: () => {
          closeSwapPicker();
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

  const toggleReview = useStableCallback(() => {
    setReviewOpen((open) => !open);
  });

  const handleShare = useStableCallback(async () => {
    if (!scoreToBeat) return; // Unreachable: share renders only with a score.
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    try {
      const shared = await shareMutation.mutateAsync();
      await presentChallengeShare(shared.share_url, scoreToBeat);
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

  const handleDone = useStableCallback(() => {
    navigation.popToTop();
  });

  const handleBack = useStableCallback(() => {
    navigation.goBack();
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
  const heroHeight = Math.round(windowHeight * 0.46);

  const heroContent = (
    <View style={[styles.heroInner, { paddingTop: insets.top + 12 }]}>
      <Text style={styles.wordmark}>Atlasi</Text>
      <Text style={styles.heroTitle}>Your Score to Beat</Text>
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
          {heroUri ? (
            <PhotoHero uri={heroUri} scrim="bottom" style={styles.hero}>
              {heroContent}
            </PhotoHero>
          ) : (
            <View style={[styles.hero, styles.heroFallback]}>{heroContent}</View>
          )}
        </Animated.View>

        <View style={styles.sheet}>
          <Animated.View entering={sheetEntering}>
            <Text style={styles.body}>
              Friends who play your challenge will try to beat this country score.
            </Text>
          </Animated.View>

          {results && results.memory_total > 0 && (
            <Animated.View
              entering={sheetEntering}
              style={styles.memoryCard}
              testID="quiz-memory-score"
            >
              <Text style={styles.memoryTitle}>Memory</Text>
              <Text style={styles.memoryLine}>
                {results.memory_correct} of {results.memory_total} years right
              </Text>
              <Text style={styles.memoryFootnote}>Only you see this.</Text>
            </Animated.View>
          )}

          <View style={styles.recapRow} testID="quiz-recap">
            {questions.map((question, index) => {
              const answer = playState?.answers[question.id];
              const verdict: PolaroidVerdict | null = answer
                ? answer.verdictUnknown
                  ? 'unknown'
                  : answer.placeCorrect
                    ? 'correct'
                    : 'incorrect'
                : null;
              return (
                <Animated.View
                  key={question.id}
                  entering={
                    animate
                      ? FadeIn.duration(DURATION_FAST).delay(DURATION_HERO + index * THUMB_STAGGER)
                      : undefined
                  }
                >
                  <PolaroidThumb
                    uri={question.image_url}
                    index={index}
                    size={56}
                    verdict={verdict}
                    testID={`quiz-recap-thumb-${question.position}`}
                  />
                </Animated.View>
              );
            })}
          </View>

          <Button
            title={reviewOpen ? 'Hide Answers' : 'Review Answers'}
            variant="outline"
            onPress={toggleReview}
            testID="quiz-review-toggle"
          />

          {reviewOpen && (
            <View style={styles.reviewList}>
              {questions.map((question) => {
                const answer = playState?.answers[question.id];
                const stampCode =
                  answer && !answer.verdictUnknown
                    ? countryCodeByName?.[answer.correctOption.toLowerCase()]
                    : undefined;
                const stamp = stampCode ? getStampImage(stampCode) : null;
                return (
                  <View
                    key={question.id}
                    style={styles.reviewRow}
                    testID={`quiz-review-${question.position}`}
                  >
                    <View style={styles.reviewBody}>
                      {answer ? (
                        answer.verdictUnknown ? (
                          <Text style={styles.reviewYear}>
                            Answered - verdict syncs with your score.
                          </Text>
                        ) : (
                          <>
                            <Text
                              style={answer.placeCorrect ? styles.reviewRight : styles.reviewWrong}
                            >
                              {answer.placeCorrect
                                ? `Right: ${answer.correctOption}`
                                : `It was ${answer.correctOption} — you picked ` +
                                  `${question.options[answer.selectedOptionIndex] ?? 'another country'}`}
                            </Text>
                            {answer.correctYear != null && (
                              <Text style={styles.reviewYear}>
                                {answer.yearCorrect
                                  ? `Year remembered: ${answer.correctYear}`
                                  : `Taken in ${answer.correctYear}`}
                              </Text>
                            )}
                          </>
                        )
                      ) : (
                        <Text style={styles.reviewPending}>
                          New photo - answer it before sharing
                        </Text>
                      )}
                      {editable && (
                        <View style={styles.reviewActions}>
                          <RowAction
                            title="Swap"
                            onPress={() => openSwapPicker(question.id)}
                            testID={`quiz-swap-${question.position}`}
                          />
                          {canRemove && (
                            <RowAction
                              title="Remove"
                              tone="destructive"
                              onPress={() => handleRemove(question.id)}
                              testID={`quiz-remove-${question.position}`}
                            />
                          )}
                        </View>
                      )}
                    </View>
                    {stamp && (
                      <Image
                        source={stamp}
                        style={styles.stampAccent}
                        contentFit="contain"
                        testID={`quiz-review-stamp-${question.position}`}
                      />
                    )}
                  </View>
                );
              })}
            </View>
          )}

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
            <Button title="Done" variant="ghost" onPress={handleDone} testID="quiz-done" />
          </Animated.View>
        </View>
      </ScrollView>

      <Modal visible={swapTargetId !== null} animationType="slide" onRequestClose={closeSwapPicker}>
        <Screen>
          <View style={styles.pickerContainer} testID="quiz-swap-picker">
            <Text style={styles.sectionTitle}>Pick a Replacement Photo</Text>
            <Text style={styles.body}>You will answer it before the challenge can be shared.</Text>
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
              <Text style={styles.body}>No other eligible photos were found in your library.</Text>
            ) : (
              <ScrollView contentContainerStyle={styles.candidateGrid}>
                {swapCandidates.map((candidate, index) => (
                  <Pressable
                    key={candidate.id}
                    onPress={() => handlePickCandidate(candidate)}
                    disabled={swapMutation.isPending}
                    testID={`quiz-swap-candidate-${index}`}
                  >
                    <Image
                      source={{ uri: candidate.uri }}
                      style={styles.candidateThumb}
                      contentFit="cover"
                      recyclingKey={candidate.id}
                      cachePolicy="memory-disk"
                    />
                  </Pressable>
                ))}
              </ScrollView>
            )}
            <Button
              title="Cancel"
              variant="ghost"
              onPress={closeSwapPicker}
              disabled={swapMutation.isPending}
            />
          </View>
        </Screen>
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
  hero: {
    flex: 1,
  },
  heroFallback: {
    backgroundColor: colors.midnightNavy,
  },
  heroInner: {
    flex: 1,
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: 20,
    gap: 2,
  },
  wordmark: {
    fontFamily: fonts.body.bold,
    fontSize: 11,
    letterSpacing: 4,
    textTransform: 'uppercase',
    color: withAlpha(colors.warmCream, 0.85),
  },
  heroTitle: {
    fontFamily: fonts.playfair.bold,
    fontSize: 26,
    color: colors.warmCream,
    textAlign: 'center',
  },
  sheet: {
    paddingHorizontal: 24,
    paddingTop: 20,
    gap: 14,
  },
  body: {
    fontFamily: fonts.body.regular,
    fontSize: 15,
    lineHeight: 22,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  memoryCard: {
    backgroundColor: colors.paperBeige,
    borderRadius: 20,
    padding: 16,
    gap: 4,
  },
  memoryTitle: {
    fontFamily: fonts.playfair.bold,
    fontSize: 18,
    color: colors.textPrimary,
  },
  memoryLine: {
    fontFamily: fonts.body.semiBold,
    fontSize: 15,
    color: colors.textPrimary,
  },
  memoryFootnote: {
    fontFamily: fonts.body.regular,
    fontSize: 13,
    lineHeight: 19,
    color: colors.textSecondary,
  },
  recapRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 12,
    paddingVertical: 6,
  },
  reviewList: {
    gap: 10,
  },
  reviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.backgroundCard,
    borderRadius: 20,
    padding: 14,
  },
  reviewBody: {
    flex: 1,
    gap: 2,
  },
  reviewRight: {
    fontFamily: fonts.playfair.bold,
    fontSize: 16,
    color: colors.sunsetGold,
  },
  reviewWrong: {
    fontFamily: fonts.playfair.bold,
    fontSize: 16,
    color: colors.adobeBrick,
  },
  reviewYear: {
    fontFamily: fonts.body.regular,
    fontSize: 13,
    color: colors.textSecondary,
  },
  reviewPending: {
    fontFamily: fonts.body.semiBold,
    fontSize: 14,
    color: colors.adobeBrick,
  },
  reviewActions: {
    flexDirection: 'row',
    gap: 4,
  },
  // The one sanctioned stamp moment: a small artwork accent, revealed only
  // after the answer is already spoken by the row text.
  stampAccent: {
    width: 44,
    height: 44,
    opacity: 0.9,
  },
  sectionTitle: {
    fontFamily: fonts.playfair.bold,
    fontSize: 20,
    color: colors.textPrimary,
    marginTop: 8,
  },
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
    paddingHorizontal: 24,
    paddingVertical: 16,
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
  candidateGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  candidateThumb: {
    width: 100,
    height: 100,
    borderRadius: 8,
    backgroundColor: withAlpha(colors.midnightNavy, 0.08),
  },
});
