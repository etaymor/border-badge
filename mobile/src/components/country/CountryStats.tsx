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
      <View style={styles.statDivider} />
      <View style={styles.statItem}>
        <Text style={styles.statLabel}>Subregion</Text>
        <Text style={styles.statValue}>{subregion}</Text>
      </View>
      {isVisited && countryNumber !== null && (
        <>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Count</Text>
            <Text style={styles.statValue}>#{countryNumber}</Text>
          </View>
        </>
      )}
    </View>
  );
}

export default memo(CountryStatsComponent);

const styles = StyleSheet.create({
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 12,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.midnightNavyBorder,
    marginBottom: 16,
  },
  statsRowReducedTopMargin: {
    marginTop: -4,
  },
  statItem: {
    alignItems: 'center',
    paddingHorizontal: 12,
    flex: 1,
  },
  statDivider: {
    width: 1,
    height: 24,
    backgroundColor: colors.midnightNavyBorder,
  },
  statLabel: {
    fontFamily: fonts.openSans.regular,
    fontSize: 12,
    color: colors.stormGray,
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  statValue: {
    fontFamily: fonts.oswald.medium,
    fontSize: 16,
    color: colors.midnightNavy,
    textAlign: 'center',
  },
});
