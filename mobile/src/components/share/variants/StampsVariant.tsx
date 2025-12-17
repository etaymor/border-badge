import React, { memo, useMemo } from 'react';
import { Image, StyleSheet, View } from 'react-native';

import { Text } from '@components/ui';
import { colors, withAlpha } from '@constants/colors';
import { fonts } from '@constants/typography';

import { getStampImage } from '../../../assets/stampImages';
import atlasLogo from '../../../../assets/atlasi-logo.png';
import { CARD_HEIGHT, CARD_WIDTH, STAMP_POSITIONS } from '../constants';
import type { VariantProps } from '../types';

/**
 * Card 1: Stamps Collection - "The Explorer's Journal"
 * Scattered passport stamps on a warm cream background with clean stats footer.
 */
export const StampsVariant = memo(function StampsVariant({ context }: VariantProps) {
  const { visitedCountries, totalCountries, regionCount } = context;

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

          const pos = STAMP_POSITIONS[index];
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
            <Text style={styles.statNumberNew}>{regionCount}</Text>
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    flexDirection: 'column',
    justifyContent: 'space-between',
    padding: 0,
  },
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
    paddingHorizontal: 16,
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
  logoTaglineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  footerLogoNatural: {
    width: 100,
    height: 30,
  },
  taglineTextOswald: {
    fontFamily: fonts.oswald.medium,
    fontSize: 14,
    color: colors.midnightNavy,
    letterSpacing: 0.5,
  },
});

