import React from 'react';
import { Animated } from 'react-native';
import type { AnimatedCardWrapperProps } from '../../screens/passport/passportTypes';

/**
 * Animated wrapper for stamp/country cards.
 * Uses a lightweight slide/scale without swapping view types to avoid jitter.
 */
export function AnimatedCardWrapper({ children, animValue, style }: AnimatedCardWrapperProps) {
  return (
    <Animated.View
      style={[
        style,
        {
          opacity: animValue,
          transform: [
            {
              translateY: animValue.interpolate({
                inputRange: [0, 1],
                outputRange: [20, 0],
              }),
            },
            {
              scale: animValue.interpolate({
                inputRange: [0, 1],
                outputRange: [0.9, 1],
              }),
            },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}
