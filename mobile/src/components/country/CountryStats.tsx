import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';

interface CountryStatsProps {
  region: string;
  subregion: string;
  isVisited: boolean;
  countryNumber: number | null;
  reducedTopMargin?: boolean;
}

function CountryStatsComponent({
  region,
  subregion,
  isVisited,
  countryNumber,
  reducedTopMargin = false,
}: CountryStatsProps) {
  return (
    <View style={[styles.statsRow, reducedTopMargin && styles.statsRowReducedTopMargin]}>
      <View style={styles.statItem}>
        <Text style={styles.statLabel}>Continent</Text>
        <Text style={styles.statValue}>{region}</Text>
      </View>
      <View style={styles.statItem}>
        <Text style={styles.statLabel}>Subregion</Text>
        <Text style={styles.statValue}>{subregion}</Text>
      </View>
      {isVisited && countryNumber !== null && (
        <View style={styles.statItem}>
          <Text style={styles.statLabel}>Count</Text>
          <Text style={styles.statValue}>#{countryNumber}</Text>
        </View>
      )}
    </View>
  );
}

export default memo(CountryStatsComponent);

const styles = StyleSheet.create({
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: 16,
    marginBottom: 16,
    paddingHorizontal: 8,
  },
  statsRowReducedTopMargin: {
    marginTop: 0,
    paddingTop: 12,
  },
  statItem: {
    alignItems: 'center',
    flex: 1,
  },
  statLabel: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 11,
    color: colors.textSecondary,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 1,
    opacity: 0.7,
  },
  statValue: {
    fontFamily: fonts.oswald.medium,
    fontSize: 18,
    color: colors.midnightNavy,
    textAlign: 'center',
  },
});
