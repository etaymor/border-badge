/**
 * Selected place display component.
 * Shows the currently selected place with name and address.
 */

import { memo, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import type { SelectedPlace } from '@services/placesApi';

interface SelectedPlaceDisplayProps {
  place: SelectedPlace;
}

/**
 * Extract a concise location from a formatted address.
 * Tries to get city/region info, avoiding coordinates and detailed street info.
 */
function getDisplayAddress(address: string | null): string | null {
  if (!address) return null;

  // If the address starts with coordinates (numbers), try to extract the rest
  const coordsMatch = address.match(/^[\d.,\s-]+\s*(.+)/);
  if (coordsMatch && coordsMatch[1]) {
    return coordsMatch[1].trim();
  }

  // For addresses with multiple parts separated by commas,
  // take the last 2-3 parts which usually contain city/region/country
  const parts = address.split(',').map((p) => p.trim());
  if (parts.length > 2) {
    // Get the last 2 meaningful parts (skip very short ones like postal codes)
    const meaningfulParts = parts.filter((p) => p.length > 3);
    if (meaningfulParts.length >= 2) {
      return meaningfulParts.slice(-2).join(', ');
    }
  }

  return address;
}

export const SelectedPlaceDisplay = memo(function SelectedPlaceDisplay({
  place,
}: SelectedPlaceDisplayProps) {
  const displayAddress = useMemo(() => getDisplayAddress(place.address), [place.address]);

  return (
    <View style={styles.container}>
      <Ionicons name="location" size={16} color={colors.adobeBrick} />
      <Text style={styles.name} numberOfLines={1}>
        {place.name}
      </Text>
      {displayAddress && (
        <Text style={styles.address} numberOfLines={1}>
          {displayAddress}
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
