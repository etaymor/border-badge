import { useEffect, type ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import Animated, { interpolate, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { CountryRow, type CountryRowSlot } from '@components/photos/CountryRow';
import { colors } from '@constants/colors';

import {
  DEFAULT_PERMISSION_BEAT_ASSETS,
  PERMISSION_BEAT_DEMO_COUNTRIES,
  type PermissionBeatAssets,
} from './permissionBeatAssets';
import { PERMISSION_SHELF_STAGGER, permissionBeatVisibleMs } from './permissionMotion';
import { permissionPopLoop, usePermissionBeatFade } from './usePermissionBeatFade';

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

function shelfOrigin(rowIndex: number, slotIndex: number): { x: number; y: number } {
  return {
    x: -(32 + slotIndex * 56),
    y: (1 - rowIndex) * 64,
  };
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
  const rowIndex = Math.floor(sequenceIndex / SLOTS_PER_ROW);
  const { x: originX, y: originY } = shelfOrigin(rowIndex, slotIndex);

  useEffect(() => {
    progress.value = shouldAnimate
      ? permissionPopLoop(sequenceIndex, ROW_COUNT * SLOTS_PER_ROW, PERMISSION_SHELF_STAGGER)
      : 1;
  }, [progress, sequenceIndex, shouldAnimate]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [
      { translateX: interpolate(progress.value, [0, 1], [originX, 0]) },
      { translateY: interpolate(progress.value, [0, 1], [originY, 0]) },
      { scale: interpolate(progress.value, [0, 1], [0.6, 1]) },
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
  const fadeStyle = usePermissionBeatFade(
    shouldAnimate,
    permissionBeatVisibleMs(ROW_COUNT * SLOTS_PER_ROW, PERMISSION_SHELF_STAGGER)
  );

  return (
    <Animated.View testID="permission-beat-3" style={[styles.rows, fadeStyle]} accessible={false}>
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
  rows: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 16,
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
