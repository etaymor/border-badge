/**
 * GuessWhereCard - the persistent home for Guess Where on the passport
 * screen (Q1/Q3). The feature is built out of the user's own travel photos,
 * so its entry point leads with the Guess Where compass mark.
 *
 * The card names the feature and says what the game is, in one line each -
 * it is an entry point on a crowded home screen, not a status readout. Where
 * it LEADS is still state-aware:
 * - no challenge yet: the playable intro (Q7)
 * - has challenges: My Challenges
 */

import * as Haptics from 'expo-haptics';
import { Animated, Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, withAlpha } from '@constants/colors';
import { fonts } from '@constants/typography';
import { useAnimatedPress } from '@hooks/useAnimatedPress';
import { useMyQuizzes } from '@hooks/useQuizzes';
import { useStableCallback } from '@hooks/useStableCallback';
import { guessWhereMark } from '@screens/quiz/sampleAssets';

interface GuessWhereCardProps {
  onOpenIntro: () => void;
  onOpenChallenges: () => void;
}

export function GuessWhereCard({ onOpenIntro, onOpenChallenges }: GuessWhereCardProps) {
  const { data: quizzes } = useMyQuizzes();
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
        <Image source={guessWhereMark} style={styles.illustration} />
        <View style={styles.body}>
          <Text style={styles.title}>Guess Where</Text>
          {/* One line by contract: it must not push the card taller. */}
          <Text style={styles.subtitle} numberOfLines={1}>
            A photo game for your friends
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
    marginTop: 16,
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
  },
  body: {
    flex: 1,
    gap: 1,
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
