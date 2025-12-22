import React from 'react';
import { Animated } from 'react-native';
import type { AnimatedCardWrapperProps } from '../../screens/passport/passportTypes';

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
                outputRange: [30, 0],
              }),
            },
            {
              scale: animValue.interpolate({
                inputRange: [0, 1],
                outputRange: [0.92, 1],
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
