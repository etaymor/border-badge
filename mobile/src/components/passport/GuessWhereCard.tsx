/**
 * GuessWhereCard - the persistent home for Guess Where on the passport
 * screen (Q1/Q3). The feature is built out of the user's own travel photos,
 * so its entry point leads with imagery: the stacked-prints illustration and
 * a state-aware line.
 *
 * States:
 * - no challenge yet: invitation copy -> the playable intro (Q7)
 * - has challenges: latest state + score to beat -> My Challenges
 */

import * as Haptics from 'expo-haptics';
import { Animated, Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, withAlpha } from '@constants/colors';
import { fonts } from '@constants/typography';
import { useAnimatedPress } from '@hooks/useAnimatedPress';
import { useMyQuizzes, type QuizSummary } from '@hooks/useQuizzes';
import { useStableCallback } from '@hooks/useStableCallback';

/* eslint-disable @typescript-eslint/no-require-imports */
const polaroidsIllustration = require('../../../assets/illustations/polaroids-illustration.png');
/* eslint-enable @typescript-eslint/no-require-imports */

interface GuessWhereCardProps {
  onOpenIntro: () => void;
  onOpenChallenges: () => void;
}

function latestLine(quizzes: QuizSummary[]): string {
  const latest = quizzes[0];
  if (!latest) return '';
  switch (latest.state) {
    case 'building':
      return 'A draft is waiting - finish it and challenge your friends.';
    case 'awaiting_owner_play':
      return 'Your new challenge is ready - play it to set the score to beat.';
    case 'playable':
      return latest.score_to_beat
        ? `Score to beat: ${latest.score_to_beat.correct} of ${latest.score_to_beat.total}. Share it.`
        : 'Ready to share with your friends.';
    case 'shared':
      return latest.score_to_beat
        ? `Shared - can anyone beat your ${latest.score_to_beat.correct} of ${latest.score_to_beat.total}?`
        : 'Shared - see who takes the crown.';
    default:
      return 'Build a new challenge from your travel photos.';
  }
}

export function GuessWhereCard({ onOpenIntro, onOpenChallenges }: GuessWhereCardProps) {
  const { data: quizzes, isLoading } = useMyQuizzes();
  const { scaleValue, pressHandlers } = useAnimatedPress({ pressedScale: 0.97 });

  const hasQuizzes = !!quizzes && quizzes.length > 0;

  const handlePress = useStableCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (hasQuizzes) {
      onOpenChallenges();
    } else {
      onOpenIntro();
    }
  });

  // While the list loads, render the invitation state - it is right for new
  // users and only a heartbeat away from correct for returning ones.
  const subtitle =
    !isLoading && hasQuizzes
      ? latestLine(quizzes)
      : 'Can your friends guess where you have been? Deal them your photos.';

  return (
    <Animated.View style={[styles.wrapper, { transform: [{ scale: scaleValue }] }]}>
      <Pressable
        onPress={handlePress}
        {...pressHandlers}
        accessibilityRole="button"
        accessibilityLabel="Guess Where"
        style={styles.card}
        testID="guess-where-card"
      >
        <Image source={polaroidsIllustration} style={styles.illustration} />
        <View style={styles.body}>
          <Text style={styles.eyebrow}>Guess Where</Text>
          <Text style={styles.title}>{hasQuizzes ? 'Your challenges' : 'A new game'}</Text>
          <Text style={styles.subtitle} numberOfLines={2}>
            {subtitle}
          </Text>
        </View>
        <Text style={styles.chevron}>{'→'}</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginHorizontal: 16,
    marginTop: 4,
    marginBottom: 12,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.backgroundCard,
    borderRadius: 20,
    padding: 14,
    shadowColor: colors.midnightNavy,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 3,
  },
  illustration: {
    width: 64,
    height: 64,
    resizeMode: 'contain',
    transform: [{ rotate: '-4deg' }],
  },
  body: {
    flex: 1,
    gap: 1,
  },
  eyebrow: {
    fontFamily: fonts.body.bold,
    fontSize: 10,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.mossGreen,
  },
  title: {
    fontFamily: fonts.playfair.bold,
    fontSize: 18,
    color: colors.textPrimary,
  },
  subtitle: {
    fontFamily: fonts.body.regular,
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSecondary,
  },
  chevron: {
    fontFamily: fonts.body.semiBold,
    fontSize: 18,
    color: withAlpha(colors.midnightNavy, 0.5),
    paddingHorizontal: 2,
  },
});
