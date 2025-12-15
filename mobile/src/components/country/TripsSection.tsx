import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';

interface TripsSectionHeaderProps {
  tripCount: number;
}

function TripsSectionHeaderComponent({ tripCount }: TripsSectionHeaderProps) {
  if (tripCount === 0) {
    return null;
  }

  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>Your Trips</Text>
      <View style={styles.badge}>
        <Text style={styles.badgeText}>{tripCount}</Text>
      </View>
    </View>
  );
}

export const TripsSectionHeader = memo(TripsSectionHeaderComponent);

const styles = StyleSheet.create({
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  sectionTitle: {
    fontFamily: fonts.playfair.bold,
    fontSize: 24,
    color: colors.midnightNavy,
  },
  badge: {
    backgroundColor: colors.midnightNavy,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  badgeText: {
    color: colors.white,
    fontFamily: fonts.oswald.medium,
    fontSize: 12,
  },
});
