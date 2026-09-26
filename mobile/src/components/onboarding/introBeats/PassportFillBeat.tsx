import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated';

import { getStampImage } from '../../../assets/stampImages';
import { stampTilt } from '@components/photos/stampScatterLayout';
import { colors, withAlpha } from '@constants/colors';
import { fonts } from '@constants/typography';

import { PASSPORT_CODES } from './introBeatAssets';
import type { IntroBeatProps } from './introBeats';
import { INTRO_BEAT_TIMING, PASSPORT_MOTION, counterValueAt, popAt } from './introMotion';
import RollingCounter from './RollingCounter';
import { useIntroBeatClock } from './useIntroBeatClock';

const PAD = 16;
const HEADER_HEIGHT = 58;
const HEADER_GAP = 12;
const PAGE_PAD = 14;
const PAGE_TITLE_HEIGHT = 24;
const GRID_GAP = 8;
const COLUMNS = 3;
const POP_DURATION = 320;
const POP_SWING_DEG = 18;
const BAR_WIDTH = 112;
const COUNT_LINE_HEIGHT = 50;
const PERCENT_LINE_HEIGHT = 18;

interface PassportStampProps {
  code: string;
  order: number;
  size: number;
  clock: SharedValue<number>;
}

function PassportStamp({ code, order, size, clock }: PassportStampProps) {
  const tilt = stampTilt(code);
  const swing = order % 2 === 0 ? POP_SWING_DEG : -POP_SWING_DEG;
  const source = getStampImage(code);

  const animatedStyle = useAnimatedStyle(() => {
    const pop = popAt(clock.value, order * PASSPORT_MOTION.stampStagger, POP_DURATION);
    return {
      opacity: interpolate(pop, [0, 0.15], [0, 1], Extrapolation.CLAMP),
      transform: [
        { scale: 0.2 + 0.8 * pop },
        { rotate: `${tilt + swing * (1 - Math.min(1, pop))}deg` },
      ],
    };
  });

  return (
    <View style={[styles.slot, { width: size, height: size }]}>
      <Animated.View
        style={[StyleSheet.absoluteFill, animatedStyle]}
        testID={`intro-passport-stamp-${code}`}
      >
        {source ? (
          <Image
            source={source}
            style={styles.stampImage}
            contentFit="contain"
            cachePolicy="memory-disk"
            recyclingKey={code}
          />
        ) : null}
      </Animated.View>
    </View>
  );
}

interface WorldBarProps {
  clock: SharedValue<number>;
}

function WorldBar({ clock }: WorldBarProps) {
  const fillStyle = useAnimatedStyle(() => {
    const percent = counterValueAt(clock.value, PASSPORT_MOTION.worldPercent);
    return { transform: [{ translateX: -BAR_WIDTH * (1 - percent / 100) }] };
  });
  return (
    <View style={styles.barTrack}>
      <Animated.View style={[styles.barFill, fillStyle]} />
    </View>
  );
}

/**
 * Beat 3: an open passport page fills with stamps while the country count and
 * share of the world roll up. Plays once; the count is the payoff, so there is
 * no idle.
 */
export default function PassportFillBeat({
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
    ...INTRO_BEAT_TIMING.passport,
  });

  const pageWidth = width - PAD * 2;
  const pageHeight = height - PAD * 2 - HEADER_HEIGHT - HEADER_GAP;
  const stampSize = Math.max(
    0,
    Math.floor(
      Math.min(
        (pageWidth - PAGE_PAD * 2 - GRID_GAP * (COLUMNS - 1)) / COLUMNS,
        (pageHeight - PAGE_PAD * 2 - PAGE_TITLE_HEIGHT - GRID_GAP * 2) / 3
      )
    )
  );

  return (
    <View style={styles.stage} testID="intro-beat-passport">
      <View style={[styles.header, { height: HEADER_HEIGHT }]}>
        <View style={styles.countBlock}>
          <RollingCounter
            clock={entrance}
            target={PASSPORT_MOTION.countries}
            lineHeight={COUNT_LINE_HEIGHT}
            textStyle={styles.countText}
            testID="intro-passport-count"
          />
          <Text style={styles.countLabel}>countries</Text>
        </View>
        <View style={styles.worldBlock}>
          <View style={styles.percentRow}>
            <RollingCounter
              clock={entrance}
              target={PASSPORT_MOTION.worldPercent}
              lineHeight={PERCENT_LINE_HEIGHT}
              textStyle={styles.percentText}
              testID="intro-passport-percent"
            />
            <Text style={styles.percentText}>% of the world</Text>
          </View>
          <WorldBar clock={entrance} />
        </View>
      </View>

      <View style={[styles.passport, { width: pageWidth, height: pageHeight }]}>
        <View style={styles.cover} />
        <View style={styles.pageEdgeOuter} />
        <View style={styles.pageEdgeInner} />
        <View style={styles.page}>
          <Text style={styles.pageTitle}>VISAS</Text>
          <View style={[styles.grid, { width: stampSize * COLUMNS + GRID_GAP * (COLUMNS - 1) }]}>
            {PASSPORT_CODES.map((code, order) => (
              <PassportStamp
                key={code}
                code={code}
                order={order}
                size={stampSize}
                clock={entrance}
              />
            ))}
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stage: {
    ...StyleSheet.absoluteFillObject,
    padding: PAD,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginBottom: HEADER_GAP,
  },
  countBlock: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  countText: {
    fontFamily: fonts.playfair.bold,
    fontSize: 44,
    color: colors.warmCream,
  },
  countLabel: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 13,
    color: withAlpha(colors.warmCream, 0.75),
    marginBottom: 10,
  },
  worldBlock: {
    alignItems: 'flex-end',
    marginBottom: 10,
    gap: 6,
  },
  percentRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  percentText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 13,
    color: colors.sunsetGold,
  },
  barTrack: {
    width: BAR_WIDTH,
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
    backgroundColor: withAlpha(colors.warmCream, 0.16),
  },
  barFill: {
    width: BAR_WIDTH,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.sunsetGold,
  },
  passport: {
    alignSelf: 'center',
  },
  cover: {
    ...StyleSheet.absoluteFillObject,
    left: -5,
    top: 5,
    bottom: -5,
    borderRadius: 14,
    backgroundColor: colors.adobeBrick,
  },
  pageEdgeOuter: {
    ...StyleSheet.absoluteFillObject,
    right: -4,
    top: 4,
    bottom: -2,
    borderRadius: 12,
    backgroundColor: withAlpha(colors.paperBeige, 0.55),
  },
  pageEdgeInner: {
    ...StyleSheet.absoluteFillObject,
    right: -2,
    top: 2,
    bottom: -1,
    borderRadius: 12,
    backgroundColor: withAlpha(colors.paperBeige, 0.8),
  },
  page: {
    flex: 1,
    borderRadius: 12,
    backgroundColor: colors.paperBeige,
    padding: PAGE_PAD,
    alignItems: 'center',
  },
  pageTitle: {
    height: PAGE_TITLE_HEIGHT,
    fontFamily: fonts.oswald.medium,
    fontSize: 11,
    letterSpacing: 3,
    color: withAlpha(colors.stormGray, 0.8),
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID_GAP,
  },
  slot: {
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: withAlpha(colors.stormGray, 0.3),
  },
  stampImage: {
    width: '100%',
    height: '100%',
  },
});
