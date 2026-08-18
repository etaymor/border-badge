/**
 * GuessWhereIntroScreen - the "show, don't tell" introduction (Q7).
 *
 * A full-bleed looping travel montage sets the stage; fixed copy and the
 * primary CTA sit over a navy scrim. "See how it works" expands a one-tap
 * miniature of the real game in place: a real sample photo, four country
 * options, and a small serif score acknowledgment naming the answer. The
 * loop holds still while that answered state is on screen and resumes when
 * the demo collapses. Reachable any time (entry card, My Challenges), not a
 * one-shot onboarding moment.
 *
 * Under Reduce Motion the video never mounts - a static poster stands in.
 */

import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import { Image, StatusBar, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn } from 'react-native-reanimated';

import { Button } from '@components/ui/Button';
import { colors, withAlpha } from '@constants/colors';
import { fonts } from '@constants/typography';
import { useReducedMotion } from '@hooks/useReducedMotion';
import { useStableCallback } from '@hooks/useStableCallback';
import type { RootStackScreenProps } from '@navigation/types';

import { GuessOption } from './components/GuessOption';
import { QuizTopBar } from './components/QuizTopBar';
import { SerifScore } from './components/SerifScore';
import { DURATION_BASE } from './components/motionTokens';
import { demoCountry, demoOptions, demoPhoto, introPoster, introVideo } from './sampleAssets';

type Props = RootStackScreenProps<'GuessWhereIntro'>;

/** Fisher-Yates copy-shuffle; called once per mount via a lazy initializer. */
function shuffled(options: readonly string[]): string[] {
  const result = [...options];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * The looping background video. Mounted only when motion is allowed, so the
 * Reduce Motion path never creates a native player. Mirrors the onboarding
 * screens' decoder discipline: release the source on blur, restore on focus.
 */
function IntroVideoBackground({
  paused,
  navigation,
}: {
  paused: boolean;
  navigation: Props['navigation'];
}) {
  const player = useVideoPlayer(introVideo, (player) => {
    player.loop = true;
    player.muted = true;
    player.audioMixingMode = 'mixWithOthers';
    player.play();
  });

  // The loop holds still while the demo's answered state is showing.
  useEffect(() => {
    try {
      if (paused) {
        player.pause();
      } else {
        player.play();
      }
    } catch {
      // Native player may be released
    }
  }, [paused, player]);

  // The focus listener reads the latest paused value through this ref (synced
  // in an effect - React-Compiler-safe), so the listeners below are added and
  // removed only on navigation/player identity changes, not on every pause
  // toggle.
  const pausedRef = useRef(paused);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  // Release the decoder on blur, restore on focus (mirrors WelcomeCarouselScreen).
  useEffect(() => {
    const unsubscribeFocus = navigation.addListener('focus', () => {
      try {
        player.replace(introVideo);
        if (!pausedRef.current) player.play();
      } catch {
        // Native player may be released
      }
    });
    const unsubscribeBlur = navigation.addListener('blur', () => {
      try {
        player.replace(null);
      } catch {
        // Native player may be released
      }
    });
    return () => {
      unsubscribeFocus();
      unsubscribeBlur();
    };
  }, [navigation, player]);

  return (
    <VideoView
      player={player}
      style={StyleSheet.absoluteFill}
      contentFit="cover"
      nativeControls={false}
      accessible={true}
      accessibilityLabel="Decorative video montage of travel moments"
      testID="guess-where-intro-video"
    />
  );
}

export function GuessWhereIntroScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const [demoVisible, setDemoVisible] = useState(false);
  const [guessed, setGuessed] = useState<number | null>(null);
  const [options] = useState<string[]>(() => shuffled(demoOptions));

  const revealShowing = demoVisible && guessed !== null;
  const guessedCorrect = guessed !== null && options[guessed] === demoCountry;

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

  const handleToggleDemo = useStableCallback(() => {
    if (demoVisible) {
      // Collapse resets the round; the background loop resumes.
      setDemoVisible(false);
      setGuessed(null);
    } else {
      setDemoVisible(true);
    }
  });

  const handleBack = useStableCallback(() => {
    navigation.goBack();
  });

  return (
    <View style={styles.stage}>
      <StatusBar barStyle="light-content" />

      {reduceMotion ? (
        <Image
          source={introPoster}
          style={styles.posterImage}
          resizeMode="cover"
          accessible={true}
          accessibilityLabel="Decorative still of a travel destination"
          testID="guess-where-intro-poster"
        />
      ) : (
        <IntroVideoBackground paused={revealShowing} navigation={navigation} />
      )}

      {/* Navy scrim keeps the type legible over arbitrary footage. */}
      <LinearGradient
        colors={[
          withAlpha(colors.midnightNavy, 0.6),
          withAlpha(colors.midnightNavy, 0.25),
          withAlpha(colors.midnightNavy, 0.92),
        ]}
        locations={[0, 0.4, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      <QuizTopBar title="Guess Where" onClose={handleBack} testID="quiz-intro-top-bar" />

      <View style={styles.body}>
        <Text style={styles.title}>How well do your friends know your world?</Text>
        <Text style={styles.copy}>
          Turn your travel photos into a challenge only your friends can solve.
        </Text>

        {demoVisible && (
          <Animated.View
            entering={reduceMotion ? undefined : FadeIn.duration(DURATION_BASE)}
            style={styles.demoBlock}
            testID="guess-where-demo"
          >
            <View style={styles.print}>
              <Image source={demoPhoto} style={styles.printImage} />
            </View>

            {guessed === null ? (
              <>
                <Text style={styles.prompt}>try one - where was this taken?</Text>
                <View style={styles.optionsGrid}>
                  {options.map((option, index) => (
                    <GuessOption
                      key={option}
                      label={option}
                      entranceDelay={reduceMotion ? 0 : 100 + index * 50}
                      onPress={() => handleGuess(index)}
                      style={styles.optionCell}
                      testID={`guess-where-demo-option-${index}`}
                    />
                  ))}
                </View>
              </>
            ) : (
              <Animated.View
                entering={reduceMotion ? undefined : FadeIn.duration(DURATION_BASE)}
                style={styles.revealBlock}
                testID="guess-where-demo-reveal"
              >
                <SerifScore
                  score={guessedCorrect ? 1 : 0}
                  total={1}
                  size="small"
                  testID="guess-where-demo-score"
                />
                <Text style={styles.revealLine}>
                  {guessedCorrect ? `Right: ${demoCountry}` : `It was ${demoCountry}`}
                </Text>
              </Animated.View>
            )}
          </Animated.View>
        )}
      </View>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 20 }]}>
        <Button
          title="Create Your Challenge"
          onPress={handleCreate}
          testID="guess-where-intro-create"
        />
        <Button
          title={demoVisible ? 'Hide the demo' : 'See how it works'}
          variant="ghost"
          onDark
          onPress={handleToggleDemo}
          testID="guess-where-intro-demo-toggle"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stage: {
    flex: 1,
    backgroundColor: colors.midnightNavy,
  },
  posterImage: {
    ...StyleSheet.absoluteFillObject,
    width: undefined,
    height: undefined,
  },
  body: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'center',
    gap: 12,
  },
  title: {
    fontFamily: fonts.playfair.bold,
    fontSize: 32,
    lineHeight: 38,
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
  demoBlock: {
    gap: 10,
    marginTop: 8,
  },
  print: {
    alignSelf: 'center',
    backgroundColor: colors.cloudWhite,
    padding: 8,
    borderRadius: 4,
    transform: [{ rotate: '-1.5deg' }],
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6,
  },
  printImage: {
    width: 216,
    height: 150,
    borderRadius: 2,
    resizeMode: 'cover',
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
    gap: 6,
    alignItems: 'center',
  },
  revealLine: {
    fontFamily: fonts.body.semiBold,
    fontSize: 15,
    lineHeight: 22,
    color: colors.warmCream,
    textAlign: 'center',
  },
  footer: {
    paddingHorizontal: 24,
    gap: 8,
  },
});
