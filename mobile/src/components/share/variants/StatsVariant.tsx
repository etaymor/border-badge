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

  // Filter to only show continents with visits
  const visitedContinents = useMemo(
    () => continentStats.filter((c) => c.visitedCount > 0),
    [continentStats]
  );

  // Calculate scaling based on number of visited continents
  const { stampSize, fontSize, itemWidth } = useMemo(() => {
    const count = visitedContinents.length;
    if (count <= 2) {
      return { stampSize: 110, fontSize: 34, itemWidth: '45%' as const };
    } else if (count <= 4) {
      return { stampSize: 100, fontSize: 32, itemWidth: '45%' as const };
    } else {
      return { stampSize: 70, fontSize: 28, itemWidth: '45%' as const };
    }
  }, [visitedContinents.length]);

  const isOddCount = visitedContinents.length % 2 === 1;

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
        {visitedContinents.map((continent, index) => {
          const stampImage = continent.rarestCountryCode
            ? getStampImage(continent.rarestCountryCode)
            : null;
          const isLastOdd = isOddCount && index === visitedContinents.length - 1;

          return (
            <View
              key={continent.name}
              style={[styles.continentGridItem, { width: itemWidth }, isLastOdd && styles.centeredItem]}
            >
              {/* Stamp */}
              <View style={[styles.continentStampContainerLarge, { width: stampSize, height: stampSize }]}>
                {stampImage && (
                  <Image
                    source={stampImage}
                    style={{ width: stampSize, height: stampSize }}
                    resizeMode="contain"
                  />
                )}
              </View>

              {/* Continent name and count */}
              <Text style={styles.continentNameGrid}>{continent.name}</Text>
              <View style={styles.continentCountRow}>
                <Text style={[styles.continentCountVisited, { fontSize, lineHeight: fontSize + 4 }]}>
                  {continent.visitedCount}
                </Text>
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
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 20,
    justifyContent: 'center',
    alignItems: 'center',
    alignContent: 'center',
    gap: 4,
  },
  continentGridItem: {
    width: '45%',
    alignItems: 'center',
    paddingVertical: 2,
  },
  centeredItem: {
    width: '100%',
  },
  continentStampContainerLarge: {
    width: 70,
    height: 70,
    marginBottom: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  continentStampLarge: {
    width: 70,
    height: 70,
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
    fontSize: 28,
    lineHeight: 32,
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
    paddingTop: 8,
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
