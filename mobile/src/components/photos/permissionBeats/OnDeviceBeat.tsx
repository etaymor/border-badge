import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import Animated, { interpolate, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { colors } from '@constants/colors';
import { SCAN_COPY } from '@constants/scanCopy';
import { fonts } from '@constants/typography';

import { DEFAULT_PERMISSION_BEAT_ASSETS, type PermissionBeatAssets } from './permissionBeatAssets';
import { PERMISSION_PILL_STAGGER, permissionBeatVisibleMs } from './permissionMotion';
import { permissionPopLoop, usePermissionBeatFade } from './usePermissionBeatFade';

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
  const pillCount = SCAN_COPY.permission.carousel.beat2Pills.length;

  useEffect(() => {
    progress.value = shouldAnimate
      ? permissionPopLoop(index, pillCount, PERMISSION_PILL_STAGGER)
      : 1;
  }, [index, pillCount, progress, shouldAnimate]);

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
      <View style={styles.leader} testID={`permission-beat2-dot-${index}`} />
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
  const fadeStyle = usePermissionBeatFade(
    shouldAnimate,
    permissionBeatVisibleMs(
      SCAN_COPY.permission.carousel.beat2Pills.length,
      PERMISSION_PILL_STAGGER
    )
  );

  return (
    <Animated.View testID="permission-beat-2" style={[styles.frame, fadeStyle]} accessible={false}>
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
    </Animated.View>
  );
}

const pillPositions = [
  { top: 24, right: 16 },
  { top: '46%' as const, left: 16 },
  { bottom: 24, right: 16 },
];

const styles = StyleSheet.create({
  frame: {
    flex: 1,
    width: '100%',
  },
  image: {
    ...StyleSheet.absoluteFillObject,
  },
  placeholder: {
    backgroundColor: colors.lakeBlue,
  },
  pill: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: colors.cloudWhite,
    shadowColor: colors.shadow,
    shadowOpacity: 0.16,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 3 },
  },
  leader: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.sunsetGold,
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
