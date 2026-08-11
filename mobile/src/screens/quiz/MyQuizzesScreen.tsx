/**
 * MyQuizzesScreen - the owner's quiz management surface.
 *
 * Lists every quiz the owner has with its lifecycle state and the actions
 * that state allows:
 * - building ("Draft"): resume creation / delete
 * - awaiting_owner_play ("Ready to play"): play now / delete
 * - playable ("Ready to share"): share (via the results screen)
 * - shared ("Shared"): view leaderboard (R14) / revoke
 * - revoked ("Revoked"): label only - a revoked quiz serves nothing publicly
 *
 * Quizzes are fully independent of one another (R17); the create-another
 * entry point sits at the top.
 */

import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@components/ui/Button';
import { Screen } from '@components/ui/Screen';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import {
  confirmRevokeQuiz,
  useDeleteQuiz,
  useMyQuizzes,
  useRevokeQuiz,
  type QuizSummary,
} from '@hooks/useQuizzes';
import { useStableCallback } from '@hooks/useStableCallback';
import type { RootStackScreenProps } from '@navigation/types';

type Props = RootStackScreenProps<'MyQuizzes'>;

const STATE_LABELS: Record<string, string> = {
  building: 'Draft',
  awaiting_owner_play: 'Ready to play',
  playable: 'Ready to share',
  shared: 'Shared',
  revoked: 'Revoked',
};

// Pre-play states: resumable and safely deletable (nothing is shared yet).
const DELETABLE_STATES = new Set(['building', 'awaiting_owner_play']);

function formatCreatedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

interface QuizRowProps {
  quiz: QuizSummary;
  navigation: Props['navigation'];
}

function QuizRow({ quiz, navigation }: QuizRowProps) {
  const deleteMutation = useDeleteQuiz();
  const revokeMutation = useRevokeQuiz(quiz.id);

  const handleResume = useStableCallback(() => {
    navigation.navigate('QuizCreation');
  });

  const handlePlay = useStableCallback(() => {
    navigation.navigate('QuizPlay', { quizId: quiz.id });
  });

  const handleShare = useStableCallback(() => {
    // The results screen owns share (card capture + share sheet).
    navigation.navigate('QuizResults', { quizId: quiz.id });
  });

  const handleLeaderboard = useStableCallback(() => {
    navigation.navigate('QuizLeaderboard', { quizId: quiz.id });
  });

  const handleDelete = useStableCallback(() => {
    if (deleteMutation.isPending) return;
    Alert.alert(
      'Delete quiz?',
      'This quiz and its photos are removed from our servers. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            deleteMutation.mutate(quiz.id, {
              onError: () => {
                Alert.alert('Error', 'Could not delete the quiz. Please try again.');
              },
            });
          },
        },
      ]
    );
  });

  // Same honest disclosure as the results screen's revoke (R15), via the
  // shared confirmation.
  const handleRevoke = useStableCallback(() => {
    if (revokeMutation.isPending) return;
    confirmRevokeQuiz(() => {
      revokeMutation.mutate(undefined, {
        onError: () => {
          Alert.alert('Error', 'Could not revoke the link. Please try again.');
        },
      });
    });
  });

  const createdAt = formatCreatedAt(quiz.created_at);
  const photoCount =
    quiz.question_count > 0
      ? `${quiz.question_count} ${quiz.question_count === 1 ? 'photo' : 'photos'}`
      : null;
  const deletable = DELETABLE_STATES.has(quiz.state);

  return (
    <View style={styles.row} testID={`quiz-row-${quiz.id}`}>
      <View style={styles.rowHeader}>
        <Text style={styles.rowTitle}>{createdAt ? `Quiz from ${createdAt}` : 'Quiz'}</Text>
        <Text style={styles.stateLabel} testID={`quiz-state-${quiz.id}`}>
          {STATE_LABELS[quiz.state] ?? quiz.state}
        </Text>
      </View>
      {(photoCount || quiz.score_to_beat) && (
        <Text style={styles.rowMeta}>
          {[
            photoCount,
            quiz.score_to_beat
              ? `Score to beat: ${quiz.score_to_beat.correct} of ${quiz.score_to_beat.total}`
              : null,
          ]
            .filter(Boolean)
            .join(' - ')}
        </Text>
      )}
      <View style={styles.rowActions}>
        {quiz.state === 'building' && (
          <Button
            title="Resume"
            variant="ghost"
            onPress={handleResume}
            testID={`quiz-resume-${quiz.id}`}
          />
        )}
        {quiz.state === 'awaiting_owner_play' && (
          <Button
            title="Play Now"
            variant="ghost"
            onPress={handlePlay}
            testID={`quiz-play-${quiz.id}`}
          />
        )}
        {quiz.state === 'playable' && (
          <Button
            title="Share"
            variant="ghost"
            onPress={handleShare}
            testID={`quiz-share-${quiz.id}`}
          />
        )}
        {quiz.state === 'shared' && (
          <>
            <Button
              title="Leaderboard"
              variant="ghost"
              onPress={handleLeaderboard}
              testID={`quiz-leaderboard-${quiz.id}`}
            />
            <Button
              title="Revoke"
              variant="ghost"
              onPress={handleRevoke}
              loading={revokeMutation.isPending}
              testID={`quiz-revoke-${quiz.id}`}
            />
          </>
        )}
        {deletable && (
          <Button
            title="Delete"
            variant="ghost"
            onPress={handleDelete}
            loading={deleteMutation.isPending}
            testID={`quiz-delete-${quiz.id}`}
          />
        )}
      </View>
    </View>
  );
}

export function MyQuizzesScreen({ navigation }: Props) {
  const { data: quizzes, isLoading } = useMyQuizzes();

  const handleCreate = useStableCallback(() => {
    navigation.navigate('QuizCreation');
  });

  const handleBack = useStableCallback(() => {
    navigation.goBack();
  });

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.heading}>My Quizzes</Text>
        <Text style={styles.body}>
          Each quiz is its own challenge - build as many as you like from different trips.
        </Text>
        <Button title="Create New Quiz" onPress={handleCreate} testID="quiz-create-new" />

        {isLoading ? (
          <View style={styles.loading}>
            <ActivityIndicator size="large" color={colors.sunsetGold} />
          </View>
        ) : !quizzes || quizzes.length === 0 ? (
          <Text style={styles.body} testID="quiz-list-empty">
            No quizzes yet. Create one from your travel photos and challenge your friends.
          </Text>
        ) : (
          quizzes.map((quiz) => <QuizRow key={quiz.id} quiz={quiz} navigation={navigation} />)
        )}

        <Button title="Done" variant="ghost" onPress={handleBack} testID="quiz-list-done" />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 24,
    paddingVertical: 16,
    gap: 12,
  },
  heading: {
    fontFamily: fonts.playfair.bold,
    fontSize: 28,
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
  loading: {
    paddingVertical: 32,
  },
  row: {
    backgroundColor: colors.backgroundCard,
    borderRadius: 12,
    padding: 16,
    gap: 6,
  },
  rowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  rowTitle: {
    flex: 1,
    fontFamily: fonts.body.semiBold,
    fontSize: 16,
    color: colors.textPrimary,
  },
  stateLabel: {
    fontFamily: fonts.body.semiBold,
    fontSize: 13,
    color: colors.adobeBrick,
  },
  rowMeta: {
    fontFamily: fonts.body.regular,
    fontSize: 13,
    color: colors.textSecondary,
  },
  rowActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
});
