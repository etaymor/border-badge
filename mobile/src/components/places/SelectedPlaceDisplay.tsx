/**
 * Selected place display component.
 * Shows the currently selected place with name and address in a card style.
 */

import { memo, useMemo } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, Platform } from 'react-native';

import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import type { SelectedPlace } from '@services/placesApi';

interface SelectedPlaceDisplayProps {
  place: SelectedPlace;
  onChange: () => void;
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
  onChange,
}: SelectedPlaceDisplayProps) {
  const displayAddress = useMemo(() => getDisplayAddress(place.address), [place.address]);

  return (
    <View style={styles.container}>
      <View style={styles.contentContainer}>
        <Text style={styles.name} numberOfLines={1}>
          {place.name}
        </Text>
        {displayAddress && (
          <Text style={styles.address} numberOfLines={1}>
            {displayAddress}
          </Text>
        )}
      </View>

      <TouchableOpacity onPress={onChange} style={styles.changeButton} hitSlop={10}>
        <Text style={styles.changeButtonText}>Change</Text>
      </TouchableOpacity>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.paperBeige, // Card background
    borderRadius: 16,
    padding: 12,
    borderWidth: 0,
    ...Platform.select({
      ios: {
        shadowColor: colors.shadow,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 8,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  contentContainer: {
    flex: 1,
    marginRight: 8,
  },
  name: {
    fontSize: 16,
    fontFamily: fonts.openSans.semiBold,
    color: colors.midnightNavy,
    marginBottom: 2,
  },
  address: {
    fontSize: 13,
    fontFamily: fonts.openSans.regular,
    color: colors.textSecondary,
  },
  changeButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(23, 42, 58, 0.05)', // Subtle background
    borderRadius: 12,
  },
  changeButtonText: {
    fontSize: 12,
    fontFamily: fonts.openSans.semiBold,
    color: colors.midnightNavy,
    opacity: 0.7,
  },
});
