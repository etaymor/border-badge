import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { colors, withAlpha } from '@constants/colors';
import { fonts } from '@constants/typography';

import {
  GUESS_CORRECT_INDEX,
  GUESS_DECOY_INDEX,
  GUESS_OPTIONS,
  GUESS_PHOTO,
} from './introBeatAssets';
import type { IntroBeatProps } from './introBeats';
import { GUESS_MOTION, INTRO_BEAT_TIMING, easeOutCubic, popAt, segmentAt } from './introMotion';
import IntroCheck from './IntroCheck';
import { useClockCue, useIntroBeatClock } from './useIntroBeatClock';

const PAD = 16;
const CHIP_HEIGHT = 40;
const CHIP_GAP = 8;
const CARD_OVERLAP = 22;
const CHECK_SIZE = 18;

function successHaptic() {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}

interface ChoiceChipProps {
  index: number;
  label: string;
  width: number;
  clock: SharedValue<number>;
}

/** An inert answer chip in the quiz style (drawn, not the interactive GuessOption). */
function ChoiceChip({ index, label, width, clock }: ChoiceChipProps) {
  const isDecoy = index === GUESS_DECOY_INDEX;
  const isCorrect = index === GUESS_CORRECT_INDEX;
  const enterAt = GUESS_MOTION.chipStart + index * GUESS_MOTION.chipStagger;

  const chipStyle = useAnimatedStyle(() => {
    const t = clock.value;
    const p = segmentAt(t, enterAt, GUESS_MOTION.chipDuration);
    const press = isCorrect ? segmentAt(t, GUESS_MOTION.select[0], GUESS_MOTION.select[1]) : 0;
    return {
      opacity: p,
      transform: [
        { translateY: 16 * (1 - easeOutCubic(p)) },
        { scale: 1 - 0.02 * Math.sin(Math.PI * press) },
      ],
    };
  });

  const thinkStyle = useAnimatedStyle(() => {
    const t = clock.value;
    if (isDecoy) {
      return {
        opacity:
          segmentAt(t, GUESS_MOTION.thinkFirst[0], GUESS_MOTION.thinkFirst[1]) *
          (1 - segmentAt(t, GUESS_MOTION.thinkSecond[0], GUESS_MOTION.thinkSecond[1])),
      };
    }
    if (isCorrect) {
      return {
        opacity:
          segmentAt(t, GUESS_MOTION.thinkSecond[0], GUESS_MOTION.thinkSecond[1]) *
          (1 - segmentAt(t, GUESS_MOTION.select[0], GUESS_MOTION.select[1])),
      };
    }
    return { opacity: 0 };
  });

  const selectedStyle = useAnimatedStyle(() => ({
    opacity: isCorrect ? segmentAt(clock.value, GUESS_MOTION.select[0], GUESS_MOTION.select[1]) : 0,
  }));

  const correctStyle = useAnimatedStyle(() => ({
    opacity: isCorrect
      ? segmentAt(clock.value, GUESS_MOTION.correct[0], GUESS_MOTION.correct[1])
      : 0,
  }));

  const checkStyle = useAnimatedStyle(() => {
    const pop = isCorrect
      ? popAt(clock.value, GUESS_MOTION.correct[0] + 80, GUESS_MOTION.correct[1])
      : 0;
    return { opacity: Math.min(1, pop), transform: [{ scale: 0.3 + 0.7 * pop }] };
  });

  return (
    <Animated.View
      style={[styles.chip, { width }, chipStyle]}
      testID={`intro-guess-option-${index}`}
    >
      <Text style={styles.chipText}>{label}</Text>
      {isCorrect ? (
        <>
          <Animated.View style={[styles.layer, styles.selectedLayer, selectedStyle]}>
            <Text style={[styles.chipText, styles.chipTextOnDark]}>{label}</Text>
          </Animated.View>
          <Animated.View
            style={[styles.layer, styles.correctLayer, correctStyle]}
            testID="intro-guess-correct"
          >
            <Text style={[styles.chipText, styles.chipTextOnDark]}>{label}</Text>
            <Animated.View style={[styles.check, checkStyle]}>
              <IntroCheck size={CHECK_SIZE} color={colors.white} />
            </Animated.View>
          </Animated.View>
        </>
      ) : null}
      {isDecoy || isCorrect ? <Animated.View style={[styles.thinkRing, thinkStyle]} /> : null}
    </Animated.View>
  );
}

/**
 * Beat 4: Guess Where. A friend's trip photo, four countries, a moment of
 * doubt, then the right answer lands with a check and their score.
 */
export default function GuessWhereBeat({
  isActive,
  canPlay,
  reduceMotion,
  width,
  height,
}: IntroBeatProps) {
  const { entrance } = useIntroBeatClock({
    isActive,
    canPlay,
    reduceMotion,
    ...INTRO_BEAT_TIMING.guess_where,
  });
  useClockCue(
    entrance,
    GUESS_MOTION.correct[0],
    successHaptic,
    isActive && canPlay && !reduceMotion
  );

  const chipsTop = height - PAD - (CHIP_HEIGHT * 2 + CHIP_GAP);
  const cardHeight = Math.max(0, chipsTop + CARD_OVERLAP - PAD);
  const cardWidth = Math.max(0, Math.min(cardHeight * 0.75, width - PAD * 2 - 24));
  const gridWidth = Math.min(width - PAD * 2, cardWidth + 48);
  const chipWidth = (gridWidth - CHIP_GAP) / 2;

  const cardStyle = useAnimatedStyle(() => {
    const p = easeOutCubic(
      segmentAt(entrance.value, GUESS_MOTION.cardIn[0], GUESS_MOTION.cardIn[1])
    );
    return { transform: [{ rotate: `${-4 + 2 * p}deg` }, { scale: 0.96 + 0.04 * p }] };
  });

  const scoreStyle = useAnimatedStyle(() => {
    const p = segmentAt(entrance.value, GUESS_MOTION.score[0], GUESS_MOTION.score[1]);
    return { opacity: p, transform: [{ translateY: 8 * (1 - easeOutCubic(p)) }] };
  });

  const tagStyle = useAnimatedStyle(() => ({
    opacity: 1 - segmentAt(entrance.value, GUESS_MOTION.score[0], GUESS_MOTION.score[1]),
  }));

  return (
    <View style={StyleSheet.absoluteFill} testID="intro-beat-guess_where">
      <Animated.View
        style={[
          styles.card,
          { left: (width - cardWidth) / 2, top: PAD, width: cardWidth, height: cardHeight },
          cardStyle,
        ]}
      >
        <Image
          source={GUESS_PHOTO}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          cachePolicy="none"
        />
        <Animated.View style={[styles.tag, tagStyle]}>
          <Text style={styles.tagText}>Where was this?</Text>
        </Animated.View>
        <Animated.View style={[styles.score, scoreStyle]} testID="intro-guess-score">
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>M</Text>
          </View>
          <Text style={styles.scoreLabel}>Maya scored</Text>
          <Text style={styles.scoreValue}>
            8<Text style={styles.scoreOf}> / </Text>10
          </Text>
        </Animated.View>
      </Animated.View>

      <View
        style={[styles.grid, { left: (width - gridWidth) / 2, top: chipsTop, width: gridWidth }]}
      >
        {GUESS_OPTIONS.map((label, index) => (
          <ChoiceChip key={label} index={index} label={label} width={chipWidth} clock={entrance} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    borderRadius: 16,
    borderCurve: 'continuous',
    overflow: 'hidden',
    backgroundColor: withAlpha(colors.cloudWhite, 0.06),
  },
  tag: {
    position: 'absolute',
    top: 10,
    left: 10,
    borderRadius: 999,
    backgroundColor: withAlpha(colors.warmCream, 0.94),
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  tagText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 12,
    color: colors.midnightNavy,
  },
  score: {
    position: 'absolute',
    top: 10,
    left: 10,
    right: 10,
    borderRadius: 12,
    backgroundColor: withAlpha(colors.warmCream, 0.96),
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 8,
  },
  avatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.dustyCoral,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontFamily: fonts.playfair.bold,
    fontSize: 13,
    color: colors.warmCream,
  },
  scoreLabel: {
    flex: 1,
    fontFamily: fonts.openSans.semiBold,
    fontSize: 12,
    color: colors.midnightNavy,
  },
  scoreValue: {
    fontFamily: fonts.playfair.bold,
    fontSize: 20,
    color: colors.midnightNavy,
  },
  scoreOf: {
    fontFamily: fonts.playfair.regular,
    fontSize: 16,
    color: withAlpha(colors.midnightNavy, 0.55),
  },
  grid: {
    position: 'absolute',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: CHIP_GAP,
  },
  chip: {
    height: CHIP_HEIGHT,
    borderRadius: 14,
    backgroundColor: colors.warmCream,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
  },
  chipText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 14,
    color: colors.midnightNavy,
  },
  chipTextOnDark: {
    color: colors.warmCream,
  },
  layer: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectedLayer: {
    backgroundColor: colors.midnightNavy,
  },
  correctLayer: {
    backgroundColor: colors.mossGreen,
  },
  check: {
    position: 'absolute',
    right: 10,
  },
  thinkRing: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: colors.sunsetGold,
  },
});
