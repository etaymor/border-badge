/**
 * QuizLeaderboardScreen - the owner's view of one challenge's leaderboard
 * (R14). The logbook of everyone who took the challenge.
 *
 * - One row per player name (AE4): best score with the attempt count, served
 *   pre-aggregated by GET /quiz/{id}/leaderboard.
 * - The owner's score-to-beat lands pinned at the top as the stamp plate.
 * - Hidden entries stay visible to the owner, marked "Hidden"; visible ones
 *   offer a hide action that hides every session behind the entry (the
 *   public board drops it on its next read).
 * - Sharing again lives here too: a leaderboard is where an owner decides the
 *   challenge needs more players, and until now the only share affordance was
 *   on the results screen, reachable only before the challenge was shared.
 *   The link already exists at this point, so this re-presents it rather than
 *   minting anything.
 */

import * as Haptics from 'expo-haptics';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@components/ui/Button';
import { Screen } from '@components/ui/Screen';
import { colors, withAlpha } from '@constants/colors';
import { fonts } from '@constants/typography';
import {
  useHideQuizSessions,
  useQuiz,
  useQuizLeaderboard,
  type QuizOwnerLeaderboardEntry,
} from '@hooks/useQuizzes';
import { useStableCallback } from '@hooks/useStableCallback';
import type { RootStackScreenProps } from '@navigation/types';

import { RowAction } from './components/RowAction';
import { StampScorePlate } from './components/StampScorePlate';
import { presentChallengeShare } from './shareChallenge';

type Props = RootStackScreenProps<'QuizLeaderboard'>;

export function QuizLeaderboardScreen({ navigation, route }: Props) {
  const { quizId } = route.params;

  const { data, isLoading, isError, refetch } = useQuizLeaderboard(quizId);
  const { data: quiz } = useQuiz(quizId);
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
  // Re-sharing needs the minted link and the score for the invitation text.
  // Both exist by the time a challenge has a leaderboard; if the detail has
  // not loaded yet the action simply is not offered.
  const shareUrl = quiz?.share_url ?? null;
  const canShare = !!shareUrl && !!scoreToBeat;

  const handleShare = useStableCallback(async () => {
    if (!shareUrl || !scoreToBeat) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    try {
      await presentChallengeShare(shareUrl, scoreToBeat);
    } catch (error) {
      console.warn(
        '[QuizLeaderboard] Share failed:',
        error instanceof Error ? error.message : error
      );
      Alert.alert('Error', 'Could not open the share sheet. Please try again.');
    }
  });

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.eyebrow}>Guess Where</Text>
        <Text style={styles.heading}>Leaderboard</Text>

        {scoreToBeat && (
          <StampScorePlate
            score={scoreToBeat.correct}
            total={scoreToBeat.total}
            label="Your score to beat"
            size="small"
            testID="leaderboard-score-to-beat"
          />
        )}

        {canShare && (
          <Button title="Share Challenge" onPress={handleShare} testID="leaderboard-share" />
        )}

        {isLoading ? (
          <View style={styles.loading}>
            <ActivityIndicator size="large" color={colors.sunsetGold} />
          </View>
        ) : isError ? (
          <View style={styles.errorState} testID="leaderboard-error">
            <Text style={styles.body}>
              We could not load the leaderboard right now. Please try again.
            </Text>
            <Button title="Try Again" variant="ghost" onPress={() => refetch()} />
          </View>
        ) : entries.length === 0 ? (
          <View style={styles.emptyState} testID="leaderboard-empty">
            <Text style={styles.emptyTitle}>No one has played yet</Text>
            <Text style={styles.body}>Share the link and check back here for the standings.</Text>
          </View>
        ) : (
          entries.map((entry, index) => (
            <View
              key={entry.session_ids[0] ?? `${entry.display_name}-${index}`}
              style={[styles.row, entry.hidden && styles.rowHidden]}
              testID={`leaderboard-entry-${index}`}
            >
              <View style={styles.rankBadge}>
                <Text style={styles.rank}>{index + 1}</Text>
              </View>
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
                <RowAction
                  title="Hide"
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
  eyebrow: {
    fontFamily: fonts.body.bold,
    fontSize: 12,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: colors.mossGreen,
    textAlign: 'center',
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
    gap: 6,
  },
  emptyTitle: {
    fontFamily: fonts.playfair.bold,
    fontSize: 22,
    color: colors.textPrimary,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.backgroundCard,
    borderRadius: 20,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  rowHidden: {
    opacity: 0.6,
  },
  rankBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: withAlpha(colors.adobeBrick, 0.6),
    alignItems: 'center',
    justifyContent: 'center',
  },
  rank: {
    fontFamily: fonts.playfair.bold,
    fontSize: 15,
    color: colors.adobeBrick,
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
