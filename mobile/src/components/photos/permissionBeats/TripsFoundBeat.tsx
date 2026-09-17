import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { colors } from '@constants/colors';

import { DEFAULT_PERMISSION_BEAT_ASSETS, type PermissionBeatAssets } from './permissionBeatAssets';
import {
  PERMISSION_BEAT_LOOP_HOLD,
  PERMISSION_BEAT_RESET_DURATION,
  PERMISSION_CHECK_STAGGER,
  PERMISSION_POP_SPRING_CONFIG,
} from './permissionMotion';

const TILE_COUNT = 12;
const TRAVEL_TILE_INDEXES = new Set([0, 1, 3, 4, 6, 7, 9, 10]);
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
      ? withRepeat(
          withSequence(
            withDelay(
              order * PERMISSION_CHECK_STAGGER,
              withSpring(1, PERMISSION_POP_SPRING_CONFIG)
            ),
            withDelay(
              PERMISSION_BEAT_LOOP_HOLD,
              withTiming(0, {
                duration: PERMISSION_BEAT_RESET_DURATION,
              })
            )
          ),
          -1
        )
      : 1;
  }, [order, progress, shouldAnimate]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: interpolate(progress.value, [0, 1], [0.35, 1]) }],
  }));

  return (
    <Animated.View testID={`permission-beat1-check-${order}`} style={[styles.badge, animatedStyle]}>
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
  let travelOrder = 0;

  return (
    <View testID="permission-beat-1" style={styles.grid} accessible={false}>
      {Array.from({ length: TILE_COUNT }, (_, index) => {
        const source = assets.beat1?.[index];
        const isTravelTile = TRAVEL_TILE_INDEXES.has(index);
        const order = isTravelTile ? travelOrder++ : -1;

        return (
          <View key={index} testID={`permission-beat1-tile-${index}`} style={styles.tile}>
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
    </View>
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
    width: 280,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tile: {
    width: 64,
    height: 82,
    borderRadius: 10,
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
