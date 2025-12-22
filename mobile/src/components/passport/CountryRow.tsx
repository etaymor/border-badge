import React from 'react';
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

export function CountryRow({
  countries,
  animValues,
  onCountryPress,
  onAddVisited,
  onToggleWishlist,
}: CountryRowProps) {
  return (
    <View style={styles.unvisitedRow}>
      {countries.map((country, index) => (
        <AnimatedCardWrapper
          key={country.code}
          animValue={animValues[index]}
          style={styles.countryCardWrapper}
        >
          <CountryCard
            code={country.code}
            name={country.name}
            isVisited={false}
            isWishlisted={country.isWishlisted}
            hasTrips={country.hasTrips}
            onPress={() => onCountryPress(country)}
            onAddVisited={() => onAddVisited(country.code)}
            onToggleWishlist={() => onToggleWishlist(country.code)}
          />
        </AnimatedCardWrapper>
      ))}
    </View>
  );
}

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
