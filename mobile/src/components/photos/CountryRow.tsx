import { useEffect, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { getStampImage } from '../../assets/stampImages';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';

import {
  SCAN_ROW_ARRIVAL_DURATION,
  SCAN_SLOT_FLY_IN_SPRING_CONFIG,
  SCAN_SLOT_FLY_IN_STAGGER,
} from './scanMotion';

export const COUNTRY_ROW_SLOT_SIZE = 56;

export type CountryRowSlot = () => ReactNode;

export interface CountryRowProps {
  code: string;
  name: string;
  slots: readonly CountryRowSlot[];
  entering: boolean;
  reduceMotion: boolean;
}

export function CountryRow({ code, name, slots, entering, reduceMotion }: CountryRowProps) {
  const normalizedCode = code.toUpperCase();
  const stampImage = getStampImage(normalizedCode);
  const shouldAnimate = entering && !reduceMotion;
  const rowProgress = useSharedValue(shouldAnimate ? 0 : 1);
  const firstSlotProgress = useSharedValue(shouldAnimate ? 0 : 1);
  const secondSlotProgress = useSharedValue(shouldAnimate ? 0 : 1);

  useEffect(() => {
    if (!shouldAnimate) {
      rowProgress.value = 1;
      firstSlotProgress.value = 1;
      secondSlotProgress.value = 1;
      return;
    }

    rowProgress.value = 0;
    firstSlotProgress.value = 0;
    secondSlotProgress.value = 0;

    rowProgress.value = withTiming(1, { duration: SCAN_ROW_ARRIVAL_DURATION });
    if (slots.length > 0) {
      firstSlotProgress.value = withSpring(1, SCAN_SLOT_FLY_IN_SPRING_CONFIG);
    }
    if (slots.length > 1) {
      secondSlotProgress.value = withDelay(
        SCAN_SLOT_FLY_IN_STAGGER,
        withSpring(1, SCAN_SLOT_FLY_IN_SPRING_CONFIG)
      );
    }
  }, [firstSlotProgress, rowProgress, secondSlotProgress, shouldAnimate, slots.length]);

  const rowAnimatedStyle = useAnimatedStyle(() => ({
    opacity: rowProgress.value,
    transform: [{ translateY: interpolate(rowProgress.value, [0, 1], [12, 0]) }],
  }));
  const firstSlotAnimatedStyle = useAnimatedStyle(() => ({
    opacity: firstSlotProgress.value,
    transform: [
      { translateX: interpolate(firstSlotProgress.value, [0, 1], [-72, 0]) },
      { translateY: interpolate(firstSlotProgress.value, [0, 1], [-18, 0]) },
      { scale: interpolate(firstSlotProgress.value, [0, 1], [0.82, 1]) },
    ],
  }));
  const secondSlotAnimatedStyle = useAnimatedStyle(() => ({
    opacity: secondSlotProgress.value,
    transform: [
      { translateX: interpolate(secondSlotProgress.value, [0, 1], [-136, 0]) },
      { translateY: interpolate(secondSlotProgress.value, [0, 1], [-18, 0]) },
      { scale: interpolate(secondSlotProgress.value, [0, 1], [0.82, 1]) },
    ],
  }));

  const populatedSlots = slots.slice(0, 2);
  const staticRowStyle = reduceMotion ? styles.finalRowState : undefined;
  const staticSlotStyle = reduceMotion ? styles.finalSlotState : undefined;

  return (
    <Animated.View
      testID={`country-row-${normalizedCode}`}
      style={[styles.row, rowAnimatedStyle, staticRowStyle]}
    >
      <View style={styles.identity}>
        {stampImage ? (
          <Image
            testID={`country-row-stamp-${normalizedCode}`}
            source={stampImage}
            style={styles.stamp}
            contentFit="contain"
            recyclingKey={normalizedCode}
            cachePolicy="memory-disk"
            accessible={false}
          />
        ) : null}
        <Text style={styles.name} numberOfLines={2}>
          {name}
        </Text>
      </View>

      <View style={styles.slots}>
        {populatedSlots.map((renderSlot, index) => (
          <Animated.View
            key={index}
            testID={`country-row-slot-${index}`}
            style={[
              styles.slot,
              index === 0 ? firstSlotAnimatedStyle : secondSlotAnimatedStyle,
              staticSlotStyle,
            ]}
          >
            {renderSlot()}
          </Animated.View>
        ))}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  finalRowState: {
    opacity: 1,
    transform: [{ translateY: 0 }],
  },
  identity: {
    minWidth: 0,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  stamp: {
    width: 48,
    height: 48,
  },
  name: {
    flex: 1,
    fontFamily: fonts.body.semiBold,
    fontSize: 15,
    lineHeight: 20,
    color: colors.midnightNavy,
  },
  slots: {
    flexDirection: 'row',
    gap: 8,
  },
  slot: {
    width: COUNTRY_ROW_SLOT_SIZE,
    height: COUNTRY_ROW_SLOT_SIZE,
    overflow: 'hidden',
    borderRadius: 10,
  },
  finalSlotState: {
    opacity: 1,
    transform: [{ translateX: 0 }, { translateY: 0 }, { scale: 1 }],
  },
});
