import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import Animated, { interpolate, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { colors } from '@constants/colors';

import { DEFAULT_PERMISSION_BEAT_ASSETS, type PermissionBeatAssets } from './permissionBeatAssets';
import { PERMISSION_CHECK_STAGGER, permissionBeatVisibleMs } from './permissionMotion';
import { permissionPopLoop, usePermissionBeatFade } from './usePermissionBeatFade';

const COLUMNS = 4;
const ROWS = 5;
const TILE_COUNT = COLUMNS * ROWS;
const GUTTER = 4;
const TRAVEL_TILE_INDEXES = new Set([0, 1, 3, 4, 6, 7, 9, 10]);
const TRAVEL_TILE_COUNT = TRAVEL_TILE_INDEXES.size;
const AnimatedImage = Animated.createAnimatedComponent(Image);

interface TripsFoundBeatProps {
  isActive: boolean;
  reduceMotion: boolean;
  assets?: PermissionBeatAssets;
}

interface CheckBadgeProps {
  order: number;
  shouldAnimate: boolean;
}

function CheckBadge({ order, shouldAnimate }: CheckBadgeProps) {
  const progress = useSharedValue(shouldAnimate ? 0 : 1);

  useEffect(() => {
    progress.value = shouldAnimate
      ? permissionPopLoop(order, TRAVEL_TILE_COUNT, PERMISSION_CHECK_STAGGER)
      : 1;
  }, [order, progress, shouldAnimate]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: interpolate(progress.value, [0, 1], [0.35, 1]) }],
  }));
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

export default function TripsFoundBeat({
  isActive,
  reduceMotion,
  assets = DEFAULT_PERMISSION_BEAT_ASSETS,
}: TripsFoundBeatProps) {
  const shouldAnimate = isActive && !reduceMotion;
  const fadeStyle = usePermissionBeatFade(
    shouldAnimate,
    permissionBeatVisibleMs(TRAVEL_TILE_COUNT, PERMISSION_CHECK_STAGGER)
  );
  const [frame, setFrame] = useState({ width: 0, height: 0 });
  let travelOrder = 0;
  const tileWidth = frame.width > 0 ? (frame.width - GUTTER * (COLUMNS - 1)) / COLUMNS : undefined;
  const tileHeight = frame.height > 0 ? (frame.height - GUTTER * (ROWS - 1)) / ROWS : undefined;

  return (
    <Animated.View
      testID="permission-beat-1"
      style={[styles.grid, fadeStyle]}
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
              <AnimatedImage
                testID={`permission-beat1-image-${index}`}
                source={source}
                style={styles.image}
                contentFit="cover"
              />
            ) : (
              <View
                testID={`permission-beat-placeholder-beat1-${index}`}
                style={[styles.image, styles.placeholder, placeholderTints[index % 4]]}
              />
            )}
            {isTravelTile ? (
              <CheckBadge order={order} shouldAnimate={isActive && !reduceMotion} />
            ) : null}
          </View>
        );
      })}
    </Animated.View>
  );
}

const placeholderTints = [
  { backgroundColor: colors.lakeBlue },
  { backgroundColor: colors.dustyCoral },
  { backgroundColor: colors.latteGold },
  { backgroundColor: colors.mossGreen },
];

const styles = StyleSheet.create({
  grid: {
    flex: 1,
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GUTTER,
    alignContent: 'flex-start',
  },
  tile: {
    borderRadius: 8,
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  placeholder: {
    opacity: 0.72,
  },
  badge: {
    position: 'absolute',
    right: 5,
    bottom: 5,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.black,
  },
  finalBadgeState: {
    opacity: 1,
    transform: [{ scale: 1 }],
  },
  checkStem: {
    position: 'absolute',
    left: 6,
    top: 11,
    width: 6,
    height: 2.5,
    borderRadius: 2,
    backgroundColor: colors.white,
    transform: [{ rotate: '45deg' }],
  },
  checkArm: {
    position: 'absolute',
    left: 9,
    top: 9,
    width: 9,
    height: 2.5,
    borderRadius: 2,
    backgroundColor: colors.white,
    transform: [{ rotate: '-48deg' }],
  },
});
