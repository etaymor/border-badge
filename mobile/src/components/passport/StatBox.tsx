import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';

interface StatBoxProps {
  value: string | number;
  label: string;
  backgroundColor: string;
  textColor?: string;
  labelColor?: string;
  index: number;
  show: boolean;
}

export function StatBox({
  value,
  label,
  backgroundColor,
  textColor = colors.midnightNavy,
  labelColor,
  index,
  show,
}: StatBoxProps) {
  const scaleAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (show) {
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 6,
        tension: 50,
        delay: index * 100,
        useNativeDriver: true,
      }).start();
    }
  }, [show, index, scaleAnim]);

  return (
    <Animated.View
      style={[
        styles.statBox,
        {
          backgroundColor,
          transform: [{ scale: scaleAnim }],
          opacity: scaleAnim,
        },
      ]}
    >
      <Text style={[styles.statValue, { color: textColor }]}>{value}</Text>
      <Text
        style={[
          styles.statLabel,
          labelColor ? { color: labelColor } : { color: textColor, opacity: 0.7 },
        ]}
      >
        {label}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  statBox: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  statValue: {
    fontFamily: fonts.openSans.bold,
    fontSize: 22,
    marginBottom: 4,
  },
  statLabel: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 10,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
});
