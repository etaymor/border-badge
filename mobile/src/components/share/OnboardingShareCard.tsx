/**
 * Share card component for onboarding completion.
 * Three variants: stamps, stats, and map - all optimized for 9:16 social sharing.
 */

import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
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
// Render at base mobile size, ViewShot will upscale to 1080x1920 for export
const CARD_WIDTH = 375;
const CARD_HEIGHT = Math.round((CARD_WIDTH * 16) / 9); // 667

// Scale factor is now 1 since we're rendering at base size
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
 * Card 1: Stamps Collection
 * Grid of passport stamps with country count badge
 */
const StampsVariant = memo(function StampsVariant({
  context,
}: {
  context: OnboardingShareContext;
}) {
  const { visitedCountries, totalCountries } = context;

  // Calculate grid layout
  const count = visitedCountries.length;
  // Increase density for a fuller look
  const cols = count <= 6 ? 2 : count <= 12 ? 3 : 4;
  const stampSize = Math.min((CARD_WIDTH - 80 * SCALE) / cols - 12 * SCALE, 200 * SCALE);
  const gap = 8 * SCALE;

  // Calculate positions with more organic scatter
  const positions = visitedCountries.map((_, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    // More random rotation and slight offset for "messy" passport look
    const rotation = (seededRandom(index * 17) - 0.5) * 25;
    const offsetX = (seededRandom(index * 13) - 0.5) * 20 * SCALE;
    const offsetY = (seededRandom(index * 11) - 0.5) * 20 * SCALE;

    return {
      x: 50 * SCALE + col * (stampSize + gap) + offsetX,
      y: 300 * SCALE + row * (stampSize + gap) + offsetY,
      rotation,
    };
  });

  return (
    <LinearGradient
      colors={[colors.warmCream, '#F5E6D3', '#E6D2B5']}
      style={StyleSheet.absoluteFill}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
    >
      {/* Texture overlay (simple dots pattern simulated with absolute views or kept simple) */}
      <View style={styles.textureOverlay} />

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerBorder}>
          <Text style={styles.headerTitle}>PASSPORT</Text>
        </View>
        <Text style={styles.headerSubtitle}>MY TRAVEL CHRONICLES</Text>
      </View>

      {/* Country count badge - styled like a visa stamp */}
      <View style={styles.countBadgeWrapper}>
        <View style={styles.countBadge}>
          <Text style={styles.countNumber}>{totalCountries}</Text>
          <Text style={styles.countLabel}>COUNTRIES</Text>
        </View>
      </View>

      {/* Stamp grid */}
      <View style={styles.stampContainer}>
        {visitedCountries.slice(0, 25).map((code, index) => {
          const stampImage = getStampImage(code);
          const pos = positions[index];
          if (!stampImage || !pos) return null;

          return (
            <View
              key={code}
              style={[
                styles.stamp,
                {
                  left: pos.x,
                  top: pos.y,
                  width: stampSize,
                  height: stampSize,
                  transform: [{ rotate: `${pos.rotation}deg` }],
                },
              ]}
            >
              <Image source={stampImage} style={styles.stampImage} resizeMode="contain" />
            </View>
          );
        })}
        {visitedCountries.length > 25 && (
          <View
            style={[
              styles.moreStampsIndicator,
              {
                top: (positions[24]?.y ?? 0) + 40 * SCALE,
                left: (positions[24]?.x ?? 0) + 40 * SCALE,
              },
            ]}
          >
            <Text style={styles.moreStampsText}>+{visitedCountries.length - 25}</Text>
          </View>
        )}
      </View>

      {/* Watermark */}
      <Image source={atlasLogo} style={styles.watermark} resizeMode="contain" />
    </LinearGradient>
  );
});

/**
 * Card 2: Travel Stats
 * Travel tier badge with key statistics
 */
const StatsVariant = memo(function StatsVariant({ context }: { context: OnboardingShareContext }) {
  const { totalCountries, regionCount, subregionCount, travelTier } = context;

  return (
    <LinearGradient
      colors={['#1a2a3a', '#2c3e50', '#1a2a3a']}
      style={StyleSheet.absoluteFill}
      start={{ x: 0.5, y: 0 }}
      end={{ x: 0.5, y: 1 }}
    >
      {/* Background decoration */}
      <View style={styles.statsBgDecorationCircle} />

      {/* Header */}
      <View style={styles.statsHeader}>
        <Text style={styles.statsSubtitle}>THE JOURNEY SO FAR</Text>
        <Text style={styles.statsTitle}>EXPLORER STATS</Text>
      </View>

      {/* Travel tier badge - hero element */}
      <View style={styles.tierContainer}>
        <LinearGradient
          colors={[colors.sunsetGold, '#D4AF37']}
          style={styles.tierCircle}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        >
          <Ionicons
            name={travelTier.icon as keyof typeof Ionicons.glyphMap}
            size={Math.round(64 * SCALE)}
            color={colors.midnightNavy}
          />
        </LinearGradient>
        <View style={styles.tierLabelContainer}>
          <Text style={styles.tierLabel}>CURRENT RANK</Text>
          <Text style={styles.tierStatus}>{travelTier.status}</Text>
        </View>
      </View>

      {/* Hero number */}
      <View style={styles.heroNumberContainer}>
        <Text style={styles.heroNumber}>{totalCountries}</Text>
        <Text style={styles.heroLabel}>COUNTRIES VISITED</Text>
      </View>

      {/* Stats grid */}
      <View style={styles.statsGrid}>
        <View style={styles.statBox}>
          <Text style={styles.statNumber}>{regionCount}</Text>
          <Text style={styles.statLabel}>REGIONS</Text>
        </View>
        <View style={styles.statDividerVertical} />
        <View style={styles.statBox}>
          <Text style={styles.statNumber}>{subregionCount}</Text>
          <Text style={styles.statLabel}>SUBREGIONS</Text>
        </View>
      </View>

      {/* Watermark */}
      <Image
        source={atlasLogo}
        style={[styles.watermark, { tintColor: withAlpha(colors.white, 0.8) }]}
        resizeMode="contain"
      />
    </LinearGradient>
  );
});

/**
 * Card 3: World Map Infographic
 * Stylized map with visited regions highlighted
 */
const MapVariant = memo(function MapVariant({ context }: { context: OnboardingShareContext }) {
  const { totalCountries, regions, regionCount, travelTier } = context;

  return (
    <LinearGradient
      colors={[colors.midnightNavy, '#2c3e50', colors.midnightNavy]}
      style={StyleSheet.absoluteFill}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
    >
      {/* Header */}
      <View style={styles.mapHeader}>
        <Text style={styles.mapTitle}>WORLD FOOTPRINT</Text>
        <View style={styles.mapUnderline} />
      </View>

      {/* World Map */}
      <View style={styles.mapContainer}>
        {/* Glow effect behind map */}
        <View style={styles.mapGlow} />
        <WorldMapSvg
          width={CARD_WIDTH - 40 * SCALE}
          highlightedRegions={regions}
          highlightColor={colors.sunsetGold}
          mutedColor={withAlpha(colors.cloudWhite, 0.15)}
          strokeColor={withAlpha(colors.cloudWhite, 0.2)}
        />
      </View>

      {/* Stats overlay */}
      <View style={styles.mapStatsContainer}>
        <View style={styles.mapStatRow}>
          <View style={styles.mapStatItem}>
            <Text style={styles.mapStatNumber}>{totalCountries}</Text>
            <Text style={styles.mapStatLabel}>COUNTRIES</Text>
          </View>
          <View style={styles.mapStatDivider} />
          <View style={styles.mapStatItem}>
            <Text style={styles.mapStatNumber}>{regionCount}/6</Text>
            <Text style={styles.mapStatLabel}>REGIONS</Text>
          </View>
        </View>

        {/* Region dots */}
        <View style={styles.regionDotsContainer}>
          {[...Array(6)].map((_, i) => (
            <View
              key={i}
              style={[
                styles.regionDot,
                i < regionCount && styles.regionDotFilled,
                i < regionCount && styles.regionDotGlow,
              ]}
            />
          ))}
        </View>

        {/* Tier pill */}
        <View style={styles.mapTierContainer}>
          <LinearGradient
            colors={[withAlpha(colors.sunsetGold, 0.2), withAlpha(colors.sunsetGold, 0.05)]}
            style={styles.mapTierBadge}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
          >
            <Ionicons
              name={travelTier.icon as keyof typeof Ionicons.glyphMap}
              size={Math.round(20 * SCALE)}
              color={colors.sunsetGold}
            />
            <Text style={styles.mapTierText}>{travelTier.status}</Text>
          </LinearGradient>
        </View>
      </View>

      {/* Watermark */}
      <Image
        source={atlasLogo}
        style={[styles.watermark, { tintColor: withAlpha(colors.white, 0.8) }]}
        resizeMode="contain"
      />
    </LinearGradient>
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

// Export dimensions for parent components
export const ONBOARDING_SHARE_CARD_WIDTH = CARD_WIDTH;
export const ONBOARDING_SHARE_CARD_HEIGHT = CARD_HEIGHT;

const styles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: colors.warmCream,
  },

  // ============ SHARED STYLES ============

  watermark: {
    position: 'absolute',
    bottom: 32 * SCALE,
    right: 32 * SCALE,
    width: 140 * SCALE,
    height: 40 * SCALE,
    opacity: 0.8,
  },

  // ============ STAMPS VARIANT ============
  textureOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
    opacity: 0.1,
  },
  header: {
    alignItems: 'center',
    paddingTop: 100 * SCALE,
    paddingHorizontal: 32 * SCALE,
    zIndex: 10,
  },
  headerBorder: {
    borderBottomWidth: 2 * SCALE,
    borderBottomColor: colors.midnightNavy,
    borderTopWidth: 2 * SCALE,
    borderTopColor: colors.midnightNavy,
    paddingVertical: 8 * SCALE,
    paddingHorizontal: 24 * SCALE,
    marginBottom: 8 * SCALE,
  },
  headerTitle: {
    fontFamily: fonts.oswald.bold,
    fontSize: 48 * SCALE,
    color: colors.midnightNavy,
    letterSpacing: 8 * SCALE,
    textAlign: 'center',
  },
  headerSubtitle: {
    fontFamily: fonts.dawning.regular,
    fontSize: 28 * SCALE,
    color: colors.stormGray,
    transform: [{ rotate: '-2deg' }],
  },
  countBadgeWrapper: {
    position: 'absolute',
    top: 220 * SCALE,
    right: 40 * SCALE,
    zIndex: 20,
    transform: [{ rotate: '15deg' }],
  },
  countBadge: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 180 * SCALE,
    height: 180 * SCALE,
    borderRadius: 90 * SCALE,
    borderWidth: 6 * SCALE,
    borderColor: withAlpha(colors.sunsetGold, 0.8),
    borderStyle: 'dashed',
    backgroundColor: withAlpha(colors.warmCream, 0.9),
  },
  countNumber: {
    fontFamily: fonts.oswald.bold,
    fontSize: 64 * SCALE,
    color: colors.sunsetGold,
    lineHeight: 70 * SCALE,
  },
  countLabel: {
    fontFamily: fonts.openSans.bold,
    fontSize: 14 * SCALE,
    color: colors.midnightNavy,
    textTransform: 'uppercase',
  },
  stampContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  stamp: {
    position: 'absolute',
    shadowColor: '#000',
    shadowOffset: { width: 2, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  stampImage: {
    width: '100%',
    height: '100%',
  },
  moreStampsIndicator: {
    position: 'absolute',
    backgroundColor: colors.midnightNavy,
    width: 80 * SCALE,
    height: 80 * SCALE,
    borderRadius: 40 * SCALE,
    justifyContent: 'center',
    alignItems: 'center',
    transform: [{ rotate: '-10deg' }],
    borderWidth: 2 * SCALE,
    borderColor: colors.white,
  },
  moreStampsText: {
    fontFamily: fonts.oswald.bold,
    fontSize: 24 * SCALE,
    color: colors.white,
  },

  // ============ STATS VARIANT ============
  statsBgDecorationCircle: {
    position: 'absolute',
    top: -300 * SCALE,
    left: -200 * SCALE,
    width: 1000 * SCALE,
    height: 1000 * SCALE,
    borderRadius: 500 * SCALE,
    backgroundColor: withAlpha(colors.white, 0.03),
  },
  statsHeader: {
    alignItems: 'center',
    paddingTop: 120 * SCALE,
  },
  statsSubtitle: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 18 * SCALE,
    color: colors.sunsetGold,
    letterSpacing: 4 * SCALE,
    marginBottom: 16 * SCALE,
  },
  statsTitle: {
    fontFamily: fonts.playfair.bold,
    fontSize: 56 * SCALE,
    color: colors.white,
    textAlign: 'center',
  },
  tierContainer: {
    alignItems: 'center',
    marginTop: 80 * SCALE,
  },
  tierCircle: {
    width: 160 * SCALE,
    height: 160 * SCALE,
    borderRadius: 80 * SCALE,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: colors.sunsetGold,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 30,
    elevation: 15,
    marginBottom: 24 * SCALE,
  },
  tierLabelContainer: {
    alignItems: 'center',
  },
  tierLabel: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 16 * SCALE,
    color: withAlpha(colors.white, 0.6),
    letterSpacing: 2 * SCALE,
    marginBottom: 4 * SCALE,
  },
  tierStatus: {
    fontFamily: fonts.oswald.bold,
    fontSize: 48 * SCALE,
    color: colors.white,
    textTransform: 'uppercase',
    letterSpacing: 2 * SCALE,
  },
  heroNumberContainer: {
    alignItems: 'center',
    marginTop: 100 * SCALE,
  },
  heroNumber: {
    fontFamily: fonts.oswald.bold,
    fontSize: 200 * SCALE,
    color: colors.white,
    lineHeight: 200 * SCALE,
    textShadowColor: 'rgba(0,0,0,0.3)',
    textShadowOffset: { width: 0, height: 10 },
    textShadowRadius: 20,
  },
  heroLabel: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 22 * SCALE,
    color: colors.sunsetGold,
    textTransform: 'uppercase',
    letterSpacing: 6 * SCALE,
    marginTop: 16 * SCALE,
  },
  statsGrid: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 100 * SCALE,
    width: '100%',
    paddingHorizontal: 40 * SCALE,
  },
  statBox: {
    flex: 1,
    alignItems: 'center',
  },
  statNumber: {
    fontFamily: fonts.oswald.medium,
    fontSize: 56 * SCALE,
    color: colors.white,
  },
  statLabel: {
    fontFamily: fonts.openSans.regular,
    fontSize: 16 * SCALE,
    color: withAlpha(colors.white, 0.6),
    marginTop: 8 * SCALE,
    letterSpacing: 1 * SCALE,
  },
  statDividerVertical: {
    width: 1 * SCALE,
    height: 80 * SCALE,
    backgroundColor: withAlpha(colors.white, 0.2),
    marginHorizontal: 20 * SCALE,
  },

  // ============ MAP VARIANT ============
  mapHeader: {
    alignItems: 'center',
    paddingTop: 100 * SCALE,
  },
  mapTitle: {
    fontFamily: fonts.playfair.bold,
    fontSize: 56 * SCALE,
    color: colors.white,
    letterSpacing: 1 * SCALE,
  },
  mapUnderline: {
    width: 80 * SCALE,
    height: 4 * SCALE,
    backgroundColor: colors.sunsetGold,
    marginTop: 16 * SCALE,
    borderRadius: 2 * SCALE,
  },
  mapContainer: {
    alignItems: 'center',
    marginTop: 60 * SCALE,
    paddingHorizontal: 30 * SCALE,
    height: 500 * SCALE,
    justifyContent: 'center',
  },
  mapGlow: {
    position: 'absolute',
    width: 600 * SCALE,
    height: 300 * SCALE,
    borderRadius: 150 * SCALE,
    backgroundColor: withAlpha(colors.sunsetGold, 0.1),
  },
  mapStatsContainer: {
    paddingHorizontal: 60 * SCALE,
    marginTop: 80 * SCALE,
    alignItems: 'center',
  },
  mapStatRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    marginBottom: 60 * SCALE,
  },
  mapStatItem: {
    alignItems: 'center',
    flex: 1,
  },
  mapStatNumber: {
    fontFamily: fonts.oswald.bold,
    fontSize: 72 * SCALE,
    color: colors.white,
  },
  mapStatLabel: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 16 * SCALE,
    color: colors.sunsetGold,
    letterSpacing: 2 * SCALE,
    marginTop: 8 * SCALE,
  },
  mapStatDivider: {
    width: 1 * SCALE,
    height: 80 * SCALE,
    backgroundColor: withAlpha(colors.white, 0.2),
    marginHorizontal: 30 * SCALE,
  },
  regionDotsContainer: {
    flexDirection: 'row',
    gap: 16 * SCALE,
    marginBottom: 60 * SCALE,
  },
  regionDot: {
    width: 24 * SCALE,
    height: 24 * SCALE,
    borderRadius: 12 * SCALE,
    backgroundColor: withAlpha(colors.white, 0.1),
    borderWidth: 1 * SCALE,
    borderColor: withAlpha(colors.white, 0.3),
  },
  regionDotFilled: {
    backgroundColor: colors.sunsetGold,
    borderColor: colors.sunsetGold,
  },
  regionDotGlow: {
    shadowColor: colors.sunsetGold,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 8,
  },
  mapTierContainer: {
    alignItems: 'center',
  },
  mapTierBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16 * SCALE,
    paddingHorizontal: 40 * SCALE,
    borderRadius: 40 * SCALE,
    gap: 12 * SCALE,
    borderWidth: 1 * SCALE,
    borderColor: withAlpha(colors.sunsetGold, 0.3),
  },
  mapTierText: {
    fontFamily: fonts.oswald.medium,
    fontSize: 24 * SCALE,
    color: colors.sunsetGold,
    textTransform: 'uppercase',
    letterSpacing: 2 * SCALE,
  },
});
