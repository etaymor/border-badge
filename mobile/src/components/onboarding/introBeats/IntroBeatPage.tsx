import type { ComponentType } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';

import GuessWhereBeat from './GuessWhereBeat';
import type { IntroBeatCopy, IntroBeatProps } from './introBeats';
import { stageParallaxX, type IntroBeatKey } from './introMotion';
import PassportFillBeat from './PassportFillBeat';
import PhotoTripsBeat from './PhotoTripsBeat';
import SocialSaveBeat from './SocialSaveBeat';

const BEAT_VISUALS: Record<IntroBeatKey, ComponentType<IntroBeatProps>> = {
  trips: PhotoTripsBeat,
  share: SocialSaveBeat,
  passport: PassportFillBeat,
  guess_where: GuessWhereBeat,
};

const HEADLINE_LEAD = 40;
const SUBTEXT_LEAD = 64;

interface IntroBeatPageProps {
  beat: IntroBeatCopy;
  index: number;
  pageWidth: number;
  /** Height of the navy hero the visual fills (edge to edge). */
  heroHeight: number;
  textHeight: number;
  scrollX: SharedValue<number>;
  isActive: boolean;
  canPlay: boolean;
  reduceMotion: boolean;
  /** Mount the visual (only the settled page and its neighbours do). */
  showVisual: boolean;
}

/**
 * One intro page: the beat visual fills the navy hero edge to edge (the screen
 * draws the hero and the cream sheet behind the pager), then the copy sits on
 * the sheet. The visual is clipped to its own page and only trails the finger
 * mid-drag, so a neighbouring beat never shows at rest.
 */
export default function IntroBeatPage({
  beat,
  index,
  pageWidth,
  heroHeight,
  textHeight,
  scrollX,
  isActive,
  canPlay,
  reduceMotion,
  showVisual,
}: IntroBeatPageProps) {
  const Visual = BEAT_VISUALS[beat.key];

  const visualStyle = useAnimatedStyle(() => {
    const p = (scrollX.value - index * pageWidth) / pageWidth;
    return {
      transform: [{ translateX: reduceMotion ? 0 : stageParallaxX(p, pageWidth) }],
    };
  });

  const headlineStyle = useAnimatedStyle(() => {
    const p = Math.max(-1, Math.min(1, (scrollX.value - index * pageWidth) / pageWidth));
    return {
      opacity: Math.max(0, 1 - 1.6 * Math.abs(p)),
      transform: [{ translateX: reduceMotion ? 0 : -p * HEADLINE_LEAD }],
    };
  });

  const subtextStyle = useAnimatedStyle(() => {
    const p = Math.max(-1, Math.min(1, (scrollX.value - index * pageWidth) / pageWidth));
    return {
      opacity: Math.max(0, 1 - 2 * Math.abs(p)),
      transform: [{ translateX: reduceMotion ? 0 : -p * SUBTEXT_LEAD }],
    };
  });

  return (
    <View style={{ width: pageWidth }} testID={`carousel-slide-${index + 1}`}>
      <View
        style={[styles.hero, { width: pageWidth, height: heroHeight }]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
        testID={`intro-stage-${beat.key}`}
      >
        <Animated.View style={[StyleSheet.absoluteFill, visualStyle]}>
          {showVisual ? (
            <Visual
              isActive={isActive}
              canPlay={canPlay}
              reduceMotion={reduceMotion}
              width={pageWidth}
              height={heroHeight}
            />
          ) : null}
        </Animated.View>
      </View>

      <View style={[styles.copy, { height: textHeight }]}>
        <Animated.View style={headlineStyle}>
          {beat.kicker ? <Text style={styles.kicker}>{beat.kicker}</Text> : null}
          <Text style={styles.headline} accessibilityRole="header">
            {beat.headline}
          </Text>
        </Animated.View>
        <Animated.View style={subtextStyle}>
          <Text style={styles.subtext}>{beat.subtext}</Text>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    overflow: 'hidden',
  },
  copy: {
    paddingHorizontal: 28,
    paddingTop: 22,
    alignItems: 'center',
  },
  kicker: {
    fontFamily: fonts.oswald.medium,
    fontSize: 12,
    letterSpacing: 2.4,
    color: colors.adobeBrick,
    textAlign: 'center',
    marginBottom: 6,
  },
  headline: {
    fontFamily: fonts.playfair.bold,
    fontSize: 28,
    lineHeight: 34,
    letterSpacing: -0.56,
    color: colors.midnightNavy,
    textAlign: 'center',
  },
  subtext: {
    fontFamily: fonts.openSans.regular,
    fontSize: 15,
    lineHeight: 22,
    color: colors.midnightNavy,
    opacity: 0.72,
    textAlign: 'center',
    marginTop: 8,
  },
});
