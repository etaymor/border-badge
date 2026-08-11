/**
 * QuizResultsScreen - owner results, pre-share editing, and share.
 *
 * - The country score is the score-to-beat (R4): always rendered from the
 *   freshest quiz detail (the backend rescales it after swap/remove).
 * - The memory (year) score is OWNER-ONLY (AE3): it exists only in the
 *   completion payload passed via navigation params and is labeled as private.
 * - Swap/remove are available only pre-share (R5). A swap drops the local
 *   stored answer, so share stays hidden behind "Answer New Photo" until the
 *   owner has played the replacement (the backend enforces the same rule with
 *   QUIZ_OWNER_ANSWERS_INCOMPLETE).
 * - Share (R6) mints the slug, then presents the system share sheet with a
 *   challenge-framed message carrying the link and the score to beat.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import ViewShot from 'react-native-view-shot';

import { CARD_CAPTURE_OPTIONS } from '@components/share/constants';
import {
  OnboardingShareCard,
  ONBOARDING_SHARE_CARD_HEIGHT,
  ONBOARDING_SHARE_CARD_WIDTH,
} from '@components/share/OnboardingShareCard';
import { Button } from '@components/ui/Button';
import { Screen } from '@components/ui/Screen';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import {
  confirmRevokeQuiz,
  useQuiz,
  useRemoveQuizQuestion,
  useRevokeQuiz,
  useShareQuiz,
  useSwapQuizQuestion,
} from '@hooks/useQuizzes';
import { useProfile } from '@hooks/useProfile';
import { useStableCallback } from '@hooks/useStableCallback';
import { QUIZ_MIN_PHOTOS, type GeoEligibleCandidate } from '@services/quiz/candidateSelection';
import { loadPlayState, loadSwapCandidates, type QuizPlayState } from '@services/quiz/quizPlay';
import { Share } from '@utils/share';
import type { RootStackScreenProps } from '@navigation/types';

type Props = RootStackScreenProps<'QuizResults'>;

export function QuizResultsScreen({ navigation, route }: Props) {
  const { quizId, results } = route.params;

  const { data: quiz } = useQuiz(quizId);
  const { data: profile } = useProfile();
  const swapMutation = useSwapQuizQuestion(quizId);
  const removeMutation = useRemoveQuizQuestion(quizId);
  const shareMutation = useShareQuiz(quizId);
  const revokeMutation = useRevokeQuiz(quizId);

  // Off-screen host for the shareable challenge card (see the JSX below).
  const shareCardRef = useRef<ViewShot | null>(null);

  const [playState, setPlayState] = useState<QuizPlayState | null>(null);
  const [swapTargetId, setSwapTargetId] = useState<string | null>(null);
  const [swapCandidates, setSwapCandidates] = useState<GeoEligibleCandidate[] | null>(null);

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

  const openSwapPicker = useStableCallback(async (questionId: string) => {
    setSwapTargetId(questionId);
    setSwapCandidates(null);
    try {
      setSwapCandidates(await loadSwapCandidates());
    } catch {
      setSwapCandidates([]);
    }
  });

  const closeSwapPicker = useStableCallback(() => {
    setSwapTargetId(null);
    setSwapCandidates(null);
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

  const handleShare = useStableCallback(async () => {
    if (!scoreToBeat) return; // Unreachable: share renders only with a score.
    try {
      const shared = await shareMutation.mutateAsync();
      const message =
        `I scored ${scoreToBeat.correct} of ${scoreToBeat.total} guessing where my own ` +
        `travel photos were taken. Think you know the world better? Beat my score: ` +
        `${shared.share_url}`;
      // Capture the challenge results card (R6) so the story/message-sized
      // image joins this same Share payload. A capture failure never blocks
      // sharing the link itself.
      let cardImageUri: string | null = null;
      try {
        cardImageUri = (await shareCardRef.current?.capture?.()) ?? null;
      } catch (captureError) {
        console.warn(
          '[QuizResults] Card capture failed:',
          captureError instanceof Error ? captureError.message : captureError
        );
      }
      if (Platform.OS === 'ios') {
        // iOS shares message and url as separate activity items: the challenge
        // link rides inside the message, while the url slot carries the card
        // image (falling back to the link when capture failed).
        await Share.share({ message, url: cardImageUri ?? shared.share_url });
      } else {
        // Android's Share.share cannot attach a local file; the link-carrying
        // challenge message is the whole payload there.
        await Share.share({ message });
      }
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
          : 'Could not share your quiz. Please try again.'
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

  // Without navigation results, the score pair arrives with the quiz detail.
  if (!scoreToBeat) {
    return (
      <Screen>
        <View style={styles.loading} testID="quiz-results-loading">
          <ActivityIndicator size="large" color={colors.sunsetGold} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.heading}>Your Score to Beat</Text>
        <Text style={styles.score} testID="quiz-score-to-beat">
          {scoreToBeat.correct} of {scoreToBeat.total}
        </Text>
        <Text style={styles.body}>
          Friends who play your quiz will try to beat this country score.
        </Text>

        {results && results.memory_total > 0 && (
          <View style={styles.memoryCard} testID="quiz-memory-score">
            <Text style={styles.memoryTitle}>
              Memory: {results.memory_correct} of {results.memory_total} years right
            </Text>
            <Text style={styles.memoryBody}>
              Only you see this - friends only guess countries, never the year.
            </Text>
          </View>
        )}

        <Text style={styles.sectionTitle}>Your Photos</Text>
        {questions.map((question) => {
          const answer = playState?.answers[question.id];
          return (
            <View
              key={question.id}
              style={styles.reviewRow}
              testID={`quiz-review-${question.position}`}
            >
              <Image source={{ uri: question.image_url }} style={styles.thumb} resizeMode="cover" />
              <View style={styles.reviewBody}>
                {answer ? (
                  <>
                    <Text style={answer.placeCorrect ? styles.reviewRight : styles.reviewWrong}>
                      {answer.placeCorrect
                        ? `Right: ${answer.correctOption}`
                        : `It was ${answer.correctOption} - you picked ` +
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
                ) : (
                  <Text style={styles.reviewPending}>New photo - answer it before sharing</Text>
                )}
                {editable && (
                  <View style={styles.reviewActions}>
                    <Button
                      title="Swap"
                      variant="ghost"
                      onPress={() => openSwapPicker(question.id)}
                      testID={`quiz-swap-${question.position}`}
                    />
                    {canRemove && (
                      <Button
                        title="Remove"
                        variant="ghost"
                        onPress={() => handleRemove(question.id)}
                        testID={`quiz-remove-${question.position}`}
                      />
                    )}
                  </View>
                )}
              </View>
            </View>
          );
        })}

        <View style={styles.footer}>
          {state === 'revoked' ? (
            <Text style={styles.revokedNote} testID="quiz-revoked-note">
              Link revoked. Friends can no longer open this quiz, and its photos are removed from
              our servers.
            </Text>
          ) : needsAnswers ? (
            <Button title="Answer New Photo" onPress={handleAnswerNew} testID="quiz-answer-new" />
          ) : (
            <Button
              title="Share Challenge"
              onPress={handleShare}
              loading={shareMutation.isPending}
              testID="quiz-share"
            />
          )}
          {state === 'shared' && (
            <Button
              title="Revoke Link"
              variant="ghost"
              onPress={handleRevoke}
              loading={revokeMutation.isPending}
              testID="quiz-revoke"
            />
          )}
          <Button title="Done" variant="ghost" onPress={handleDone} testID="quiz-done" />
        </View>
      </ScrollView>

      {/* Off-screen host for the shareable challenge card. Mounted
          permanently (never hidden via opacity, which would capture blank)
          so capture() always has a laid-out view at share time. */}
      <View style={styles.shareCardHost} pointerEvents="none">
        <ViewShot ref={shareCardRef} options={CARD_CAPTURE_OPTIONS}>
          <OnboardingShareCard
            variant="quizChallenge"
            context={{
              ownerDisplayName: profile?.display_name ?? null,
              scoreToBeat,
            }}
          />
        </ViewShot>
      </View>

      <Modal visible={swapTargetId !== null} animationType="slide" onRequestClose={closeSwapPicker}>
        <Screen>
          <View style={styles.pickerContainer} testID="quiz-swap-picker">
            <Text style={styles.sectionTitle}>Pick a Replacement Photo</Text>
            <Text style={styles.body}>
              Choose another geotagged travel photo. You will answer its country and year before the
              quiz can be shared.
            </Text>
            {swapCandidates === null ? (
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
                      resizeMode="cover"
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
  content: {
    paddingHorizontal: 24,
    paddingVertical: 16,
    gap: 12,
  },
  loading: {
    flex: 1,
    justifyContent: 'center',
  },
  heading: {
    fontFamily: fonts.playfair.bold,
    fontSize: 28,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  score: {
    fontFamily: fonts.playfair.bold,
    fontSize: 40,
    color: colors.adobeBrick,
    textAlign: 'center',
  },
  body: {
    fontFamily: fonts.body.regular,
    fontSize: 15,
    lineHeight: 22,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  memoryCard: {
    backgroundColor: colors.backgroundCard,
    borderRadius: 12,
    padding: 16,
    gap: 4,
  },
  memoryTitle: {
    fontFamily: fonts.body.semiBold,
    fontSize: 16,
    color: colors.textPrimary,
  },
  memoryBody: {
    fontFamily: fonts.body.regular,
    fontSize: 13,
    lineHeight: 19,
    color: colors.textSecondary,
  },
  sectionTitle: {
    fontFamily: fonts.playfair.bold,
    fontSize: 20,
    color: colors.textPrimary,
    marginTop: 8,
  },
  reviewRow: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: colors.backgroundCard,
    borderRadius: 12,
    padding: 12,
  },
  thumb: {
    width: 72,
    height: 72,
    borderRadius: 8,
    backgroundColor: colors.backgroundPlaceholder,
  },
  reviewBody: {
    flex: 1,
    gap: 2,
  },
  reviewRight: {
    fontFamily: fonts.body.semiBold,
    fontSize: 14,
    color: colors.mossGreen,
  },
  reviewWrong: {
    fontFamily: fonts.body.semiBold,
    fontSize: 14,
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
  footer: {
    gap: 8,
    marginTop: 16,
  },
  revokedNote: {
    fontFamily: fonts.body.regular,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  shareCardHost: {
    position: 'absolute',
    top: 0,
    left: -ONBOARDING_SHARE_CARD_WIDTH * 2,
    width: ONBOARDING_SHARE_CARD_WIDTH,
    height: ONBOARDING_SHARE_CARD_HEIGHT,
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
  candidateGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  candidateThumb: {
    width: 100,
    height: 100,
    borderRadius: 8,
    backgroundColor: colors.backgroundPlaceholder,
  },
});
