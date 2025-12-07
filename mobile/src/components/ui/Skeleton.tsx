import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, ViewStyle } from 'react-native';

import { colors } from '@constants/colors';

interface SkeletonProps {
  width: number | `${number}%`;
  height: number;
  borderRadius?: number;
  style?: ViewStyle;
}

/**
 * A skeleton loading placeholder with a subtle pulse animation.
 * Used to indicate content is loading while maintaining layout structure.
 */
export function Skeleton({ width, height, borderRadius = 4, style }: SkeletonProps) {
  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.7,
          duration: 500,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.3,
          duration: 500,
          useNativeDriver: true,
        }),
      ])
    );

    animation.start();

    return () => {
      animation.stop();
    };
  }, [opacity]);

  return (
    <Animated.View
      style={[
        styles.skeleton,
        {
          width,
          height,
          borderRadius,
          opacity,
        },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  skeleton: {
    backgroundColor: colors.backgroundSecondary,
  },
});
