/**
 * Selected place display component.
 * Shows the currently selected place with name and address.
 */

import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import type { SelectedPlace } from '@services/placesApi';

interface SelectedPlaceDisplayProps {
  place: SelectedPlace;
}

export const SelectedPlaceDisplay = memo(function SelectedPlaceDisplay({
  place,
}: SelectedPlaceDisplayProps) {
  return (
    <View style={styles.container}>
      <Ionicons name="location" size={16} color={colors.adobeBrick} />
      <Text style={styles.name} numberOfLines={1}>
        {place.name}
      </Text>
      {place.address && (
        <Text style={styles.address} numberOfLines={1}>
          {place.address}
        </Text>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    paddingHorizontal: 4,
  },
  name: {
    fontSize: 14,
    fontFamily: fonts.openSans.semiBold,
    color: colors.midnightNavy,
    marginLeft: 6,
  },
  address: {
    fontSize: 13,
    fontFamily: fonts.openSans.regular,
    color: colors.textSecondary,
    marginLeft: 8,
    flex: 1,
  },
});
