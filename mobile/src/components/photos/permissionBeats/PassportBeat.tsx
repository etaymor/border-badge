import { useEffect, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { CountryRow, type CountryRowSlot } from '@components/photos/CountryRow';
import { SCAN_SLOT_FLY_IN_DURATION, SCAN_SLOT_FLY_IN_STAGGER } from '@components/photos/scanMotion';
import { colors } from '@constants/colors';

import {
  DEFAULT_PERMISSION_BEAT_ASSETS,
  PERMISSION_BEAT_DEMO_COUNTRIES,
  type PermissionBeatAssets,
} from './permissionBeatAssets';
import { PERMISSION_BEAT_LOOP_HOLD, PERMISSION_BEAT_RESET_DURATION } from './permissionMotion';

const AnimatedImage = Animated.createAnimatedComponent(Image);
const ROW_COUNT = 3;
const SLOTS_PER_ROW = 2;

interface PassportBeatProps {
  isActive: boolean;
  reduceMotion: boolean;
  homeCountry?: string | null;
  assets?: PermissionBeatAssets;
}

interface PassportTileProps {
  code: string;
  slotIndex: number;
  sequenceIndex: number;
  shouldAnimate: boolean;
  assets: PermissionBeatAssets;
}

function PassportTile({
  code,
  slotIndex,
  sequenceIndex,
  shouldAnimate,
  assets,
}: PassportTileProps) {
  const progress = useSharedValue(shouldAnimate ? 0 : 1);
  const source = assets.beat3?.[code]?.[slotIndex];

  useEffect(() => {
    progress.value = shouldAnimate
      ? withRepeat(
          withSequence(
            withDelay(
              sequenceIndex * SCAN_SLOT_FLY_IN_STAGGER,
              withTiming(1, {
                duration: SCAN_SLOT_FLY_IN_DURATION,
                easing: Easing.inOut(Easing.ease),
              })
            ),
            withDelay(
              PERMISSION_BEAT_LOOP_HOLD,
              withTiming(0, { duration: PERMISSION_BEAT_RESET_DURATION })
            )
          ),
          -1
        )
      : 1;
  }, [progress, sequenceIndex, shouldAnimate]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [
      { translateX: interpolate(progress.value, [0, 1], [-110 - slotIndex * 42, 0]) },
      { translateY: interpolate(progress.value, [0, 1], [-70, 0]) },
      { scale: interpolate(progress.value, [0, 1], [0.72, 1]) },
    ],
  }));

  return source ? (
    <AnimatedImage
      testID={`permission-beat3-image-${code}-${slotIndex}`}
      source={source}
      style={[styles.tile, animatedStyle]}
      contentFit="cover"
    />
  ) : (
    <Animated.View
      testID={`permission-beat-placeholder-beat3-${code}-${slotIndex}`}
      style={[styles.tile, styles.placeholder, placeholderTints[sequenceIndex % 4], animatedStyle]}
    />
  );
}

function createSlot(render: () => ReactNode): CountryRowSlot {
  return render;
}

export default function PassportBeat({
  isActive,
  reduceMotion,
  homeCountry,
  assets = DEFAULT_PERMISSION_BEAT_ASSETS,
}: PassportBeatProps) {
  const normalizedHomeCountry = homeCountry?.trim().toUpperCase();
  const countries = PERMISSION_BEAT_DEMO_COUNTRIES.filter(
    ({ code }) => code !== normalizedHomeCountry
  ).slice(0, ROW_COUNT);
  const shouldAnimate = isActive && !reduceMotion;

  return (
    <View testID="permission-beat-3" style={styles.rows} accessible={false}>
      {countries.map(({ code, name }, rowIndex) => {
        const slots = Array.from({ length: SLOTS_PER_ROW }, (_, slotIndex) =>
          createSlot(() => (
            <PassportTile
              code={code}
              slotIndex={slotIndex}
              sequenceIndex={rowIndex * SLOTS_PER_ROW + slotIndex}
              shouldAnimate={shouldAnimate}
              assets={assets}
            />
          ))
        );

        return (
          <CountryRow
            key={code}
            code={code}
            name={name}
            slots={slots}
            entering={false}
            reduceMotion={reduceMotion}
          />
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
  rows: {
    width: '100%',
    maxWidth: 350,
    gap: 5,
  },
  tile: {
    width: '100%',
    height: '100%',
    borderRadius: 10,
  },
  placeholder: {
    opacity: 0.78,
  },
});
