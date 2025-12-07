import React, { useMemo } from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View, ViewStyle } from 'react-native';

import { colors } from '@constants/colors';
import { getFlagEmoji } from '@utils/flags';
import { getStampImage } from '../../assets/stampImages';

export interface VisitedCountryCardProps {
  /** ISO 3166-1 alpha-2 country code (e.g., "US", "FR") */
  code: string;
  /** Country display name */
  name: string;
  /** Country region for display context */
  region: string;
  /** Handler when card is pressed - navigates to CountryDetail */
  onPress: () => void;
  /** Optional custom container style */
  style?: ViewStyle;
  /** Test ID for testing purposes */
  testID?: string;
}

export const VisitedCountryCard = React.memo(function VisitedCountryCard({
  code,
  name,
  region,
  onPress,
  style,
  testID,
}: VisitedCountryCardProps) {
  const flagEmoji = useMemo(() => getFlagEmoji(code), [code]);
  const stampImage = useMemo(() => getStampImage(code), [code]);

  return (
    <TouchableOpacity
      style={[styles.container, style]}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`${name}, tap to view details`}
      testID={testID || `visited-country-card-${code}`}
    >
      <View style={styles.stampContainer}>
        {stampImage ? (
          <Image source={stampImage} style={styles.stampImage} resizeMode="cover" />
        ) : (
          <Text style={styles.flagEmoji}>{flagEmoji}</Text>
        )}
      </View>
      <View style={styles.countryInfo}>
        <Text style={styles.countryName} numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.countryRegion}>{region}</Text>
      </View>
      <Text style={styles.chevron}>{'>'}</Text>
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: colors.backgroundCard,
    marginHorizontal: 16,
    borderRadius: 8,
  },
  stampContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.backgroundTertiary,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    overflow: 'hidden',
  },
  stampImage: {
    width: 48,
    height: 48,
  },
  flagEmoji: {
    fontSize: 24,
  },
  countryInfo: {
    flex: 1,
  },
  countryName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  countryRegion: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 2,
  },
  chevron: {
    fontSize: 18,
    color: colors.separator,
    fontWeight: '600',
  },
});
