import React from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { StampCard } from '@components/ui';
import { AnimatedCardWrapper } from './AnimatedCardWrapper';
import type { CountryDisplayItem } from '../../screens/passport/passportTypes';

interface StampRowProps {
  stamps: CountryDisplayItem[];
  animValues: Animated.Value[];
  onCountryPress: (item: CountryDisplayItem) => void;
}

export function StampRow({ stamps, animValues, onCountryPress }: StampRowProps) {
  return (
    <View style={styles.stampRow}>
      {stamps.map((item, index) => (
        <AnimatedCardWrapper
          key={item.code}
          animValue={animValues[index]}
          style={styles.stampCardWrapper}
        >
          <StampCard
            code={item.code}
            hasTrips={item.hasTrips}
            onPress={() => onCountryPress(item)}
          />
        </AnimatedCardWrapper>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  stampRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 12,
    marginBottom: 12,
  },
  stampCardWrapper: {
    flex: 1,
  },
});
