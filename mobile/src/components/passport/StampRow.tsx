import React, { useCallback } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { StampCard } from '@components/ui';
import { AnimatedCardWrapper } from './AnimatedCardWrapper';
import type { CountryDisplayItem } from '../../screens/passport/passportTypes';

interface StampRowProps {
  stamps: CountryDisplayItem[];
  animValues: Animated.Value[];
  onCountryPress: (item: CountryDisplayItem) => void;
}

interface StampItemProps {
  item: CountryDisplayItem;
  animValue: Animated.Value;
  onCountryPress: (item: CountryDisplayItem) => void;
}

const StampItem = React.memo<StampItemProps>(function StampItem({
  item,
  animValue,
  onCountryPress,
}) {
  const handlePress = useCallback(() => {
    onCountryPress(item);
  }, [onCountryPress, item]);

  return (
    <AnimatedCardWrapper animValue={animValue} style={styles.stampCardWrapper}>
      <StampCard code={item.code} hasTrips={item.hasTrips} onPress={handlePress} />
    </AnimatedCardWrapper>
  );
});

export const StampRow = React.memo<StampRowProps>(function StampRow({
  stamps,
  animValues,
  onCountryPress,
}) {
  const isSingle = stamps.length === 1;

  return (
    <View style={styles.stampRow}>
      {stamps.map((item, index) => (
        <StampItem
          key={item.code}
          item={item}
          animValue={animValues[index]}
          onCountryPress={onCountryPress}
          // @ts-expect-error narrow prop to child via style override
          styleOverride={isSingle ? styles.singleStampCard : undefined}
        />
      ))}
    </View>
  );
});

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
  singleStampCard: {
    flexBasis: '48%',
    maxWidth: '48%',
  },
});
