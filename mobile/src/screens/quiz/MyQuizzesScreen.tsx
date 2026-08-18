/**
 * MyQuizzesScreen - the owner's Guess Where management surface.
 *
 * Lists every challenge the owner has with its lifecycle state and the
 * actions that state allows:
 * - building ("Draft"): resume creation / delete
 * - awaiting_owner_play ("Ready to play"): play now / delete
 * - playable ("Ready to share"): share (via the results screen)
 * - shared ("Shared"): view leaderboard (R14) / revoke
 * - revoked ("Revoked"): label only - a revoked challenge serves nothing
 *   publicly
 *
 * Challenges are fully independent of one another (R17); the create-another
 * entry point sits at the top.
 */

import { Image } from 'expo-image';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@components/ui/Button';
import { Screen } from '@components/ui/Screen';
import { colors, withAlpha } from '@constants/colors';
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

import { QuizTopBar, RowAction } from './components';
import { DURATION_FAST } from './components/motionTokens';
import { guessWhereMark } from './sampleAssets';

type Props = RootStackScreenProps<'MyQuizzes'>;

const STATE_LABELS: Record<string, string> = {
  building: 'Draft',
  awaiting_owner_play: 'Ready to play',
  playable: 'Ready to share',
  shared: 'Shared',
  revoked: 'Revoked',
};

/** State pill colors: each lifecycle stage reads at a glance. */
const STATE_PILLS: Record<string, { bg: string; text: string }> = {
  building: { bg: withAlpha(colors.stormGray, 0.15), text: colors.stormGray },
  awaiting_owner_play: { bg: withAlpha(colors.sunsetGold, 0.25), text: colors.textPrimary },
  playable: { bg: withAlpha(colors.mossGreen, 0.18), text: colors.mossGreen },
  shared: { bg: withAlpha(colors.lakeBlue, 0.35), text: colors.textPrimary },
  revoked: { bg: withAlpha(colors.stormGray, 0.15), text: colors.stormGray },
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
    // The results screen owns share (slug mint + share sheet).
    navigation.navigate('QuizResults', { quizId: quiz.id });
  });

  const handleLeaderboard = useStableCallback(() => {
    navigation.navigate('QuizLeaderboard', { quizId: quiz.id });
  });

  const handleDelete = useStableCallback(() => {
    if (deleteMutation.isPending) return;
    Alert.alert(
      'Delete challenge?',
      'This challenge and its photos are removed from our servers. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            deleteMutation.mutate(quiz.id, {
              onError: () => {
                Alert.alert('Error', 'Could not delete the challenge. Please try again.');
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
  const pill = STATE_PILLS[quiz.state] ?? STATE_PILLS.building;

  return (
    <View style={styles.row} testID={`quiz-row-${quiz.id}`}>
      {quiz.cover_image_url ? (
        <Image
          source={{ uri: quiz.cover_image_url }}
          style={styles.rowThumb}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={DURATION_FAST}
          testID={`quiz-cover-${quiz.id}`}
        />
      ) : (
        // A draft with no photos yet keeps the frame so rows stay aligned.
        <View style={[styles.rowThumb, styles.rowThumbEmpty]} />
      )}
      <View style={styles.rowBody}>
        <View style={styles.rowHeader}>
          <Text style={styles.rowTitle}>
            {createdAt ? `Challenge from ${createdAt}` : 'Challenge'}
          </Text>
          <View style={[styles.statePill, { backgroundColor: pill.bg }]}>
            <Text
              style={[styles.statePillText, { color: pill.text }]}
              testID={`quiz-state-${quiz.id}`}
            >
              {STATE_LABELS[quiz.state] ?? quiz.state}
            </Text>
          </View>
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
            <RowAction title="Resume" onPress={handleResume} testID={`quiz-resume-${quiz.id}`} />
          )}
          {quiz.state === 'awaiting_owner_play' && (
            <RowAction title="Play Now" onPress={handlePlay} testID={`quiz-play-${quiz.id}`} />
          )}
          {quiz.state === 'playable' && (
            <RowAction title="Share" onPress={handleShare} testID={`quiz-share-${quiz.id}`} />
          )}
          {quiz.state === 'shared' && (
            <>
              <RowAction
                title="Leaderboard"
                onPress={handleLeaderboard}
                testID={`quiz-leaderboard-${quiz.id}`}
              />
              <RowAction
                title="Revoke"
                tone="destructive"
                onPress={handleRevoke}
                loading={revokeMutation.isPending}
                testID={`quiz-revoke-${quiz.id}`}
              />
            </>
          )}
          {deletable && (
            <RowAction
              title="Delete"
              tone="destructive"
              onPress={handleDelete}
              loading={deleteMutation.isPending}
              testID={`quiz-delete-${quiz.id}`}
            />
          )}
        </View>
      </View>
    </View>
  );
}

export function MyQuizzesScreen({ navigation }: Props) {
  const { data: quizzes, isLoading, isError, refetch } = useMyQuizzes();

  const handleCreate = useStableCallback(() => {
    navigation.navigate('QuizCreation');
  });

  const handleBack = useStableCallback(() => {
    navigation.goBack();
  });

  const handleHowItWorks = useStableCallback(() => {
    navigation.navigate('GuessWhereIntro');
  });

  return (
    <Screen>
      <QuizTopBar
        title="Guess Where"
        onClose={handleBack}
        variant="light"
        testID="quiz-list-top-bar"
      />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.heading}>Your Challenges</Text>
        <Button title="New Challenge" onPress={handleCreate} testID="quiz-create-new" />
        <Button
          title="How It Works"
          variant="ghost"
          onPress={handleHowItWorks}
          testID="quiz-how-it-works"
        />

        {isLoading ? (
          <View style={styles.loading}>
            <ActivityIndicator size="large" color={colors.sunsetGold} />
          </View>
        ) : isError ? (
          <View style={styles.errorState} testID="quiz-list-error">
            <Text style={styles.body}>
              We could not load your challenges right now. Please try again.
            </Text>
            <Button title="Try Again" variant="ghost" onPress={() => refetch()} />
          </View>
        ) : !quizzes || quizzes.length === 0 ? (
          <View style={styles.emptyState} testID="quiz-list-empty">
            <Image
              source={guessWhereMark}
              style={styles.emptyIllustration}
              contentFit="contain"
              testID="quiz-empty-mark"
            />
            <Text style={styles.emptyTitle}>No challenges yet</Text>
            <Text style={styles.body}>See if your friends can guess where you have been.</Text>
          </View>
        ) : (
          quizzes.map((quiz) => <QuizRow key={quiz.id} quiz={quiz} navigation={navigation} />)
        )}
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
  errorState: {
    paddingVertical: 24,
    gap: 8,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 24,
    gap: 8,
  },
  emptyIllustration: {
    width: 140,
    height: 140,
  },
  emptyTitle: {
    fontFamily: fonts.playfair.bold,
    fontSize: 22,
    color: colors.textPrimary,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: colors.backgroundCard,
    borderRadius: 20,
    padding: 16,
    shadowColor: colors.midnightNavy,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  rowThumb: {
    width: 64,
    height: 64,
    borderRadius: 12,
  },
  rowThumbEmpty: {
    backgroundColor: withAlpha(colors.midnightNavy, 0.08),
  },
  rowBody: {
    flex: 1,
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
  statePill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  statePillText: {
    fontFamily: fonts.body.semiBold,
    fontSize: 12,
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
