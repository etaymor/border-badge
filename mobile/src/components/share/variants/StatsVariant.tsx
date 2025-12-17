import React, { memo, useMemo } from 'react';
import { Image, StyleSheet, View } from 'react-native';

import { Text } from '@components/ui';
import { colors, withAlpha } from '@constants/colors';
import { estimateTravelerPercentile } from '@constants/countryRarity';
import { fonts } from '@constants/typography';

import { getStampImage } from '../../../assets/stampImages';
import atlasLogo from '../../../../assets/atlasi-logo.png';
import { CARD_HEIGHT, CARD_WIDTH } from '../constants';
import type { VariantProps } from '../types';

/**
 * Card 2: Travel Stats - Continent breakdown with percentile ranking
 * Warm cream background with continent-by-continent stats.
 */
export const StatsVariant = memo(function StatsVariant({ context }: VariantProps) {
  const { totalCountries, regionCount, subregionCount, continentStats } = context;

  const travelerPercentile = useMemo(
    () => estimateTravelerPercentile(totalCountries),
    [totalCountries]
  );

  const worldPercentage = useMemo(() => {
    const totalWorldCountries = 227; // From countries.sql
    return Math.round((totalCountries / totalWorldCountries) * 100);
  }, [totalCountries]);

  return (
    <View style={[styles.container, { backgroundColor: colors.warmCream }]}>
      {/* Percentile Header */}
      <View style={styles.percentileHeader}>
        <View style={styles.percentileBadge}>
          <Text style={styles.percentileText}>TOP {travelerPercentile}% TRAVELER</Text>
        </View>
      </View>

      {/* Continent Breakdown - 2 column grid */}
      <View style={styles.continentGrid}>
        {continentStats.map((continent) => {
          const stampImage = continent.rarestCountryCode
            ? getStampImage(continent.rarestCountryCode)
            : null;

          return (
            <View key={continent.name} style={styles.continentGridItem}>
              {/* Stamp or placeholder */}
              <View style={styles.continentStampContainerLarge}>
                {stampImage ? (
                  <Image
                    source={stampImage}
                    style={styles.continentStampLarge}
                    resizeMode="contain"
                  />
                ) : (
                  <View style={styles.continentStampPlaceholderLarge} />
                )}
              </View>

              {/* Continent name and count */}
              <Text style={styles.continentNameGrid}>{continent.name}</Text>
              <View style={styles.continentCountRow}>
                <Text style={styles.continentCountVisited}>{continent.visitedCount}</Text>
                <Text style={styles.continentCountTotal}>/{continent.totalCount}</Text>
              </View>
            </View>
          );
        })}
      </View>

      {/* Stats Footer - 4 columns */}
      <View style={styles.statsFooterFour}>
        <View style={styles.statItemFour}>
          <Text style={styles.statNumberFour}>{totalCountries}</Text>
          <Text style={styles.statLabelFour}>COUNTRIES</Text>
        </View>
        <View style={styles.statDividerFour} />
        <View style={styles.statItemFour}>
          <Text style={styles.statNumberFour}>{regionCount}</Text>
          <Text style={styles.statLabelFour}>CONTINENTS</Text>
        </View>
        <View style={styles.statDividerFour} />
        <View style={styles.statItemFour}>
          <Text style={styles.statNumberFour}>{subregionCount}</Text>
          <Text style={styles.statLabelFour}>SUBREGIONS</Text>
        </View>
        <View style={styles.statDividerFour} />
        <View style={styles.statItemFour}>
          <Text style={styles.statNumberFour}>{worldPercentage}%</Text>
          <Text style={styles.statLabelFour}>WORLD</Text>
        </View>
      </View>

      {/* Logo and tagline */}
      <View style={styles.statsLogoRow}>
        <Image source={atlasLogo} style={styles.footerLogoNatural} resizeMode="contain" />
        <Text style={styles.statsTaglineOswald}>What&apos;s your country count?</Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    flexDirection: 'column',
    justifyContent: 'space-between',
    padding: 0,
  },
  percentileHeader: {
    alignItems: 'center',
    paddingTop: 50,
    paddingBottom: 20,
  },
  percentileBadge: {
    backgroundColor: colors.sunsetGold,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
  },
  percentileText: {
    fontFamily: fonts.oswald.bold,
    fontSize: 18,
    color: colors.midnightNavy,
    letterSpacing: 2,
  },
  continentGrid: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 20,
    justifyContent: 'center',
    alignItems: 'center',
    alignContent: 'center',
    gap: 12,
  },
  continentGridItem: {
    width: '45%',
    alignItems: 'center',
    paddingVertical: 12,
  },
  continentStampContainerLarge: {
    width: 90,
    height: 90,
    marginBottom: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  continentStampLarge: {
    width: 90,
    height: 90,
  },
  continentStampPlaceholderLarge: {
    width: 50,
    height: 50,
    borderRadius: 8,
    backgroundColor: withAlpha(colors.midnightNavy, 0.08),
  },
  continentNameGrid: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 16,
    color: colors.midnightNavy,
    textAlign: 'center',
    marginBottom: 2,
  },
  continentCountRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
  },
  continentCountVisited: {
    fontFamily: fonts.oswald.bold,
    fontSize: 32,
    color: colors.midnightNavy,
  },
  continentCountTotal: {
    fontFamily: fonts.oswald.medium,
    fontSize: 18,
    color: withAlpha(colors.midnightNavy, 0.5),
  },
  statsFooterFour: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    marginHorizontal: 16,
    borderTopWidth: 1,
    borderTopColor: withAlpha(colors.midnightNavy, 0.1),
  },
  statItemFour: {
    alignItems: 'center',
    flex: 1,
  },
  statNumberFour: {
    fontFamily: fonts.oswald.bold,
    fontSize: 24,
    color: colors.midnightNavy,
    lineHeight: 28,
  },
  statLabelFour: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 8,
    color: withAlpha(colors.midnightNavy, 0.5),
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  statDividerFour: {
    width: 1,
    height: 28,
    backgroundColor: withAlpha(colors.midnightNavy, 0.15),
  },
  statsLogoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 30,
    paddingTop: 12,
    gap: 8,
  },
  footerLogoNatural: {
    width: 100,
    height: 30,
  },
  statsTaglineOswald: {
    fontFamily: fonts.oswald.medium,
    fontSize: 14,
    color: colors.midnightNavy,
    letterSpacing: 0.5,
  },
});
