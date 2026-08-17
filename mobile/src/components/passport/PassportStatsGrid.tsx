import React from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, withAlpha } from '@constants/colors';
import { StatBox } from './StatBox';

interface PassportStatsGridProps {
  stampedCount: number;
  dreamsCount: number;
  regionsCount: number;
  worldPercentage: number;
  isLoading: boolean;
}

export function PassportStatsGrid({
  stampedCount,
  dreamsCount,
  regionsCount,
  worldPercentage,
  isLoading,
}: PassportStatsGridProps) {
  return (
    <View style={styles.statsGrid}>
      <StatBox
        value={stampedCount}
        label="STAMPED"
        backgroundColor={withAlpha(colors.adobeBrick, 0.25)}
        textColor={colors.midnightNavy}
        labelColor={colors.midnightNavy}
        index={0}
        show={!isLoading}
      />
      <StatBox
        value={dreamsCount}
        label="DREAMS"
        backgroundColor={withAlpha(colors.lakeBlue, 0.3)}
        textColor={colors.midnightNavy}
        labelColor={colors.midnightNavy}
        index={1}
        show={!isLoading}
      />
      <StatBox
        value={regionsCount}
        label="REGIONS"
        backgroundColor={withAlpha(colors.sunsetGold, 0.3)}
        textColor={colors.midnightNavy}
        labelColor={colors.midnightNavy}
        index={2}
        show={!isLoading}
      />
      <StatBox
        value={`${worldPercentage}%`}
        label="WORLD"
        backgroundColor={withAlpha(colors.dustyCoral, 0.25)}
        textColor={colors.midnightNavy}
        labelColor={colors.midnightNavy}
        index={3}
        show={!isLoading}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  statsGrid: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 16,
    gap: 12,
  },
});
