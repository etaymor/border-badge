import React, { useCallback } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { CountryCard } from '@components/ui';
import { AnimatedCardWrapper } from './AnimatedCardWrapper';
import type { UnvisitedCountry } from '../../screens/passport/passportTypes';

interface CountryRowProps {
  countries: UnvisitedCountry[];
  animValues: Animated.Value[];
  onCountryPress: (country: UnvisitedCountry) => void;
  onAddVisited: (countryCode: string) => void;
  onToggleWishlist: (countryCode: string) => void;
}

interface CountryItemProps {
  country: UnvisitedCountry;
  animValue: Animated.Value;
  onCountryPress: (country: UnvisitedCountry) => void;
  onAddVisited: (countryCode: string) => void;
  onToggleWishlist: (countryCode: string) => void;
}

const CountryItem = React.memo<CountryItemProps>(function CountryItem({
  country,
  animValue,
  onCountryPress,
  onAddVisited,
  onToggleWishlist,
}) {
  const handlePress = useCallback(() => {
    onCountryPress(country);
  }, [onCountryPress, country]);

  const handleAddVisited = useCallback(() => {
    onAddVisited(country.code);
  }, [onAddVisited, country.code]);

  const handleToggleWishlist = useCallback(() => {
    onToggleWishlist(country.code);
  }, [onToggleWishlist, country.code]);

  return (
    <AnimatedCardWrapper animValue={animValue} style={styles.countryCardWrapper}>
      <CountryCard
        code={country.code}
        name={country.name}
        isVisited={false}
        isWishlisted={country.isWishlisted}
        hasTrips={country.hasTrips}
        onPress={handlePress}
        onAddVisited={handleAddVisited}
        onToggleWishlist={handleToggleWishlist}
      />
    </AnimatedCardWrapper>
  );
});

export const CountryRow = React.memo<CountryRowProps>(function CountryRow({
  countries,
  animValues,
  onCountryPress,
  onAddVisited,
  onToggleWishlist,
}) {
  return (
    <View style={styles.unvisitedRow}>
      {countries.map((country, index) => (
        <CountryItem
          key={country.code}
          country={country}
          animValue={animValues[index]}
          onCountryPress={onCountryPress}
          onAddVisited={onAddVisited}
          onToggleWishlist={onToggleWishlist}
        />
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  unvisitedRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 12,
    marginBottom: 12,
  },
  countryCardWrapper: {
    flex: 1,
  },
});
