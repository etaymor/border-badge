import { StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import Animated, { interpolate, useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { useStageInsets } from '@components/photos/StageHero';
import { colors, withAlpha } from '@constants/colors';
import { SCAN_COPY } from '@constants/scanCopy';
import { fonts } from '@constants/typography';

import { DEFAULT_PERMISSION_BEAT_ASSETS, type PermissionBeatAssets } from './permissionBeatAssets';
import { PERMISSION_PILL_STAGGER } from './permissionMotion';
import {
  permissionFadeAt,
  permissionPopAt,
  usePermissionBeatClock,
  type PermissionBeatTiming,
} from './usePermissionBeatFade';

const PILL_EDGE = 16;
const PILL_TIMING: PermissionBeatTiming = {
  count: SCAN_COPY.permission.carousel.beat2Pills.length,
  stagger: PERMISSION_PILL_STAGGER,
};

interface OnDeviceBeatProps {
  isActive: boolean;
  reduceMotion: boolean;
  assets?: PermissionBeatAssets;
}

interface LocationPillProps {
  label: string;
  index: number;
  shouldAnimate: boolean;
  clock: SharedValue<number>;
  position: ViewStyle;
}

function LocationPill({ label, index, shouldAnimate, clock, position }: LocationPillProps) {
  const animatedStyle = useAnimatedStyle(() => {
    const pop = permissionPopAt(clock.value, index, PILL_TIMING.stagger);
    return {
      opacity: Math.min(1, pop) * permissionFadeAt(clock.value, PILL_TIMING),
      transform: [
        { translateY: interpolate(pop, [0, 1], [8, 0]) },
        { scale: interpolate(pop, [0, 1], [0.8, 1]) },
      ],
    };
  });
  const staticPillStyle = !shouldAnimate ? styles.finalPillState : undefined;

  return (
    <Animated.View
      testID={`permission-beat2-pill-${index}`}
      style={[styles.pill, position, animatedStyle, staticPillStyle]}
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
  const insets = useStageInsets();
  // Pills sit inside the visible band: below the header, above the sheet.
  const pillPositions: ViewStyle[] = [
    { top: insets.top + PILL_EDGE, right: PILL_EDGE },
    { top: '50%', left: PILL_EDGE },
    { bottom: insets.bottom + PILL_EDGE, right: PILL_EDGE },
  ];
  const clock = usePermissionBeatClock(shouldAnimate, PILL_TIMING);

  return (
    // The photo holds still for the whole loop; only the pills pop and fade.
    <View testID="permission-beat-2" style={styles.frame} accessible={false}>
      {assets.beat2 ? (
        <Image
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
        <LocationPill
          key={label}
          label={label}
          index={index}
          shouldAnimate={shouldAnimate}
          clock={clock}
          position={pillPositions[index]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    ...StyleSheet.absoluteFillObject,
  },
  image: {
    ...StyleSheet.absoluteFillObject,
  },
  placeholder: {
    backgroundColor: withAlpha(colors.cloudWhite, 0.06),
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
