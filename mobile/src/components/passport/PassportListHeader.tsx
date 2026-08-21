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
  /**
   * Rendered between the stats grid and the country search. Guess Where sits
   * here so it reads as part of the home surface rather than an afterthought
   * below the search field; pass null to hide it (e.g. while searching).
   */
  guessWhereSlot?: React.ReactNode;
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
  guessWhereSlot,
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
      {guessWhereSlot}
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
