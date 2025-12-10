import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

import { colors } from '@constants/colors';

export interface AnimatedProgressBarProps {
  percentage: number;
  delay?: number;
  duration?: number;
  height?: number;
}

export function AnimatedProgressBar({
  percentage,
  delay = 0,
  duration = 800,
  height = 12,
}: AnimatedProgressBarProps) {
  const widthAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let animation: Animated.CompositeAnimation | null = null;

    const timeout = setTimeout(() => {
      animation = Animated.timing(widthAnim, {
        toValue: percentage,
        duration,
        useNativeDriver: false, // width animation requires non-native driver
      });
      animation.start();
    }, delay);

    return () => {
      clearTimeout(timeout);
      // Stop animation on cleanup to prevent memory leaks
      if (animation) {
        animation.stop();
      }
    };
  }, [percentage, delay, duration, widthAnim]);

  const animatedWidth = widthAnim.interpolate({
    inputRange: [0, 100],
    outputRange: ['0%', '100%'],
    extrapolate: 'clamp',
  });

  return (
    <View style={[styles.track, { height }]}>
      <Animated.View
        style={[
          styles.fill,
          {
            width: animatedWidth,
            height,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    backgroundColor: colors.paperBeige,
    borderRadius: 6,
    overflow: 'hidden',
    width: '100%',
  },
  fill: {
    backgroundColor: colors.sunsetGold,
    borderRadius: 6,
    minWidth: 12,
  },
});
