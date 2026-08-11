/**
 * QuizLeaderboardScreen - the owner's view of one quiz's leaderboard (R14).
 *
 * - One row per player name (AE4): best score with the attempt count, served
 *   pre-aggregated by GET /quiz/{id}/leaderboard.
 * - The owner's score-to-beat pair is pinned at the top.
 * - Hidden entries stay visible to the owner, marked "Hidden"; visible ones
 *   offer a hide action that hides every session behind the entry (the
 *   public board drops it on its next read).
 */

import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@components/ui/Button';
import { Screen } from '@components/ui/Screen';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import {
  useHideQuizSessions,
  useQuizLeaderboard,
  type QuizOwnerLeaderboardEntry,
} from '@hooks/useQuizzes';
import { useStableCallback } from '@hooks/useStableCallback';
import type { RootStackScreenProps } from '@navigation/types';

type Props = RootStackScreenProps<'QuizLeaderboard'>;

export function QuizLeaderboardScreen({ navigation, route }: Props) {
  const { quizId } = route.params;

  const { data, isLoading } = useQuizLeaderboard(quizId);
  const hideMutation = useHideQuizSessions(quizId);

  const handleHide = useStableCallback((entry: QuizOwnerLeaderboardEntry) => {
    if (hideMutation.isPending) return;
    Alert.alert(
      'Hide from leaderboard?',
      `"${entry.display_name}" will no longer appear on the public leaderboard. ` +
        'You will still see the entry here, marked as hidden.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Hide',
          style: 'destructive',
          onPress: () => {
            hideMutation.mutate(entry.session_ids, {
              onError: () => {
                Alert.alert('Error', 'Could not hide this entry. Please try again.');
              },
            });
          },
        },
      ]
    );
  });

  const handleDone = useStableCallback(() => {
    navigation.goBack();
  });

  const entries = data?.leaderboard ?? [];
  const scoreToBeat = data?.score_to_beat ?? null;

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.heading}>Leaderboard</Text>

        {scoreToBeat && (
          <View style={styles.scoreCard} testID="leaderboard-score-to-beat">
            <Text style={styles.scoreCardLabel}>Your score to beat</Text>
            <Text style={styles.scoreCardValue}>
              {scoreToBeat.correct} of {scoreToBeat.total}
            </Text>
          </View>
        )}

        {isLoading ? (
          <View style={styles.loading}>
            <ActivityIndicator size="large" color={colors.sunsetGold} />
          </View>
        ) : entries.length === 0 ? (
          <Text style={styles.body} testID="leaderboard-empty">
            No one has played your quiz yet. Share the link and check back here.
          </Text>
        ) : (
          entries.map((entry, index) => (
            <View
              key={entry.session_ids[0] ?? `${entry.display_name}-${index}`}
              style={styles.row}
              testID={`leaderboard-entry-${index}`}
            >
              <Text style={styles.rank}>{index + 1}</Text>
              <View style={styles.rowBody}>
                <Text style={styles.name} numberOfLines={1}>
                  {entry.display_name}
                </Text>
                <Text style={styles.meta}>
                  {entry.attempts === 1 ? '1 try' : `${entry.attempts} tries`}
                </Text>
              </View>
              <Text style={styles.score}>
                {scoreToBeat ? `${entry.best_score} of ${scoreToBeat.total}` : entry.best_score}
              </Text>
              {entry.hidden ? (
                <Text style={styles.hiddenTag} testID={`leaderboard-hidden-${index}`}>
                  Hidden
                </Text>
              ) : (
                <Button
                  title="Hide"
                  variant="ghost"
                  onPress={() => handleHide(entry)}
                  testID={`leaderboard-hide-${index}`}
                />
              )}
            </View>
          ))
        )}

        <Button title="Done" variant="ghost" onPress={handleDone} testID="leaderboard-done" />
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
  scoreCard: {
    backgroundColor: colors.backgroundCard,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    gap: 4,
  },
  scoreCardLabel: {
    fontFamily: fonts.body.semiBold,
    fontSize: 14,
    color: colors.textSecondary,
  },
  scoreCardValue: {
    fontFamily: fonts.playfair.bold,
    fontSize: 32,
    color: colors.adobeBrick,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.backgroundCard,
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  rank: {
    fontFamily: fonts.playfair.bold,
    fontSize: 18,
    color: colors.textSecondary,
    minWidth: 24,
  },
  rowBody: {
    flex: 1,
    gap: 2,
  },
  name: {
    fontFamily: fonts.body.semiBold,
    fontSize: 16,
    color: colors.textPrimary,
  },
  meta: {
    fontFamily: fonts.body.regular,
    fontSize: 13,
    color: colors.textSecondary,
  },
  score: {
    fontFamily: fonts.body.semiBold,
    fontSize: 16,
    color: colors.adobeBrick,
  },
  hiddenTag: {
    fontFamily: fonts.body.semiBold,
    fontSize: 13,
    color: colors.textSecondary,
  },
});
