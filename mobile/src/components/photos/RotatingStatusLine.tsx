import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';

const CROSSFADE_MS = 400;
const HALF_CROSSFADE_MS = CROSSFADE_MS / 2;

export interface RotatingStatusLineProps {
  lines: readonly string[];
  firstHoldMs: number;
  holdMs: number;
  reduceMotion: boolean;
}

export function RotatingStatusLine({
  lines,
  firstHoldMs,
  holdMs,
  reduceMotion,
}: RotatingStatusLineProps) {
  const [index, setIndex] = useState(0);
  const usedFirstHold = useRef(false);
  const opacity = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  useEffect(() => {
    if (lines.length <= 1) return;

    const delay = usedFirstHold.current ? holdMs : firstHoldMs;

    const timer = setTimeout(() => {
      usedFirstHold.current = true;
      const nextIndex = (index + 1) % lines.length;

      if (reduceMotion) {
        opacity.value = 1;
        setIndex(nextIndex);
        return;
      }

      opacity.value = withTiming(0, { duration: HALF_CROSSFADE_MS }, (finished) => {
        if (!finished) return;
        runOnJS(setIndex)(nextIndex);
        opacity.value = withTiming(1, { duration: HALF_CROSSFADE_MS });
      });
    }, delay);

    return () => clearTimeout(timer);
  }, [firstHoldMs, holdMs, index, lines.length, opacity, reduceMotion]);

  if (lines.length === 0) {
    return null;
  }

  return (
    <Animated.View style={animatedStyle}>
      <Text style={styles.line} numberOfLines={1}>
        {lines[index]}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  line: {
    fontFamily: fonts.body.regular,
    fontSize: 15,
    lineHeight: 22,
    color: colors.stormGray,
  },
});
