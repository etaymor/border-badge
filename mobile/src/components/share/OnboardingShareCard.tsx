/**
 * Share card component for onboarding completion.
 * Three variants: stamps, stats, and map - all optimized for 9:16 social sharing.
 */

import { memo, useMemo } from 'react';
import { Image, StyleSheet, View } from 'react-native';

import { Text } from '@components/ui';
import { colors, withAlpha } from '@constants/colors';
import { estimateTravelerPercentile } from '@constants/countryRarity';
import { fonts } from '@constants/typography';
import type { TravelTier } from '@utils/travelTier';

import { getStampImage } from '../../assets/stampImages';
import atlasLogo from '../../../assets/atlasi-logo.png';
import { WorldMapSvg } from './WorldMapSvg';

// Card dimensions: 9:16 aspect ratio optimized for Instagram Stories
const CARD_WIDTH = 375;
const CARD_HEIGHT = Math.round((CARD_WIDTH * 16) / 9); // 667

// Scale factor for consistent sizing
const SCALE = 1;

export type OnboardingShareVariant = 'stamps' | 'stats' | 'map';

export interface ContinentStats {
  name: string;
  visitedCount: number;
  totalCount: number;
  rarestCountryCode: string | null;
}

export interface OnboardingShareContext {
  visitedCountries: string[];
  totalCountries: number;
  regions: string[];
  regionCount: number;
  subregions: string[];
  subregionCount: number;
  travelTier: TravelTier;
  continentStats: ContinentStats[];
}

interface OnboardingShareCardProps {
  variant: OnboardingShareVariant;
  context: OnboardingShareContext;
}

/**
 * Card 1: Stamps Collection - "The Explorer's Journal"
 * Scattered passport stamps on a warm cream background with clean stats footer.
 */
const StampsVariant = memo(function StampsVariant({
  context,
}: {
  context: OnboardingShareContext;
}) {
  const { visitedCountries, totalCountries } = context;

  // Pre-calculated stamp positions for a natural scattered look
  // Each position is { x: %, y: %, rotation: deg, scale: factor }
  const stampPositions = useMemo(() => {
    const positions = [
      // Top area stamps
      { x: 8, y: 12, rotation: -8, scale: 1.0 },
      { x: 52, y: 8, rotation: 12, scale: 0.95 },
      // Upper middle
      { x: 28, y: 22, rotation: -4, scale: 1.05 },
      { x: 68, y: 20, rotation: 8, scale: 0.9 },
      // Middle area
      { x: 5, y: 34, rotation: 6, scale: 0.95 },
      { x: 42, y: 36, rotation: -10, scale: 1.0 },
      { x: 72, y: 38, rotation: 4, scale: 0.92 },
      // Lower middle
      { x: 18, y: 50, rotation: -6, scale: 1.02 },
      { x: 55, y: 52, rotation: 14, scale: 0.88 },
      // Bottom area
      { x: 8, y: 64, rotation: 10, scale: 0.95 },
      { x: 38, y: 68, rotation: -12, scale: 1.0 },
      { x: 65, y: 66, rotation: 5, scale: 0.9 },
    ];
    return positions;
  }, []);

  const displayStamps = useMemo(() => {
    return visitedCountries.slice(0, 12);
  }, [visitedCountries]);

  const worldPercentage = useMemo(() => {
    const totalWorldCountries = 227;
    return Math.round((totalCountries / totalWorldCountries) * 100);
  }, [totalCountries]);

  const STAMP_SIZE = 105;

  return (
    <View style={[styles.container, { backgroundColor: colors.warmCream }]}>
      {/* Scattered Stamps Area */}
      <View style={styles.scatteredStampsArea}>
        {displayStamps.map((code, index) => {
          const stampImage = getStampImage(code);
          if (!stampImage) return null;

          const pos = stampPositions[index];
          if (!pos) return null;

          return (
            <View
              key={code}
              style={[
                styles.scatteredStamp,
                {
                  left: `${pos.x}%`,
                  top: `${pos.y}%`,
                  transform: [{ rotate: `${pos.rotation}deg` }, { scale: pos.scale }],
                },
              ]}
            >
              <Image
                source={stampImage}
                style={{ width: STAMP_SIZE, height: STAMP_SIZE }}
                resizeMode="contain"
              />
            </View>
          );
        })}
      </View>

      {/* Footer with Stats and Logo */}
      <View style={styles.stampsFooterNew}>
        {/* Stats Row - 3 columns */}
        <View style={styles.statsRowNew}>
          <View style={styles.statItemNew}>
            <Text style={styles.statNumberNew}>{totalCountries}</Text>
            <Text style={styles.statLabelNew}>COUNTRIES</Text>
          </View>
          <View style={styles.statDividerNew} />
          <View style={styles.statItemNew}>
            <Text style={styles.statNumberNew}>{context.regionCount}</Text>
            <Text style={styles.statLabelNew}>CONTINENTS</Text>
          </View>
          <View style={styles.statDividerNew} />
          <View style={styles.statItemNew}>
            <Text style={styles.statNumberNew}>{worldPercentage}%</Text>
            <Text style={styles.statLabelNew}>WORLD</Text>
          </View>
        </View>

        {/* Logo and tagline */}
        <View style={styles.logoTaglineRow}>
          <Image source={atlasLogo} style={styles.footerLogoNatural} resizeMode="contain" />
          <Text style={styles.taglineTextOswald}>What&apos;s your country count?</Text>
        </View>
      </View>
    </View>
  );
});

/**
 * Card 2: Travel Stats - Continent breakdown with percentile ranking
 * Warm cream background with continent-by-continent stats.
 */
const StatsVariant = memo(function StatsVariant({ context }: { context: OnboardingShareContext }) {
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
              <Text style={styles.continentCountGrid}>
                {continent.visitedCount}/{continent.totalCount}
              </Text>
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

/**
 * Card 3: World Map - "Global Footprint"
 * Restored the map idea but with a much cleaner execution.
 * Minimalist geometric map with a stats overlay.
 */
const MapVariant = memo(function MapVariant({ context }: { context: OnboardingShareContext }) {
  const { totalCountries, regions, regionCount } = context;

  return (
    <View style={[styles.container, { backgroundColor: colors.midnightNavy }]}>
      {/* Header */}
      <View style={styles.mapHeader}>
        <Text style={styles.mapTitle}>FOOTPRINT</Text>
        <Text style={styles.mapSubtitle}>GLOBAL PROGRESS</Text>
      </View>

      {/* Map Area - Clean and Centered */}
      <View style={styles.mapWrapper}>
        <WorldMapSvg
          width={CARD_WIDTH * 0.9}
          highlightedRegions={regions}
          highlightColor={colors.sunsetGold}
          mutedColor={withAlpha(colors.white, 0.1)}
          strokeColor="transparent"
        />
      </View>

      {/* Simple Stats Overlay */}
      <View style={styles.mapStatsContainer}>
        <View style={styles.mapBigStatRow}>
          <View>
            <Text style={styles.mapBigStatNumber}>{totalCountries}</Text>
            <Text style={styles.mapBigStatLabel}>COUNTRIES VISITED</Text>
          </View>
        </View>

        <View style={styles.mapDividerSmall} />

        <Text style={styles.mapRegionText}>
          <Text style={{ color: colors.sunsetGold }}>{regionCount}</Text> / 6 REGIONS EXPLORED
        </Text>
      </View>

      {/* Footer */}
      <View style={styles.footerSimple}>
        <Image source={atlasLogo} style={styles.footerLogoLight} resizeMode="contain" />
      </View>
    </View>
  );
});

function OnboardingShareCardComponent({ variant, context }: OnboardingShareCardProps) {
  const VariantComponent = useMemo(() => {
    switch (variant) {
      case 'stamps':
        return StampsVariant;
      case 'stats':
        return StatsVariant;
      case 'map':
        return MapVariant;
    }
  }, [variant]);

  return (
    <View style={styles.card} collapsable={false}>
      <VariantComponent context={context} />
    </View>
  );
}

export const OnboardingShareCard = memo(OnboardingShareCardComponent);

// Export dimensions
export const ONBOARDING_SHARE_CARD_WIDTH = CARD_WIDTH;
export const ONBOARDING_SHARE_CARD_HEIGHT = CARD_HEIGHT;

const styles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    overflow: 'hidden',
    backgroundColor: colors.warmCream,
  },
  container: {
    flex: 1,
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    flexDirection: 'column',
    justifyContent: 'space-between',
    padding: 0,
  },

  // ============ SHARED ELEMENTS ============
  verticalDivider: {
    width: 1,
    height: 40,
    backgroundColor: withAlpha(colors.white, 0.15),
  },
  verticalDividerDark: {
    width: 1,
    height: 40,
    backgroundColor: withAlpha(colors.midnightNavy, 0.15),
  },
  footerLogoDark: {
    width: 80 * SCALE,
    height: 24 * SCALE,
    tintColor: colors.midnightNavy,
    opacity: 0.8,
  },
  footerLogoLight: {
    width: 80 * SCALE,
    height: 24 * SCALE,
    tintColor: colors.white,
    opacity: 0.8,
  },
  footerSimple: {
    alignItems: 'center',
    paddingBottom: 40,
  },

  // ============ STAMPS VARIANT ============
  scatteredStampsArea: {
    flex: 1,
    position: 'relative',
    marginBottom: 140, // Space for footer
  },
  scatteredStamp: {
    position: 'absolute',
  },
  stampsFooterNew: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.warmCream,
    paddingTop: 20,
    paddingBottom: 30,
    paddingHorizontal: 24,
    borderTopWidth: 1,
    borderTopColor: withAlpha(colors.midnightNavy, 0.08),
  },
  statsRowNew: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  statItemNew: {
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  statNumberNew: {
    fontFamily: fonts.oswald.bold,
    fontSize: 42,
    color: colors.midnightNavy,
    lineHeight: 48,
  },
  statLabelNew: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 11,
    color: withAlpha(colors.midnightNavy, 0.5),
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginTop: -2,
  },
  statDividerNew: {
    width: 1,
    height: 36,
    backgroundColor: withAlpha(colors.midnightNavy, 0.15),
  },
  footerLogoNatural: {
    width: 100,
    height: 30,
  },
  logoTaglineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  taglineTextOswald: {
    fontFamily: fonts.oswald.medium,
    fontSize: 14,
    color: withAlpha(colors.midnightNavy, 0.7),
    letterSpacing: 0.5,
  },

  // ============ STATS VARIANT ============
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
    paddingHorizontal: 16,
    justifyContent: 'center',
    alignItems: 'center',
    alignContent: 'center',
    gap: 8,
  },
  continentGridItem: {
    width: '30%',
    alignItems: 'center',
    paddingVertical: 8,
  },
  continentStampContainerLarge: {
    width: 48,
    height: 48,
    marginBottom: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  continentStampLarge: {
    width: 48,
    height: 48,
  },
  continentStampPlaceholderLarge: {
    width: 36,
    height: 36,
    borderRadius: 6,
    backgroundColor: withAlpha(colors.midnightNavy, 0.08),
  },
  continentNameGrid: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 11,
    color: colors.midnightNavy,
    textAlign: 'center',
  },
  continentCountGrid: {
    fontFamily: fonts.oswald.bold,
    fontSize: 16,
    color: colors.midnightNavy,
    textAlign: 'center',
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
  statsTaglineOswald: {
    fontFamily: fonts.oswald.medium,
    fontSize: 14,
    color: withAlpha(colors.midnightNavy, 0.7),
    letterSpacing: 0.5,
  },

  // ============ MAP VARIANT ============
  mapHeader: {
    alignItems: 'center',
    marginTop: 60,
    marginBottom: 20,
  },
  mapTitle: {
    fontFamily: fonts.oswald.bold,
    fontSize: 48,
    color: colors.white,
    letterSpacing: 6,
    lineHeight: 52,
    marginBottom: 4,
  },
  mapSubtitle: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 14,
    color: colors.sunsetGold,
    letterSpacing: 3,
    textTransform: 'uppercase',
  },
  mapWrapper: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: -40,
    width: '100%',
  },
  mapStatsContainer: {
    alignItems: 'center',
    marginBottom: 60,
  },
  mapBigStatRow: {
    marginBottom: 16,
  },
  mapBigStatNumber: {
    fontFamily: fonts.oswald.bold,
    fontSize: 64,
    color: colors.white,
    lineHeight: 72,
    textAlign: 'center',
  },
  mapBigStatLabel: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 12,
    color: withAlpha(colors.white, 0.6),
    letterSpacing: 2,
    textAlign: 'center',
    marginTop: -4,
  },
  mapDividerSmall: {
    width: 32,
    height: 2,
    backgroundColor: withAlpha(colors.white, 0.2),
    marginVertical: 12,
  },
  mapRegionText: {
    fontFamily: fonts.openSans.regular,
    fontSize: 14,
    color: withAlpha(colors.white, 0.8),
    letterSpacing: 1,
  },
});
