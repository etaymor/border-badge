/**
 * Share card component for onboarding completion.
 * Three variants: stamps, stats, and map - all optimized for 9:16 social sharing.
 */

import { Ionicons } from '@expo/vector-icons';
import { memo, useMemo } from 'react';
import { Image, StyleSheet, View } from 'react-native';

import { Text } from '@components/ui';
import { colors, withAlpha } from '@constants/colors';
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

export interface OnboardingShareContext {
  visitedCountries: string[];
  totalCountries: number;
  regions: string[];
  regionCount: number;
  subregions: string[];
  subregionCount: number;
  travelTier: TravelTier;
}

interface OnboardingShareCardProps {
  variant: OnboardingShareVariant;
  context: OnboardingShareContext;
}

// Seeded random for consistent stamp rotations
function seededRandom(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

/**
 * Card 1: Stamps Collection - "The Explorer's Journal"
 * Clean, minimalistic passport page. No heavy frames, no heavy overlays.
 */
const StampsVariant = memo(function StampsVariant({
  context,
}: {
  context: OnboardingShareContext;
}) {
  const { visitedCountries, totalCountries } = context;

  // Grid layout calculation
  const cols = 3;
  const stampSize = (CARD_WIDTH - 60 * SCALE) / cols; // Padding 30 horizontal total

  // Show up to 12 stamps
  const displayStamps = visitedCountries.slice(0, 12);

  return (
    <View style={[styles.container, { backgroundColor: '#FDFBF7' }]}>
      {/* Texture Overlay */}
      <View style={styles.paperTexture} />

      {/* Header */}
      <View style={styles.stampsHeader}>
        <Text style={styles.passportTitle}>PASSPORT</Text>
        <Text style={styles.passportSubtitle}>MY TRAVEL CHRONICLES</Text>
        <View style={styles.passportDivider} />
      </View>

      {/* Main Content - Stamps Grid */}
      <View style={styles.stampsGridWrapper}>
        <View style={styles.stampsGrid}>
          {displayStamps.map((code, index) => {
            const stampImage = getStampImage(code);
            if (!stampImage) return null;

            // Very subtle rotation (-5 to 5 deg) for realism but keeping it clean
            const rotation = (seededRandom(index * 17) - 0.5) * 10;

            return (
              <View
                key={code}
                style={[
                  styles.stampCell,
                  {
                    width: stampSize,
                    height: stampSize,
                  },
                ]}
              >
                <View
                  style={[
                    styles.stampInner,
                    {
                      transform: [{ rotate: `${rotation}deg` }],
                    },
                  ]}
                >
                  <Image source={stampImage} style={styles.stampImage} resizeMode="contain" />
                </View>
              </View>
            );
          })}
        </View>
      </View>

      {/* Footer / Stats */}
      <View style={styles.stampsFooter}>
        <View style={styles.statsRowSimple}>
          <View style={styles.statItemSimple}>
            <Text style={styles.statNumberDark}>{totalCountries}</Text>
            <Text style={styles.statLabelDark}>COUNTRIES</Text>
          </View>
          <View style={styles.verticalDividerDark} />
          <View style={styles.statItemSimple}>
            <Text style={styles.statNumberDark}>{context.regionCount}</Text>
            <Text style={styles.statLabelDark}>REGIONS</Text>
          </View>
        </View>

        <Image source={atlasLogo} style={styles.footerLogoDark} resizeMode="contain" />
      </View>
    </View>
  );
});

/**
 * Card 2: Travel Stats - "Elite Traveller"
 * Clean dark mode. No glows. High contrast.
 */
const StatsVariant = memo(function StatsVariant({ context }: { context: OnboardingShareContext }) {
  const { totalCountries, regionCount, subregionCount, travelTier } = context;

  return (
    <View style={[styles.container, { backgroundColor: colors.midnightNavy }]}>
      {/* Header */}
      <View style={styles.statsHeader}>
        <Text style={styles.statsTopLabel}>THE JOURNEY SO FAR</Text>
        <View style={styles.statsDivider} />
      </View>

      {/* Main Rank Display - Centerpiece */}
      <View style={styles.rankContainer}>
        <View style={styles.rankIconWrapper}>
          <Ionicons
            name={travelTier.icon as keyof typeof Ionicons.glyphMap}
            size={80 * SCALE}
            color={colors.sunsetGold}
          />
        </View>

        <Text style={styles.rankLabel}>CURRENT RANK</Text>
        <Text style={styles.rankName} numberOfLines={1} adjustsFontSizeToFit>
          {travelTier.status}
        </Text>
      </View>

      {/* Stats Grid - Clean and tabular */}
      <View style={styles.statsGridContainer}>
        <View style={styles.statBox}>
          <Text style={styles.statBoxNumber}>{totalCountries}</Text>
          <Text style={styles.statBoxLabel}>COUNTRIES</Text>
        </View>
        <View style={styles.verticalDivider} />
        <View style={styles.statBox}>
          <Text style={styles.statBoxNumber}>{regionCount}</Text>
          <Text style={styles.statBoxLabel}>REGIONS</Text>
        </View>
        <View style={styles.verticalDivider} />
        <View style={styles.statBox}>
          <Text style={styles.statBoxNumber}>{subregionCount}</Text>
          <Text style={styles.statBoxLabel}>SUBREGIONS</Text>
        </View>
      </View>

      {/* Footer */}
      <View style={styles.footerSimple}>
        <Image source={atlasLogo} style={styles.footerLogoLight} resizeMode="contain" />
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
  paperTexture: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#FDFBF7', // Base paper color
  },
  stampsHeader: {
    alignItems: 'center',
    marginTop: 60,
    paddingHorizontal: 30,
    zIndex: 10,
  },
  passportTitle: {
    fontFamily: fonts.oswald.bold,
    fontSize: 48,
    color: colors.midnightNavy,
    letterSpacing: 4,
    marginBottom: 0,
    lineHeight: 56,
  },
  passportSubtitle: {
    fontFamily: fonts.dawning.regular,
    fontSize: 28,
    color: colors.adobeBrick,
    transform: [{ rotate: '-2deg' }],
    marginTop: -4,
  },
  passportDivider: {
    width: 60,
    height: 3,
    backgroundColor: withAlpha(colors.midnightNavy, 0.1),
    marginTop: 16,
  },
  stampsGridWrapper: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stampsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignContent: 'center',
    paddingHorizontal: 30,
    gap: 8,
  },
  stampCell: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: 0,
  },
  stampInner: {
    width: '85%',
    height: '85%',
    shadowColor: colors.midnightNavy,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  stampImage: {
    width: '100%',
    height: '100%',
    opacity: 0.9,
  },
  stampsFooter: {
    paddingBottom: 50,
    alignItems: 'center',
    paddingHorizontal: 30,
  },
  statsRowSimple: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 32,
    marginBottom: 24,
  },
  statItemSimple: {
    alignItems: 'center',
  },
  statNumberDark: {
    fontFamily: fonts.oswald.bold,
    fontSize: 36,
    color: colors.midnightNavy,
    marginBottom: -4,
  },
  statLabelDark: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 10,
    color: withAlpha(colors.midnightNavy, 0.5),
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },

  // ============ STATS VARIANT ============
  statsHeader: {
    alignItems: 'center',
    marginTop: 60,
    zIndex: 10,
  },
  statsTopLabel: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 12,
    color: colors.sunsetGold,
    letterSpacing: 3,
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  statsDivider: {
    width: 40,
    height: 2,
    backgroundColor: withAlpha(colors.white, 0.1),
  },
  rankContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
  },
  rankIconWrapper: {
    marginBottom: 24,
    // Add a very subtle shadow only
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  rankLabel: {
    fontFamily: fonts.openSans.bold,
    fontSize: 12,
    color: withAlpha(colors.white, 0.5),
    letterSpacing: 2,
    marginBottom: 8,
  },
  rankName: {
    fontFamily: fonts.oswald.bold,
    fontSize: 56,
    color: colors.white,
    textTransform: 'uppercase',
    letterSpacing: 3,
    textAlign: 'center',
  },
  statsGridContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginHorizontal: 30,
    marginBottom: 60,
    paddingVertical: 24,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: withAlpha(colors.white, 0.1),
  },
  statBox: {
    alignItems: 'center',
    flex: 1,
  },
  statBoxNumber: {
    fontFamily: fonts.oswald.medium,
    fontSize: 32,
    color: colors.white,
    marginBottom: 4,
  },
  statBoxLabel: {
    fontFamily: fonts.openSans.regular,
    fontSize: 10,
    color: withAlpha(colors.white, 0.6),
    letterSpacing: 1,
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
