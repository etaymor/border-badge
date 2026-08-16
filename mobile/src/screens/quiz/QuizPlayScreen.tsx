/**
 * QuizPlayScreen - the owner plays their own quiz (R4).
 *
 * Per photo: the four country options first, then (when the photo has a
 * usable capture date) the year memory question - both picks are graded in a
 * SINGLE /answer call because the backend grades each question at most once
 * per session. Feedback is immediate after grading: right/wrong plus the
 * correct country (and the year verdict).
 *
 * Resume: every graded verdict is persisted locally with the session id
 * (`quizPlay.recordAnswer`), so killing the app mid-play resumes at the next
 * ungraded question. After the last answer the screen completes the session
 * (seeding the score-to-beat on first completion) and replaces itself with
 * QuizResults, handing over the owner-only results payload.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@components/ui/Button';
import { Screen } from '@components/ui/Screen';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { useAnswerQuizQuestion, useCompleteQuizPlay, useQuiz } from '@hooks/useQuizzes';
import { useStableCallback } from '@hooks/useStableCallback';
import {
  ensurePlaySession,
  recordAnswer,
  type QuizPlayState,
  type StoredQuizAnswer,
} from '@services/quiz/quizPlay';
import type { QuizAnswerResult } from '@hooks/useQuizzes';
import type { RootStackScreenProps } from '@navigation/types';

type Props = RootStackScreenProps<'QuizPlay'>;

type PlayPhase = 'loading' | 'country' | 'year' | 'feedback' | 'completing' | 'error';

/** The backend 409s when this (session, question) pair was already graded. */
function isAlreadyAnsweredConflict(error: unknown): boolean {
  return (error as { response?: { status?: number } })?.response?.status === 409;
}

export function QuizPlayScreen({ navigation, route }: Props) {
  // A restored navigation state can produce a param-less route (BUG-1):
  // degrade to the handled error phase instead of throwing during render.
  const quizId = route.params?.quizId;

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
  const [feedback, setFeedback] = useState<QuizAnswerResult | null>(null);
  // The tapped option pulses while its answer is in flight, so a slow submit
  // reads as "working" rather than a dead screen (BUG-1).
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
  const remainingAfterActive = playState
    ? questions.filter(
        (question) => !playState.answers[question.id] && question.id !== activeQuestionId
      ).length
    : 0;

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

  // Surface a quiz-load failure only once the fetch has settled: during a
  // retry's refetch, isError stays true while in flight, and flipping back to
  // 'error' then would make retry a no-op.
  useEffect(() => {
    if (quizLoadFailed && !quizFetching && phase === 'loading') setPhase('error');
  }, [quizLoadFailed, quizFetching, phase]);

  const goToNext = useStableCallback((state: QuizPlayState) => {
    setFeedback(null);
    setPendingCountryIndex(null);
    const next = questions.find((question) => !state.answers[question.id]);
    if (next) {
      setActiveQuestionId(next.id);
      setPhase('country');
    } else {
      completePlay(state);
    }
  });

  // Record a graded answer and move the screen forward. A failed local write
  // must NOT strand play (BUG-1): react-query never awaits mutate callbacks,
  // so a rejection here would otherwise float away with the phase unchanged
  // and every subsequent tap re-answering into a 409. The server has already
  // graded the answer - carry it in memory and let the next successful save
  // persist the full answers map (state is rebuilt immutably each time).
  const applyAnswer = useStableCallback(
    async (stored: StoredQuizAnswer, result: QuizAnswerResult | null) => {
      if (!playState) return;
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
      setPendingAnswerKey(null);
      setPlayState(nextState);
      if (result) {
        setFeedback(result);
        setPhase('feedback');
      } else {
        goToNext(nextState);
      }
    }
  );

  const submitAnswer = useStableCallback((optionIndex: number, year: number | null) => {
    if (!playState || !activeQuestion) return;
    const questionId = activeQuestion.id;
    answerMutation.mutate(
      {
        sessionId: playState.sessionId,
        questionId,
        selectedOptionIndex: optionIndex,
        selectedYear: year,
      },
      {
        onSuccess: (result) => {
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
            result
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
              null
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
    if (answerMutation.isPending) return;
    if (activeQuestion?.year_options?.length) {
      setPendingCountryIndex(optionIndex);
      setPhase('year');
    } else {
      setPendingAnswerKey(`option-${optionIndex}`);
      submitAnswer(optionIndex, null);
    }
  });

  const handleSelectYear = useStableCallback((year: number) => {
    if (answerMutation.isPending || pendingCountryIndex === null) return;
    setPendingAnswerKey(`year-${year}`);
    submitAnswer(pendingCountryIndex, year);
  });

  const handleNext = useStableCallback(() => {
    if (!playState) return;
    goToNext(playState);
  });

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

  return (
    <Screen>
      <View style={styles.container}>
        {(phase === 'loading' || phase === 'completing') && (
          <View style={styles.centered} testID="quiz-play-loading">
            <ActivityIndicator size="large" color={colors.sunsetGold} />
            {phase === 'completing' && <Text style={styles.body}>Tallying your score</Text>}
          </View>
        )}

        {phase === 'error' && (
          <View style={styles.centered} testID="quiz-play-error">
            <Text style={styles.title}>Something Went Wrong</Text>
            <Text style={styles.body}>
              We could not load your quiz right now. Your progress is saved - answered photos stay
              answered.
            </Text>
            <Button title="Try Again" onPress={handleRetry} />
            <Button title="Back" variant="ghost" onPress={handleBack} />
          </View>
        )}

        {showQuestion && activeQuestion && (
          <ScrollView contentContainerStyle={styles.questionContent}>
            <Text style={styles.progress} testID="quiz-play-progress">
              Photo {activeNumber} of {questions.length}
            </Text>
            <Image
              source={{ uri: activeQuestion.image_url }}
              style={styles.photo}
              resizeMode="cover"
              testID="quiz-play-photo"
            />
            {phase === 'country' ? (
              <>
                <Text style={styles.prompt} testID="quiz-country-prompt">
                  Where was this taken?
                </Text>
                <View style={styles.options}>
                  {activeQuestion.options.map((option, index) => (
                    <Button
                      key={option}
                      title={option}
                      variant="outline"
                      disabled={answerMutation.isPending}
                      loading={pendingAnswerKey === `option-${index}`}
                      onPress={() => handleSelectCountry(index)}
                      testID={`quiz-option-${index}`}
                    />
                  ))}
                </View>
              </>
            ) : (
              <>
                <Text style={styles.prompt} testID="quiz-year-prompt">
                  What year did you take this?
                </Text>
                <View style={styles.options}>
                  {(activeQuestion.year_options ?? []).map((year) => (
                    <Button
                      key={year}
                      title={String(year)}
                      variant="outline"
                      disabled={answerMutation.isPending}
                      loading={pendingAnswerKey === `year-${year}`}
                      onPress={() => handleSelectYear(year)}
                      testID={`quiz-year-${year}`}
                    />
                  ))}
                </View>
              </>
            )}
          </ScrollView>
        )}

        {phase === 'feedback' && feedback && (
          <View style={styles.centered} testID="quiz-feedback">
            <Text style={styles.title}>{feedback.place_correct ? 'Correct!' : 'Not quite'}</Text>
            <Text style={styles.body}>
              {feedback.place_correct
                ? `You knew it: ${feedback.correct_option}.`
                : `It was ${feedback.correct_option}.`}
            </Text>
            {feedback.correct_year != null && (
              <Text style={styles.body} testID="quiz-feedback-year">
                {feedback.year_correct
                  ? `And you remembered the year - ${feedback.correct_year}.`
                  : `It was taken in ${feedback.correct_year}.`}
              </Text>
            )}
            <Button
              title={remainingAfterActive > 0 ? 'Next Photo' : 'See Results'}
              onPress={handleNext}
              testID="quiz-feedback-next"
            />
          </View>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 24,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    gap: 16,
  },
  questionContent: {
    paddingVertical: 16,
    gap: 16,
  },
  progress: {
    fontFamily: fonts.body.semiBold,
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  photo: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: 12,
    backgroundColor: colors.backgroundPlaceholder,
  },
  prompt: {
    fontFamily: fonts.playfair.bold,
    fontSize: 22,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  options: {
    gap: 10,
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
});
