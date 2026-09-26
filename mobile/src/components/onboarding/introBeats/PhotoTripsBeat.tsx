import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { colors, withAlpha } from '@constants/colors';
import { fonts } from '@constants/typography';

import {
  CAMERA_ROLL_TILES,
  FOCUS_PLACE,
  TRIP_CARD,
  type IntroPlaceCategory,
} from './introBeatAssets';
import type { IntroBeatProps } from './introBeats';
import IntroCheck from './IntroCheck';
import IntroPin from './IntroPin';
import { INTRO_BEAT_TIMING, TRIPS_MOTION, easeOutCubic, popAt, segmentAt } from './introMotion';
import { useClockCue, useIntroBeatClock } from './useIntroBeatClock';

const COLUMNS = 3;
const GUTTER = 2;
const FOCUS_SHARE = 0.56;
const CARD_WIDTH = 300;
const CARD_HEIGHT = 346;
const CARD_MARGIN = 24;

/** Same colours the app uses for entry types (constants/entryTypes). */
const CATEGORY_COLORS: Record<IntroPlaceCategory, string> = {
  Place: colors.adobeBrick,
  Food: colors.entryFood,
  Stay: colors.entryStay,
  Experience: colors.entryExperience,
};

function resolveHaptic() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

interface Rect {
  x: number;
  y: number;
  size: number;
}

interface CheckProps {
  order: number;
  clock: SharedValue<number>;
}

/** The "found it" check the scan puts on each trip photo. */
function TripCheck({ order, clock }: CheckProps) {
  const style = useAnimatedStyle(() => {
    const pop = popAt(
      clock.value,
      TRIPS_MOTION.checkStart + order * TRIPS_MOTION.checkStagger,
      TRIPS_MOTION.checkPop
    );
    return { opacity: Math.min(1, pop), transform: [{ scale: 0.35 + 0.65 * pop }] };
  });
  return (
    <Animated.View style={[styles.check, style]}>
      <IntroCheck size={22} />
    </Animated.View>
  );
}

function CategoryChip({ category }: { category: IntroPlaceCategory }) {
  return (
    <View style={[styles.chip, { backgroundColor: withAlpha(CATEGORY_COLORS[category], 0.16) }]}>
      <View style={[styles.chipDot, { backgroundColor: CATEGORY_COLORS[category] }]} />
      <Text style={[styles.chipText, { color: CATEGORY_COLORS[category] }]}>{category}</Text>
    </View>
  );
}

interface PlaceRowProps {
  order: number;
  clock: SharedValue<number>;
}

function PlaceRow({ order, clock }: PlaceRowProps) {
  const place = TRIP_CARD.places[order];
  const style = useAnimatedStyle(() => {
    const pop = popAt(
      clock.value,
      TRIPS_MOTION.rowStart + order * TRIPS_MOTION.rowStagger,
      TRIPS_MOTION.rowPop
    );
    return {
      opacity: Math.min(1, pop),
      transform: [{ translateX: 14 * (1 - Math.min(1, pop)) }, { scale: 0.94 + 0.06 * pop }],
    };
  });
  return (
    <Animated.View style={[styles.row, style]} testID={`intro-trip-place-${order}`}>
      <Image source={place.thumb} style={styles.rowThumb} contentFit="cover" cachePolicy="none" />
      <Text style={styles.rowName} numberOfLines={1}>
        {place.name}
      </Text>
      <CategoryChip category={place.category} />
    </Animated.View>
  );
}

/**
 * Beat 1, the hook: rediscovery. The scan checks the trip photos in an
 * ordinary camera roll, one photo lifts out with "Where was this?", the tag
 * resolves into the place's name, and the found places gather into a rebuilt
 * Japan trip you can share. Plays once, then rests on the trip card.
 */
export default function PhotoTripsBeat({
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
    ...INTRO_BEAT_TIMING.trips,
  });
  useClockCue(
    entrance,
    TRIPS_MOTION.tagResolve[0],
    resolveHaptic,
    isActive && canPlay && !reduceMotion
  );

  const tileSize = (width - GUTTER * (COLUMNS - 1)) / COLUMNS;
  const rows = Math.max(1, Math.ceil(height / (tileSize + GUTTER)));
  const tiles: (Rect & { index: number })[] = Array.from({ length: rows * COLUMNS }, (_, i) => ({
    index: i % CAMERA_ROLL_TILES.length,
    x: (i % COLUMNS) * (tileSize + GUTTER),
    y: Math.floor(i / COLUMNS) * (tileSize + GUTTER),
    size: tileSize,
  }));
  const focusTile = tiles.find((tile) => CAMERA_ROLL_TILES[tile.index].focus) ?? tiles[0];
  const focusSize = Math.min(width, height) * FOCUS_SHARE;
  const focusTarget = { x: (width - focusSize) / 2, y: (height - focusSize) / 2 - 18 };
  const cardScale = Math.min(
    1,
    (height - CARD_MARGIN) / CARD_HEIGHT,
    (width - CARD_MARGIN * 2) / CARD_WIDTH
  );
  let checkOrder = 0;

  const gridStyle = useAnimatedStyle(() => {
    const dim = easeOutCubic(
      segmentAt(entrance.value, TRIPS_MOTION.gridDim[0], TRIPS_MOTION.gridDim[1])
    );
    return { opacity: 1 - 0.72 * dim, transform: [{ scale: 1 + 0.04 * dim }] };
  });

  const focusStyle = useAnimatedStyle(() => {
    const t = entrance.value;
    const lift = easeOutCubic(segmentAt(t, TRIPS_MOTION.lift[0], TRIPS_MOTION.lift[1]));
    const out = segmentAt(t, TRIPS_MOTION.focusOut[0], TRIPS_MOTION.focusOut[1]);
    const started = segmentAt(t, TRIPS_MOTION.lift[0], 1) > 0 ? 1 : 0;
    const fromScale = focusTile.size / focusSize;
    const dx = focusTile.x + focusTile.size / 2 - (focusTarget.x + focusSize / 2);
    const dy = focusTile.y + focusTile.size / 2 - (focusTarget.y + focusSize / 2);
    return {
      opacity: started * (1 - out),
      transform: [
        { translateX: dx * (1 - lift) },
        { translateY: dy * (1 - lift) },
        { scale: (fromScale + (1 - fromScale) * lift) * (1 - 0.12 * out) },
      ],
    };
  });

  const askStyle = useAnimatedStyle(() => {
    const t = entrance.value;
    return {
      opacity:
        segmentAt(t, TRIPS_MOTION.tagIn[0], TRIPS_MOTION.tagIn[1]) *
        (1 - segmentAt(t, TRIPS_MOTION.tagResolve[0], TRIPS_MOTION.tagResolve[1])),
    };
  });

  const foundStyle = useAnimatedStyle(() => {
    const t = entrance.value;
    const pop = popAt(t, TRIPS_MOTION.tagResolve[0], TRIPS_MOTION.tagResolve[1] + 120);
    return {
      opacity:
        Math.min(1, pop) * (1 - segmentAt(t, TRIPS_MOTION.focusOut[0], TRIPS_MOTION.focusOut[1])),
      transform: [{ scale: 0.85 + 0.15 * pop }],
    };
  });

  const cardStyle = useAnimatedStyle(() => {
    const p = easeOutCubic(
      segmentAt(entrance.value, TRIPS_MOTION.cardIn[0], TRIPS_MOTION.cardIn[1])
    );
    return { opacity: p, transform: [{ translateY: 30 * (1 - p) }, { scale: cardScale }] };
  });

  const shareStyle = useAnimatedStyle(() => {
    const pop = popAt(entrance.value, TRIPS_MOTION.share[0], TRIPS_MOTION.share[1]);
    return { opacity: Math.min(1, pop), transform: [{ scale: 0.8 + 0.2 * pop }] };
  });

  return (
    <View style={StyleSheet.absoluteFill} testID="intro-beat-trips">
      <Animated.View style={[StyleSheet.absoluteFill, gridStyle]}>
        {tiles.map((tile, i) => {
          const { source, trip } = CAMERA_ROLL_TILES[tile.index];
          const order = trip ? checkOrder++ : -1;
          return (
            <View
              key={i}
              style={[
                styles.tile,
                { left: tile.x, top: tile.y, width: tile.size, height: tile.size },
              ]}
            >
              <Image source={source} style={styles.fill} contentFit="cover" cachePolicy="none" />
              {trip ? <TripCheck order={order} clock={entrance} /> : null}
            </View>
          );
        })}
      </Animated.View>

      {/* The forgotten place: lifts out of the roll and gets its name back. */}
      <Animated.View
        style={[
          styles.focus,
          {
            left: focusTarget.x,
            top: focusTarget.y,
            width: focusSize,
            height: focusSize,
          },
          focusStyle,
        ]}
      >
        <Image
          source={CAMERA_ROLL_TILES.find((tile) => tile.focus)?.source}
          style={styles.fill}
          contentFit="cover"
          cachePolicy="none"
        />
        <View style={styles.tagSlot}>
          <Animated.View style={[styles.tag, askStyle]}>
            <Text style={styles.tagAsk}>Where was this?</Text>
          </Animated.View>
          <Animated.View style={[styles.tag, styles.tagFound, foundStyle]}>
            <IntroPin size={14} />
            <Text style={styles.tagPlace}>{FOCUS_PLACE.name}</Text>
          </Animated.View>
        </View>
      </Animated.View>

      {/* The rebuilt trip, full of named places. */}
      <View style={styles.cardSlot} pointerEvents="none">
        <Animated.View style={[styles.card, cardStyle]} testID="intro-trip-card">
          <View style={styles.cover}>
            {TRIP_CARD.cover.map((source, i) => (
              <Image
                key={i}
                source={source}
                style={styles.coverImage}
                contentFit="cover"
                cachePolicy="none"
              />
            ))}
          </View>
          <Text style={styles.country}>{TRIP_CARD.country}</Text>
          <Text style={styles.meta}>{TRIP_CARD.meta}</Text>
          <View style={styles.rows}>
            {TRIP_CARD.places.map((place, order) => (
              <PlaceRow key={place.name} order={order} clock={entrance} />
            ))}
          </View>
          <Animated.View style={[styles.share, shareStyle]} testID="intro-trip-share">
            <Text style={styles.shareText}>{TRIP_CARD.shareLabel}</Text>
          </Animated.View>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    position: 'absolute',
    overflow: 'hidden',
  },
  fill: {
    width: '100%',
    height: '100%',
  },
  check: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.black,
  },
  focus: {
    position: 'absolute',
    borderRadius: 18,
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderWidth: 3,
    borderColor: colors.warmCream,
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.35,
    shadowRadius: 18,
  },
  tagSlot: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 12,
    alignItems: 'center',
  },
  tag: {
    position: 'absolute',
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: withAlpha(colors.midnightNavy, 0.82),
  },
  tagFound: {
    backgroundColor: colors.warmCream,
  },
  tagAsk: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 13,
    color: colors.warmCream,
  },
  tagPlace: {
    fontFamily: fonts.openSans.bold,
    fontSize: 13,
    color: colors.midnightNavy,
  },
  cardSlot: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: 20,
    borderCurve: 'continuous',
    backgroundColor: colors.warmCream,
    padding: 12,
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.35,
    shadowRadius: 24,
  },
  cover: {
    flexDirection: 'row',
    gap: 3,
    height: 72,
    borderRadius: 12,
    overflow: 'hidden',
  },
  coverImage: {
    flex: 1,
    height: '100%',
  },
  country: {
    marginTop: 10,
    fontFamily: fonts.playfair.bold,
    fontSize: 22,
    lineHeight: 26,
    color: colors.midnightNavy,
  },
  meta: {
    fontFamily: fonts.openSans.regular,
    fontSize: 12,
    lineHeight: 18,
    color: colors.stormGray,
  },
  rows: {
    marginTop: 8,
  },
  row: {
    height: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(colors.midnightNavy, 0.12),
  },
  rowThumb: {
    width: 32,
    height: 32,
    borderRadius: 8,
  },
  rowName: {
    flex: 1,
    fontFamily: fonts.openSans.semiBold,
    fontSize: 14,
    color: colors.midnightNavy,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  chipDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  chipText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 11,
  },
  share: {
    marginTop: 8,
    height: 40,
    borderRadius: 999,
    // Navy, not gold: the screen's gold Continue is the only real action.
    backgroundColor: colors.midnightNavy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shareText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 14,
    color: colors.warmCream,
  },
});
