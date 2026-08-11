import { memo } from 'react';
import { Image, StyleSheet, View } from 'react-native';

import { Text } from '@components/ui';
import { colors, withAlpha } from '@constants/colors';
import { fonts } from '@constants/typography';

import atlasLogo from '../../../../assets/atlasi-logo.png';
import { CARD_HEIGHT, CARD_WIDTH } from '../constants';
import type { QuizChallengeContext } from '../types';

interface QuizChallengeVariantProps {
  context: QuizChallengeContext;
}

/**
 * Quiz challenge results card (Travel Photo Quiz).
 * The share-moment artifact for R6: challenge framing with the owner's
 * score-to-beat as the DOMINANT element, sized for messages and stories
 * (same 9:16 canvas as the onboarding cards).
 *
 * Deliberately renders NO quiz photos: this card is always the public share
 * artifact, and messaging-app caches outlive revocation - so no personal
 * imagery ever leaves the app on it (mirrors the link-unfurl decision).
 */
export const QuizChallengeVariant = memo(function QuizChallengeVariant({
  context,
}: QuizChallengeVariantProps) {
  const { ownerDisplayName, scoreToBeat } = context;

  const attribution = ownerDisplayName ? `Set by ${ownerDisplayName}` : 'Set by a fellow traveler';

  return (
    <View style={styles.container} testID="quiz-challenge-card">
      {/* Challenge framing */}
      <View style={styles.header}>
        <Text style={styles.eyebrow}>TRAVEL PHOTO QUIZ</Text>
        <Text style={styles.title}>Think you know{'\n'}the world?</Text>
      </View>

      {/* Dominant score-to-beat, framed like a passport stamp */}
      <View style={styles.scoreArea}>
        <View style={styles.scorePlate} testID="quiz-challenge-score">
          <Text style={styles.scoreLabel}>THE SCORE TO BEAT</Text>
          <Text style={styles.scoreNumber}>{scoreToBeat.correct}</Text>
          <Text style={styles.scoreTotal}>of {scoreToBeat.total}</Text>
        </View>
      </View>

      {/* Attribution */}
      <View style={styles.attribution}>
        <Text
          style={styles.attributionName}
          numberOfLines={2}
          adjustsFontSizeToFit
          minimumFontScale={0.6}
          testID="quiz-challenge-attribution"
        >
          {attribution}
        </Text>
        <Text style={styles.attributionBody}>
          They guessed where their own travel photos were taken. Your turn.
        </Text>
      </View>

      {/* Footer with logo and tagline (matches the onboarding cards) */}
      <View style={styles.footer}>
        <Image source={atlasLogo} style={styles.footerLogo} resizeMode="contain" />
        <Text style={styles.tagline}>Can you beat it?</Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    backgroundColor: colors.warmCream,
    flexDirection: 'column',
    paddingTop: 64,
    paddingBottom: 30,
    paddingHorizontal: 28,
  },
  header: {
    alignItems: 'center',
    gap: 12,
  },
  eyebrow: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 13,
    color: withAlpha(colors.midnightNavy, 0.5),
    letterSpacing: 3,
  },
  title: {
    fontFamily: fonts.playfair.bold,
    fontSize: 36,
    lineHeight: 42,
    color: colors.midnightNavy,
    textAlign: 'center',
  },
  scoreArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scorePlate: {
    alignItems: 'center',
    paddingVertical: 28,
    paddingHorizontal: 48,
    borderWidth: 3,
    borderColor: withAlpha(colors.adobeBrick, 0.85),
    borderRadius: 20,
    transform: [{ rotate: '-2deg' }],
  },
  scoreLabel: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 12,
    color: withAlpha(colors.midnightNavy, 0.5),
    letterSpacing: 2.5,
    marginBottom: 4,
  },
  scoreNumber: {
    fontFamily: fonts.oswald.bold,
    fontSize: 140,
    lineHeight: 150,
    color: colors.adobeBrick,
  },
  scoreTotal: {
    fontFamily: fonts.oswald.medium,
    fontSize: 34,
    lineHeight: 40,
    color: colors.midnightNavy,
    marginTop: -8,
  },
  attribution: {
    alignItems: 'center',
    gap: 8,
    marginBottom: 28,
  },
  attributionName: {
    fontFamily: fonts.openSans.bold,
    fontSize: 18,
    lineHeight: 24,
    color: colors.midnightNavy,
    textAlign: 'center',
  },
  attributionBody: {
    fontFamily: fonts.openSans.regular,
    fontSize: 14,
    lineHeight: 20,
    color: withAlpha(colors.midnightNavy, 0.65),
    textAlign: 'center',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: withAlpha(colors.midnightNavy, 0.08),
    paddingTop: 18,
  },
  footerLogo: {
    width: 100,
    height: 30,
  },
  tagline: {
    fontFamily: fonts.oswald.medium,
    fontSize: 14,
    color: colors.midnightNavy,
    letterSpacing: 0.5,
  },
});
