import React from 'react';
import { View } from 'react-native';
import { PassportHeader } from './PassportHeader';
import { TravelStatusCard } from './TravelStatusCard';
import { PassportStatsGrid } from './PassportStatsGrid';
import { PassportSearchBar } from './PassportSearchBar';
import type { PassportStats } from '../../screens/passport/passportTypes';

interface PassportListHeaderProps {
  stats: PassportStats;
  searchQuery: string;
  isLoading: boolean;
  filtersActive: boolean;
  activeFilterCount: number;
  onSearchChange: (query: string) => void;
  onExplorePress: () => void;
  onProfilePress: () => void;
  onPastePress?: () => void;
  showPasteButton?: boolean;
}

export function PassportListHeader({
  stats,
  searchQuery,
  isLoading,
  filtersActive,
  activeFilterCount,
  onSearchChange,
  onExplorePress,
  onProfilePress,
  onPastePress,
  showPasteButton,
}: PassportListHeaderProps) {
  return (
    <View>
      <PassportHeader
        onProfilePress={onProfilePress}
        onPastePress={onPastePress}
        showPasteButton={showPasteButton}
      />
      <TravelStatusCard
        travelStatus={stats.travelStatus}
        stampedCount={stats.stampedCount}
        totalCountries={stats.totalCountries}
        worldPercentage={stats.worldPercentage}
      />
      <PassportStatsGrid
        stampedCount={stats.stampedCount}
        dreamsCount={stats.dreamsCount}
        regionsCount={stats.regionsCount}
        worldPercentage={stats.worldPercentage}
        isLoading={isLoading}
      />
      <PassportSearchBar
        searchQuery={searchQuery}
        onSearchChange={onSearchChange}
        onExplorePress={onExplorePress}
        filtersActive={filtersActive}
        activeFilterCount={activeFilterCount}
      />
    </View>
  );
}
