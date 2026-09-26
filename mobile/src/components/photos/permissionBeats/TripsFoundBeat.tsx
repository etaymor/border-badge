import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import Animated, { interpolate, useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { colors, withAlpha } from '@constants/colors';

import { DEFAULT_PERMISSION_BEAT_ASSETS, type PermissionBeatAssets } from './permissionBeatAssets';
import { PERMISSION_CHECK_STAGGER } from './permissionMotion';
import {
  permissionFadeAt,
  permissionPopAt,
  usePermissionBeatClock,
  type PermissionBeatTiming,
} from './usePermissionBeatFade';

/** 3 x 4 = exactly the twelve delivered stills; no tile is ever a stand-in. */
export const TRIPS_FOUND_COLUMNS = 3;
export const TRIPS_FOUND_ROWS = 4;
const TILE_COUNT = TRIPS_FOUND_COLUMNS * TRIPS_FOUND_ROWS;
const GUTTER = 3;
const TRAVEL_TILE_INDEXES = new Set([0, 1, 3, 4, 6, 7, 9, 10]);
const TRAVEL_TILE_COUNT = TRAVEL_TILE_INDEXES.size;
const CHECK_TIMING: PermissionBeatTiming = {
  count: TRAVEL_TILE_COUNT,
  stagger: PERMISSION_CHECK_STAGGER,
};

interface TripsFoundBeatProps {
  isActive: boolean;
  reduceMotion: boolean;
  assets?: PermissionBeatAssets;
}

interface CheckBadgeProps {
  order: number;
  shouldAnimate: boolean;
  clock: SharedValue<number>;
}

function CheckBadge({ order, shouldAnimate, clock }: CheckBadgeProps) {
  const animatedStyle = useAnimatedStyle(() => {
    const pop = permissionPopAt(clock.value, order, CHECK_TIMING.stagger);
    return {
      opacity: Math.min(1, pop) * permissionFadeAt(clock.value, CHECK_TIMING),
      transform: [{ scale: interpolate(pop, [0, 1], [0.35, 1]) }],
    };
  });
  const staticBadgeStyle = !shouldAnimate ? styles.finalBadgeState : undefined;

  return (
    <Animated.View
      testID={`permission-beat1-check-${order}`}
      style={[styles.badge, animatedStyle, staticBadgeStyle]}
    >
      <View style={styles.checkStem} />
      <View style={styles.checkArm} />
    </Animated.View>
  );
}

/**
 * Beat 1: the library as a full-bleed grid. The photos hold still; only the
 * checks pop onto the trip photos, fade, and pop again.
 */
export default function TripsFoundBeat({
  isActive,
  reduceMotion,
  assets = DEFAULT_PERMISSION_BEAT_ASSETS,
}: TripsFoundBeatProps) {
  const shouldAnimate = isActive && !reduceMotion;
  const clock = usePermissionBeatClock(shouldAnimate, CHECK_TIMING);
  const [frame, setFrame] = useState({ width: 0, height: 0 });
  let travelOrder = 0;
  const tileWidth =
    frame.width > 0
      ? (frame.width - GUTTER * (TRIPS_FOUND_COLUMNS - 1)) / TRIPS_FOUND_COLUMNS
      : undefined;
  const tileHeight =
    frame.height > 0
      ? (frame.height - GUTTER * (TRIPS_FOUND_ROWS - 1)) / TRIPS_FOUND_ROWS
      : undefined;

  return (
    <View
      testID="permission-beat-1"
      style={styles.grid}
      accessible={false}
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        setFrame((current) =>
          current.width === width && current.height === height ? current : { width, height }
        );
      }}
    >
      {Array.from({ length: TILE_COUNT }, (_, index) => {
        const source = assets.beat1?.[index];
        const isTravelTile = TRAVEL_TILE_INDEXES.has(index);
        const order = isTravelTile ? travelOrder++ : -1;

        return (
          <View
            key={index}
            testID={`permission-beat1-tile-${index}`}
            style={[
              styles.tile,
              tileWidth !== undefined && { width: tileWidth, height: tileHeight },
            ]}
          >
            {source ? (
              <Image
                testID={`permission-beat1-image-${index}`}
                source={source}
                style={styles.image}
                contentFit="cover"
              />
            ) : (
              <View
                testID={`permission-beat-placeholder-beat1-${index}`}
                style={[styles.image, styles.placeholder]}
              />
            )}
            {isTravelTile ? (
              <CheckBadge order={order} shouldAnimate={shouldAnimate} clock={clock} />
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GUTTER,
    alignContent: 'flex-start',
  },
  tile: {
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  placeholder: {
    backgroundColor: withAlpha(colors.cloudWhite, 0.06),
  },
  badge: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.black,
  },
  finalBadgeState: {
    opacity: 1,
    transform: [{ scale: 1 }],
  },
  checkStem: {
    position: 'absolute',
    left: 6.5,
    top: 12,
    width: 6,
    height: 2.5,
    borderRadius: 2,
    backgroundColor: colors.white,
    transform: [{ rotate: '45deg' }],
  },
  checkArm: {
    position: 'absolute',
    left: 9.5,
    top: 10,
    width: 10,
    height: 2.5,
    borderRadius: 2,
    backgroundColor: colors.white,
    transform: [{ rotate: '-48deg' }],
  },
});
