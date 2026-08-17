/**
 * QuizLeaderboardScreen - the owner's view of one challenge's leaderboard
 * (R14). The logbook of everyone who took the challenge.
 *
 * Staged photo-first, like the results screen: one challenge photo settles
 * full-bleed under the navy scrim with the Playfair "Leaderboard" title, the
 * "Who knows {owner}'s world best?" support line, and the creator benchmark
 * as a small serif score. The standings live on the cream sheet below as
 * quiet ledger rows - rank, name, score, nothing else.
 *
 * - One row per player name (AE4): best score, served pre-aggregated by
 *   GET /quiz/{id}/leaderboard.
 * - A name that arrives while the board is open slides into rank (layout
 *   transition) with a pale-gold wash fading out; the initial board never
 *   plays the treatment, so a revisit never replays it. Reduce Motion swaps
 *   plainly.
 * - Hidden entries stay visible to the owner, marked "Hidden" and dimmed;
 *   visible ones offer a hide action that hides every session behind the
 *   entry (the public board drops it on its next read).
 * - Sharing again lives here too: a leaderboard is where an owner decides the
 *   challenge needs more players. The link already exists at this point, so
 *   this re-presents it rather than minting anything.
 */

import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { Button } from '@components/ui/Button';
import { Screen } from '@components/ui/Screen';
import { colors, withAlpha } from '@constants/colors';
import { fonts } from '@constants/typography';
import { useProfile } from '@hooks/useProfile';
import {
  useHideQuizSessions,
  useQuiz,
  useQuizLeaderboard,
  type QuizOwnerLeaderboardEntry,
} from '@hooks/useQuizzes';
import { useReducedMotion } from '@hooks/useReducedMotion';
import { useStableCallback } from '@hooks/useStableCallback';
import type { RootStackScreenProps } from '@navigation/types';

import { PhotoHero } from './components/PhotoHero';
import { RowAction } from './components/RowAction';
import { SerifScore } from './components/SerifScore';
import { DURATION_BASE, DURATION_HERO, DURATION_SLOW } from './components/motionTokens';
import { resultsAccent } from './sampleAssets';
import { presentChallengeShare } from './shareChallenge';

type Props = RootStackScreenProps<'QuizLeaderboard'>;

/**
 * The arrival wash fades over ~1.2s - deliberately longer than the motion
 * tokens so a glance up from the share sheet still catches it.
 */
const FRESH_WASH_FADE = DURATION_HERO * 2;

interface LeaderboardRowProps {
  entry: QuizOwnerLeaderboardEntry;
  index: number;
  total: number | null;
  /** True when this name was not on the previously rendered board. */
  fresh: boolean;
  reduceMotion: boolean;
  onHide: (entry: QuizOwnerLeaderboardEntry) => void;
}

function LeaderboardRow({ entry, index, total, fresh, reduceMotion, onHide }: LeaderboardRowProps) {
  const wash = useSharedValue(0);

  // A just-arrived row flashes pale gold and fades out. Reduce Motion is a
  // plain swap: no wash, no displacement.
  useEffect(() => {
    if (!fresh || reduceMotion) return;
    wash.value = 1;
    wash.value = withDelay(DURATION_BASE, withTiming(0, { duration: FRESH_WASH_FADE }));
  }, [fresh, reduceMotion, wash]);

  const washStyle = useAnimatedStyle(() => ({ opacity: wash.value }));

  return (
    <Animated.View
      layout={reduceMotion ? undefined : LinearTransition.duration(DURATION_SLOW)}
      style={[styles.row, entry.hidden && styles.rowHidden]}
      testID={`leaderboard-entry-${index}`}
    >
      {fresh && !reduceMotion && (
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, styles.freshWash, washStyle]}
          testID={`leaderboard-fresh-${index}`}
        />
      )}
      <Text style={styles.rank}>{index + 1}</Text>
      <Text style={styles.name} numberOfLines={1}>
        {entry.display_name}
      </Text>
      <Text style={styles.score}>
        {total != null ? `${entry.best_score} / ${total}` : `${entry.best_score}`}
      </Text>
      {entry.hidden ? (
        <Text style={styles.hiddenTag} testID={`leaderboard-hidden-${index}`}>
          Hidden
        </Text>
      ) : (
        <RowAction
          title="Hide"
          onPress={() => onHide(entry)}
          testID={`leaderboard-hide-${index}`}
        />
      )}
    </Animated.View>
  );
}

export function QuizLeaderboardScreen({ navigation, route }: Props) {
  const { quizId } = route.params;
  const reduceMotion = useReducedMotion();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();

  const { data, isLoading, isError, refetch } = useQuizLeaderboard(quizId);
  const { data: quiz } = useQuiz(quizId);
  const { data: profile } = useProfile();
  const hideMutation = useHideQuizSessions(quizId);

  // Names on the previously rendered board, plus which of the current names
  // are new against it. `null` until the first board lands: the initial
  // render is never "an arrival", so a revisit never replays the wash.
  const [board, setBoard] = useState<{ names: Set<string>; fresh: Set<string> } | null>(null);

  useEffect(() => {
    if (!data) return;
    const names = new Set(data.leaderboard.map((entry) => entry.display_name));
    setBoard((prev) => {
      if (!prev) return { names, fresh: new Set<string>() };
      const fresh = new Set([...names].filter((name) => !prev.names.has(name)));
      // Same board (refetch with no arrivals): keep the previous object so
      // rows do not re-render for nothing.
      if (fresh.size === 0 && prev.fresh.size === 0 && names.size === prev.names.size) {
        return prev;
      }
      return { names, fresh };
    });
  }, [data]);

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

  // The hero photo: one challenge photo (the first question's, same choice as
  // the results reveal). The navy ground holds while the detail loads.
  const firstQuestion = quiz?.questions.length
    ? [...quiz.questions].sort((a, b) => a.position - b.position)[0]
    : null;
  const heroUri = firstQuestion?.image_url ?? null;
  const heroHeight = Math.round(windowHeight * 0.34);

  const ownerName = profile?.display_name?.trim() || null;
  const supportLine = ownerName
    ? `Who knows ${ownerName}'s world best?`
    : 'Who knows your world best?';

  const heroContent = (
    <View style={[styles.heroInner, { paddingTop: insets.top + 12 }]}>
      <Text style={styles.eyebrow}>Guess Where</Text>
      <Text style={styles.heading}>Leaderboard</Text>
      <Text style={styles.support}>{supportLine}</Text>
      {scoreToBeat && (
        <View style={styles.benchmark} testID="leaderboard-score-to-beat">
          <Text style={styles.benchmarkName}>{ownerName ?? 'You'}</Text>
          <Text style={styles.benchmarkDot}>·</Text>
          <SerifScore score={scoreToBeat.correct} total={scoreToBeat.total} size="small" />
        </View>
      )}
    </View>
  );

  return (
    <Screen safeArea={false}>
      <StatusBar barStyle="light-content" />
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
        <View style={{ height: heroHeight }} testID="leaderboard-hero">
          {heroUri ? (
            <PhotoHero uri={heroUri} scrim="bottom" style={styles.hero}>
              {heroContent}
            </PhotoHero>
          ) : (
            <View style={[styles.hero, styles.heroFallback]}>{heroContent}</View>
          )}
        </View>

        <View style={styles.sheet}>
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
              <Image
                source={resultsAccent}
                style={styles.emptyTrophy}
                contentFit="contain"
                testID="leaderboard-empty-trophy"
              />
              <Text style={styles.emptyTitle}>No scores yet</Text>
              <Text style={styles.body}>
                Share your challenge and check back here for the standings.
              </Text>
            </View>
          ) : (
            entries.map((entry, index) => (
              <LeaderboardRow
                key={entry.session_ids[0] ?? `${entry.display_name}-${index}`}
                entry={entry}
                index={index}
                total={scoreToBeat?.total ?? null}
                fresh={board?.fresh.has(entry.display_name) ?? false}
                reduceMotion={reduceMotion}
                onHide={handleHide}
              />
            ))
          )}

          <Button title="Done" variant="ghost" onPress={handleDone} testID="leaderboard-done" />
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
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
    paddingBottom: 18,
    gap: 2,
  },
  eyebrow: {
    fontFamily: fonts.body.bold,
    fontSize: 11,
    letterSpacing: 4,
    textTransform: 'uppercase',
    color: withAlpha(colors.warmCream, 0.85),
  },
  heading: {
    fontFamily: fonts.playfair.bold,
    fontSize: 30,
    color: colors.warmCream,
    textAlign: 'center',
  },
  support: {
    fontFamily: fonts.body.regular,
    fontSize: 14,
    lineHeight: 20,
    color: withAlpha(colors.warmCream, 0.85),
    textAlign: 'center',
  },
  benchmark: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    marginTop: 6,
  },
  benchmarkName: {
    fontFamily: fonts.body.semiBold,
    fontSize: 14,
    color: colors.warmCream,
  },
  benchmarkDot: {
    fontFamily: fonts.body.regular,
    fontSize: 14,
    color: withAlpha(colors.warmCream, 0.6),
  },
  sheet: {
    paddingHorizontal: 24,
    paddingTop: 16,
    gap: 12,
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
  emptyTrophy: {
    width: 72,
    height: 72,
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
    paddingVertical: 12,
    paddingHorizontal: 16,
    overflow: 'hidden',
  },
  rowHidden: {
    opacity: 0.6,
  },
  freshWash: {
    backgroundColor: withAlpha(colors.sunsetGold, 0.35),
    borderRadius: 20,
  },
  rank: {
    fontFamily: fonts.playfair.bold,
    fontSize: 18,
    color: colors.adobeBrick,
    minWidth: 24,
    textAlign: 'center',
  },
  name: {
    flex: 1,
    fontFamily: fonts.body.semiBold,
    fontSize: 16,
    color: colors.textPrimary,
  },
  score: {
    fontFamily: fonts.playfair.bold,
    fontSize: 17,
    color: colors.textPrimary,
    textAlign: 'right',
  },
  hiddenTag: {
    fontFamily: fonts.body.semiBold,
    fontSize: 13,
    color: colors.textSecondary,
  },
});
