import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
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
import { SCAN_COPY } from '@constants/scanCopy';
import { fonts } from '@constants/typography';

import { DEFAULT_PERMISSION_BEAT_ASSETS, type PermissionBeatAssets } from './permissionBeatAssets';
import {
  PERMISSION_BEAT_LOOP_HOLD,
  PERMISSION_BEAT_RESET_DURATION,
  PERMISSION_PILL_STAGGER,
  PERMISSION_POP_SPRING_CONFIG,
} from './permissionMotion';

const AnimatedImage = Animated.createAnimatedComponent(Image);

interface OnDeviceBeatProps {
  isActive: boolean;
  reduceMotion: boolean;
  assets?: PermissionBeatAssets;
}

interface LocationPillProps {
  label: string;
  index: number;
  shouldAnimate: boolean;
}

function LocationPill({ label, index, shouldAnimate }: LocationPillProps) {
  const progress = useSharedValue(shouldAnimate ? 0 : 1);

  useEffect(() => {
    progress.value = shouldAnimate
      ? withRepeat(
          withSequence(
            withDelay(index * PERMISSION_PILL_STAGGER, withSpring(1, PERMISSION_POP_SPRING_CONFIG)),
            withDelay(
              PERMISSION_BEAT_LOOP_HOLD,
              withTiming(0, { duration: PERMISSION_BEAT_RESET_DURATION })
            )
          ),
          -1
        )
      : 1;
  }, [index, progress, shouldAnimate]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [
      { translateY: interpolate(progress.value, [0, 1], [8, 0]) },
      { scale: interpolate(progress.value, [0, 1], [0.8, 1]) },
    ],
  }));
  const staticPillStyle = !shouldAnimate ? styles.finalPillState : undefined;

  return (
    <Animated.View
      testID={`permission-beat2-pill-${index}`}
      style={[styles.pill, pillPositions[index], animatedStyle, staticPillStyle]}
    >
      <Text style={styles.pillText}>{label}</Text>
    </Animated.View>
  );
}

export default function OnDeviceBeat({
  isActive,
  reduceMotion,
  assets = DEFAULT_PERMISSION_BEAT_ASSETS,
}: OnDeviceBeatProps) {
  const shouldAnimate = isActive && !reduceMotion;

  return (
    <View testID="permission-beat-2" style={styles.frame} accessible={false}>
      {assets.beat2 ? (
        <AnimatedImage
          testID="permission-beat2-image"
          source={assets.beat2}
          style={styles.image}
          contentFit="cover"
        />
      ) : (
        <View
          testID="permission-beat-placeholder-beat2-0"
          style={[styles.image, styles.placeholder]}
        />
      )}
      {SCAN_COPY.permission.carousel.beat2Pills.map((label, index) => (
        <LocationPill key={label} label={label} index={index} shouldAnimate={shouldAnimate} />
      ))}
    </View>
  );
}

const pillPositions = [
  { top: 30, right: -30 },
  { top: 104, left: -34 },
  { bottom: 34, right: -44 },
];

const styles = StyleSheet.create({
  frame: {
    width: 190,
    height: 254,
  },
  image: {
    width: '100%',
    height: '100%',
    borderRadius: 18,
  },
  placeholder: {
    backgroundColor: colors.lakeBlue,
  },
  pill: {
    position: 'absolute',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: colors.cloudWhite,
    shadowColor: colors.shadow,
    shadowOpacity: 0.16,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 3 },
  },
  finalPillState: {
    opacity: 1,
    transform: [{ translateY: 0 }, { scale: 1 }],
  },
  pillText: {
    color: colors.midnightNavy,
    fontFamily: fonts.body.semiBold,
    fontSize: 12,
    lineHeight: 16,
  },
});
