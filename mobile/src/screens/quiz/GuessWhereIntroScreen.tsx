/**
 * GuessWhereIntroScreen - the "show, don't tell" introduction (Q7).
 *
 * A one-tap miniature of the real game on the same dark stage the play
 * screen uses: a print deals in, the player makes a guess, and the stamp
 * press lands - the full loop in ten seconds, before asking for photo
 * permission or any commitment. Reachable any time (entry card, My
 * Challenges), not a one-shot onboarding moment.
 *
 * The demo print is a bundled illustration, never a user photo; when a real
 * sample travel photo is added to assets, swap it in here.
 */

import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Image, StatusBar, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import { Button } from '@components/ui/Button';
import { GlassBackButton } from '@components/ui/GlassBackButton';
import { colors, withAlpha } from '@constants/colors';
import { fonts } from '@constants/typography';
import { useReducedMotion } from '@hooks/useReducedMotion';
import { useStableCallback } from '@hooks/useStableCallback';
import type { RootStackScreenProps } from '@navigation/types';

import { GuessOption } from './components/GuessOption';
import { StampScorePlate } from './components/StampScorePlate';

/* eslint-disable @typescript-eslint/no-require-imports */
const polaroidsIllustration = require('../../../assets/illustations/polaroids-illustration.png');
/* eslint-enable @typescript-eslint/no-require-imports */

type Props = RootStackScreenProps<'GuessWhereIntro'>;

const DEMO_OPTIONS = ['Italy', 'Japan', 'Peru', 'Iceland'];

export function GuessWhereIntroScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const [guessed, setGuessed] = useState<number | null>(null);

  const handleGuess = useStableCallback((index: number) => {
    if (guessed !== null) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setGuessed(index);
    setTimeout(
      () => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      },
      reduceMotion ? 0 : 400
    );
  });

  const handleCreate = useStableCallback(() => {
    navigation.replace('QuizCreation');
  });

  const handleBack = useStableCallback(() => {
    navigation.goBack();
  });

  return (
    <View style={styles.stage}>
      <StatusBar barStyle="light-content" />
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <GlassBackButton onPress={handleBack} variant="dark" size="small" icon="close" />
      </View>

      <View style={styles.body}>
        <Text style={styles.eyebrow}>Guess Where</Text>
        <Text style={styles.title}>Your photos. Their guesses.</Text>
        <Text style={styles.copy}>
          We deal out photos from your trips. Friends guess the country each one was taken in - and
          try to beat your score.
        </Text>

        <Animated.View
          entering={reduceMotion ? undefined : FadeInDown.duration(350)}
          style={styles.polaroid}
        >
          <Image source={polaroidsIllustration} style={styles.polaroidImage} />
          <Text style={styles.polaroidCaption}>your photos here</Text>
        </Animated.View>

        {guessed === null ? (
          <View style={styles.demoBlock} testID="guess-where-demo">
            <Text style={styles.prompt}>try one - where was this taken?</Text>
            <View style={styles.optionsGrid}>
              {DEMO_OPTIONS.map((option, index) => (
                <GuessOption
                  key={option}
                  label={option}
                  entranceDelay={reduceMotion ? 0 : 150 + index * 50}
                  onPress={() => handleGuess(index)}
                  style={styles.optionCell}
                  testID={`guess-where-demo-option-${index}`}
                />
              ))}
            </View>
          </View>
        ) : (
          <Animated.View
            entering={reduceMotion ? undefined : FadeIn.duration(200)}
            style={styles.revealBlock}
            testID="guess-where-demo-reveal"
          >
            <StampScorePlate score={1} total={1} label="You've got it" animateIn size="small" />
            <Text style={styles.copy}>
              Exactly like that - except with your real travel photos, and a leaderboard of everyone
              who dares.
            </Text>
          </Animated.View>
        )}
      </View>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 20 }]}>
        <Button
          title="Make my first challenge"
          onPress={handleCreate}
          testID="guess-where-intro-create"
        />
        <Button title="Maybe later" variant="ghost" onPress={handleBack} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stage: {
    flex: 1,
    backgroundColor: colors.midnightNavy,
  },
  topBar: {
    paddingHorizontal: 16,
    alignItems: 'flex-start',
  },
  body: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'center',
    gap: 12,
  },
  eyebrow: {
    fontFamily: fonts.body.bold,
    fontSize: 12,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: colors.sunsetGold,
    textAlign: 'center',
  },
  title: {
    fontFamily: fonts.playfair.bold,
    fontSize: 30,
    lineHeight: 36,
    color: colors.warmCream,
    textAlign: 'center',
  },
  copy: {
    fontFamily: fonts.body.regular,
    fontSize: 15,
    lineHeight: 22,
    color: withAlpha(colors.warmCream, 0.85),
    textAlign: 'center',
  },
  polaroid: {
    alignSelf: 'center',
    backgroundColor: colors.cloudWhite,
    padding: 8,
    paddingBottom: 4,
    borderRadius: 4,
    transform: [{ rotate: '-2.5deg' }],
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6,
    marginVertical: 8,
  },
  polaroidImage: {
    width: 132,
    height: 132,
    resizeMode: 'contain',
  },
  polaroidCaption: {
    fontFamily: fonts.dawning.regular,
    fontSize: 15,
    color: colors.midnightNavy,
    textAlign: 'center',
    height: 24,
  },
  demoBlock: {
    gap: 10,
  },
  prompt: {
    fontFamily: fonts.dawning.regular,
    fontSize: 24,
    lineHeight: 28,
    color: colors.sunsetGold,
    textAlign: 'center',
  },
  optionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  optionCell: {
    flexBasis: '48%',
    flexGrow: 1,
  },
  revealBlock: {
    gap: 14,
    alignItems: 'center',
  },
  footer: {
    paddingHorizontal: 24,
    gap: 8,
  },
});
