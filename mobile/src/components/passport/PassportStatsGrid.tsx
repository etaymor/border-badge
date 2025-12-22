import React from 'react';
import { StyleSheet, View } from 'react-native';
import { colors } from '@constants/colors';
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
        backgroundColor={colors.adobeBrick}
        textColor={colors.cloudWhite}
        labelColor="rgba(255,255,255,0.8)"
        index={0}
        show={!isLoading}
      />
      <StatBox
        value={dreamsCount}
        label="DREAMS"
        backgroundColor={colors.lakeBlue}
        textColor={colors.midnightNavy}
        labelColor={colors.midnightNavy}
        index={1}
        show={!isLoading}
      />
      <StatBox
        value={regionsCount}
        label="REGIONS"
        backgroundColor={colors.sunsetGold}
        textColor={colors.midnightNavy}
        labelColor={colors.midnightNavy}
        index={2}
        show={!isLoading}
      />
      <StatBox
        value={`${worldPercentage}%`}
        label="WORLD"
        backgroundColor={colors.dustyCoral}
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
