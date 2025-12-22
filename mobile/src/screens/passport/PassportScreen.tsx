import { useCallback, useMemo, useState } from 'react';
import { Animated, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import {
  CountryRow,
  PassportEmptyState,
  PassportListHeader,
  PassportSectionHeader,
  StampRow,
} from '@components/passport';
import { ExploreFilterSheet, PassportSkeleton } from '@components/ui';
import { OnboardingShareOverlay, ShareCardOverlay } from '@components/share';
import { usePassportData } from '@hooks/usePassportData';
import { usePassportAnimations } from '@hooks/usePassportAnimations';
import { buildMilestoneContext, type MilestoneContext } from '@utils/milestones';
import type { PassportStackScreenProps } from '@navigation/types';
import { styles } from './passportStyles';
import type { CountryDisplayItem, ListItem, UnvisitedCountry } from './passportTypes';

type Props = PassportStackScreenProps<'PassportHome'>;

export function PassportScreen({ navigation }: Props) {
  // Data hook
  const data = usePassportData();
  const {
    isLoading,
    stats,
    passportShareContext,
    flatListData,
    searchQuery,
    setSearchQuery,
    filters,
    setFilters,
    filterSheetVisible,
    setFilterSheetVisible,
    filtersActive,
    activeFilterCount,
    trackingPreference,
    addUserCountry,
    removeUserCountry,
    wishlistCountries,
    countries,
    userCountries,
  } = data;

  // Animation hook
  const animations = usePassportAnimations(isLoading);
  const {
    fadeAnim,
    viewabilityConfig,
    getRowAnimationValues,
    ensureRowVisible,
    handleViewableItemsChanged,
    computeLayoutData,
    getItemKey,
  } = animations;

  // Share card state
  const [shareCardVisible, setShareCardVisible] = useState(false);
  const [shareCardContext, setShareCardContext] = useState<MilestoneContext | null>(null);
  const [passportShareVisible, setPassportShareVisible] = useState(false);

  // Handlers
  const handleCountryPress = useCallback(
    (item: CountryDisplayItem) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      navigation.navigate('CountryDetail', {
        countryId: item.code,
        countryName: item.name,
        countryCode: item.code,
      });
    },
    [navigation]
  );

  const handleUnvisitedCountryPress = useCallback(
    (country: UnvisitedCountry) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      navigation.navigate('CountryDetail', {
        countryId: country.code,
        countryName: country.name,
        countryCode: country.code,
      });
    },
    [navigation]
  );

  const handleAddVisited = useCallback(
    (countryCode: string) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      const context = buildMilestoneContext(countryCode, countries ?? [], userCountries ?? []);

      addUserCountry.mutate(
        { country_code: countryCode, status: 'visited' },
        {
          onSuccess: () => {
            if (context) {
              setShareCardContext(context);
              setShareCardVisible(true);
            }
          },
        }
      );
    },
    [addUserCountry, countries, userCountries]
  );

  const handleShareCardDismiss = useCallback(() => {
    setShareCardVisible(false);
    setShareCardContext(null);
  }, []);

  const handlePassportShare = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setPassportShareVisible(true);
  }, []);

  const handlePassportShareDismiss = useCallback(() => {
    setPassportShareVisible(false);
  }, []);

  const handleToggleWishlist = useCallback(
    (countryCode: string) => {
      Haptics.selectionAsync();
      const isCurrentlyWishlisted = wishlistCountries.some((uc) => uc.country_code === countryCode);

      if (isCurrentlyWishlisted) {
        removeUserCountry.mutate(countryCode);
      } else {
        addUserCountry.mutate({ country_code: countryCode, status: 'wishlist' });
      }
    },
    [addUserCountry, removeUserCountry, wishlistCountries]
  );

  const handleExplorePress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setFilterSheetVisible(true);
  }, [setFilterSheetVisible]);

  const handleProfilePress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    navigation.navigate('ProfileSettings');
  }, [navigation]);

  const handleCloseFilters = useCallback(() => {
    setFilterSheetVisible(false);
  }, [setFilterSheetVisible]);

  const handleClearFilters = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setFilters({
      status: [],
      continents: [],
      subregions: [],
      recognitionGroups: [],
    });
  }, [setFilters]);

  // Layout data for FlatList
  const layoutData = useMemo(() => computeLayoutData(flatListData), [computeLayoutData, flatListData]);

  const getItemLayout = useCallback(
    (_: ArrayLike<ListItem> | null | undefined, index: number) => {
      const length = layoutData.lengths[index] ?? 0;
      const offset = layoutData.offsets[index] ?? 0;
      return { length, offset, index };
    },
    [layoutData]
  );

  // Render functions
  const renderStampRow = useCallback(
    (stamps: CountryDisplayItem[], rowKey: string) => {
      const animValues = getRowAnimationValues(rowKey, stamps.length);
      ensureRowVisible(rowKey, animValues);
      return <StampRow stamps={stamps} animValues={animValues} onCountryPress={handleCountryPress} />;
    },
    [getRowAnimationValues, ensureRowVisible, handleCountryPress]
  );

  const renderUnvisitedRow = useCallback(
    (countries: UnvisitedCountry[], rowKey: string) => {
      const animValues = getRowAnimationValues(rowKey, countries.length);
      ensureRowVisible(rowKey, animValues);
      return (
        <CountryRow
          countries={countries}
          animValues={animValues}
          onCountryPress={handleUnvisitedCountryPress}
          onAddVisited={handleAddVisited}
          onToggleWishlist={handleToggleWishlist}
        />
      );
    },
    [getRowAnimationValues, ensureRowVisible, handleUnvisitedCountryPress, handleAddVisited, handleToggleWishlist]
  );

  const renderItem = useCallback(
    ({ item }: { item: ListItem }) => {
      switch (item.type) {
        case 'section-header':
          return (
            <PassportSectionHeader
              title={item.title}
              showShareButton={item.key === 'header-visited' && !!passportShareContext}
              onSharePress={handlePassportShare}
              variant={item.key === 'header-visited' ? 'visited' : item.key === 'header-explore' ? 'explore' : 'default'}
            />
          );
        case 'stamp-row':
          return renderStampRow(item.data, item.key);
        case 'unvisited-row':
          return renderUnvisitedRow(item.data, item.key);
        case 'empty-state':
          return <PassportEmptyState />;
        default:
          return null;
      }
    },
    [renderStampRow, renderUnvisitedRow, passportShareContext, handlePassportShare]
  );

  // List header
  const ListHeader = useMemo(
    () => (
      <PassportListHeader
        stats={stats}
        searchQuery={searchQuery}
        isLoading={isLoading}
        filtersActive={filtersActive}
        activeFilterCount={activeFilterCount}
        onSearchChange={setSearchQuery}
        onExplorePress={handleExplorePress}
        onProfilePress={handleProfilePress}
      />
    ),
    [stats, searchQuery, isLoading, filtersActive, activeFilterCount, setSearchQuery, handleExplorePress, handleProfilePress]
  );

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <PassportSkeleton />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <Animated.View style={[styles.animatedContainer, { opacity: fadeAnim }]}>
        <FlatList
          data={flatListData}
          renderItem={renderItem}
          keyExtractor={getItemKey}
          getItemLayout={getItemLayout}
          ListHeaderComponent={ListHeader}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          removeClippedSubviews={true}
          maxToRenderPerBatch={20}
          windowSize={11}
          initialNumToRender={15}
          updateCellsBatchingPeriod={30}
          onViewableItemsChanged={handleViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
        />
      </Animated.View>

      <ExploreFilterSheet
        visible={filterSheetVisible}
        filters={filters}
        onFiltersChange={setFilters}
        onClose={handleCloseFilters}
        onClearAll={handleClearFilters}
        onApply={handleCloseFilters}
        trackingPreference={trackingPreference}
      />

      <ShareCardOverlay
        visible={shareCardVisible}
        context={shareCardContext}
        onDismiss={handleShareCardDismiss}
      />

      <OnboardingShareOverlay
        visible={passportShareVisible}
        context={passportShareContext}
        onDismiss={handlePassportShareDismiss}
      />
    </SafeAreaView>
  );
}
