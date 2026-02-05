/**
 * PhotoTripsScreen - Displays all photo-discovered trips from SQLite cache.
 *
 * Features:
 * - FlashList for performant rendering of trip cards
 * - Grouped by country with section headers
 * - Animated search bar for country filtering
 * - Pull-to-refresh for cache reload
 * - Stats summary showing trip and photo counts
 */

import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { GlassBackButton, GlassIconButton } from '@components/ui';
import { usePhotoTrips } from '@hooks/usePhotoTrips';
import { useCreateTrip } from '@hooks/useTrips';
import type { TripCandidateDisplay } from '@services/photoImport';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import type { PassportStackScreenProps } from '@navigation/types';

import { PhotoTripCard } from './components/PhotoTripCard';

type Props = PassportStackScreenProps<'PhotoTrips'>;

interface SectionData {
  type: 'header' | 'trip';
  year?: number;
  trip?: TripCandidateDisplay;
  index?: number;
}

/**
 * Section header component for year grouping
 */
function SectionHeader({ year }: { year: number }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{year}</Text>
      <View style={styles.sectionLine} />
    </View>
  );
}

export function PhotoTripsScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const { countryCode: initialCountryCode } = route.params ?? {};
  const {
    filteredTripsByYear,
    sortedYears,
    isLoading,
    isRefreshing,
    hasInitialImport,
    refresh,
    searchQuery,
    setSearchQuery,
  } = usePhotoTrips({ initialCountryCode });

  const createTripMutation = useCreateTrip();

  const handleBack = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  // Search bar state
  const [isSearchExpanded, setIsSearchExpanded] = useState(false);
  const searchHeight = useSharedValue(0);

  // Build flat list data with year section headers
  const listData = useMemo<SectionData[]>(() => {
    const data: SectionData[] = [];
    let tripIndex = 0;

    // Iterate years in descending order (most recent first)
    for (const year of sortedYears) {
      const trips = filteredTripsByYear.get(year);
      if (!trips || trips.length === 0) continue;

      // Add section header
      data.push({ type: 'header', year });

      // Add trips (already sorted by date within groupByYear)
      for (const trip of trips) {
        data.push({ type: 'trip', trip, index: tripIndex });
        tripIndex++;
      }
    }

    return data;
  }, [filteredTripsByYear, sortedYears]);

  // Toggle search bar
  const toggleSearch = useCallback(() => {
    const newExpanded = !isSearchExpanded;
    setIsSearchExpanded(newExpanded);
    // Use withTiming for smooth, professional animation without bounce
    searchHeight.value = withTiming(newExpanded ? 52 : 0, {
      duration: 250,
      easing: Easing.out(Easing.cubic),
    });
    if (!newExpanded) {
      setSearchQuery('');
    }
  }, [isSearchExpanded, searchHeight, setSearchQuery]);

  // Animated search bar style
  const searchBarStyle = useAnimatedStyle(() => ({
    height: searchHeight.value,
    opacity: interpolate(searchHeight.value, [0, 52], [0, 1]),
    overflow: 'hidden' as const,
  }));

  // Handle trip selection - navigate to PhotoImport with context
  const handleSelectTrip = useCallback(
    async (candidate: TripCandidateDisplay, tripId: string) => {
      navigation.navigate('PhotoImport', {
        countryCode: candidate.countryCode,
        tripId,
        autoStart: true,
        skipToSuggestions: true,
      });
    },
    [navigation]
  );

  // Handle trip creation
  const handleCreateTrip = useCallback(
    async (name: string, countryCode: string): Promise<string> => {
      const newTrip = await createTripMutation.mutateAsync({
        name,
        country_code: countryCode,
      });
      return newTrip.id;
    },
    [createTripMutation]
  );

  // Handle starting a new photo scan
  const handleStartScan = useCallback(() => {
    navigation.navigate('PhotoImport', {});
  }, [navigation]);

  // Render list item
  const renderItem = useCallback(
    ({ item }: { item: SectionData }) => {
      if (item.type === 'header' && item.year) {
        return <SectionHeader year={item.year} />;
      }

      if (item.type === 'trip' && item.trip) {
        return (
          <PhotoTripCard
            candidate={item.trip}
            onSelectTrip={handleSelectTrip}
            onCreateTrip={handleCreateTrip}
            index={item.index ?? 0}
          />
        );
      }

      return null;
    },
    [handleSelectTrip, handleCreateTrip]
  );

  // Key extractor
  const keyExtractor = useCallback((item: SectionData, index: number) => {
    if (item.type === 'header') {
      return `header-${item.year}`;
    }
    return item.trip?.id ?? `item-${index}`;
  }, []);

  // Get item type for FlashList optimization
  const getItemType = useCallback((item: SectionData) => {
    return item.type;
  }, []);

  // Empty state component
  const EmptyComponent = useCallback(() => {
    if (isLoading) {
      return (
        <View style={styles.emptyContainer}>
          <ActivityIndicator size="large" color={colors.sunsetGold} />
          <Text style={styles.emptyText}>Loading trips...</Text>
        </View>
      );
    }

    if (searchQuery.trim()) {
      return (
        <View style={styles.emptyContainer}>
          <Ionicons name="search-outline" size={48} color={colors.textSecondary} />
          <Text style={styles.emptyTitle}>No trips found</Text>
          <Text style={styles.emptyText}>No trips match &quot;{searchQuery}&quot;</Text>
          <Pressable style={styles.clearSearchButton} onPress={() => setSearchQuery('')}>
            <Text style={styles.clearSearchText}>Clear Search</Text>
          </Pressable>
        </View>
      );
    }

    if (!hasInitialImport) {
      return (
        <View style={styles.emptyContainer}>
          <Ionicons name="images-outline" size={48} color={colors.sunsetGold} />
          <Text style={styles.emptyTitle}>No Trips Found Yet</Text>
          <Text style={styles.emptyText}>Import photos to discover trips from your travels</Text>
          <Pressable style={styles.scanButton} onPress={handleStartScan}>
            <Ionicons name="scan-outline" size={20} color={colors.midnightNavy} />
            <Text style={styles.scanButtonText}>Scan Photos</Text>
          </Pressable>
        </View>
      );
    }

    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="airplane-outline" size={48} color={colors.textSecondary} />
        <Text style={styles.emptyTitle}>No Travel Photos</Text>
        <Text style={styles.emptyText}>
          Your photos don&apos;t seem to have travel destinations. Try scanning again after your
          next trip!
        </Text>
      </View>
    );
  }, [isLoading, searchQuery, hasInitialImport, setSearchQuery, handleStartScan]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {/* Header */}
      <View style={styles.header}>
        <GlassBackButton onPress={handleBack} />
        <Text style={styles.headerTitle}>Trips from Photos</Text>
        <GlassIconButton
          icon={isSearchExpanded ? 'close' : 'search'}
          onPress={toggleSearch}
          accessibilityLabel={isSearchExpanded ? 'Close search' : 'Search trips'}
        />
      </View>

      {/* Animated Search Bar */}
      <Animated.View style={[styles.searchContainer, searchBarStyle]}>
        <View style={styles.searchInputWrapper}>
          <Ionicons name="search" size={18} color={colors.textSecondary} />
          <TextInput
            style={styles.searchInput}
            placeholder="Filter by country..."
            placeholderTextColor={colors.textSecondary}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {searchQuery.length > 0 && (
            <Pressable onPress={() => setSearchQuery('')} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
            </Pressable>
          )}
        </View>
      </Animated.View>

      {/* Trip List */}
      <FlashList
        data={listData}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        getItemType={getItemType}
        contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 20 }]}
        ListEmptyComponent={EmptyComponent}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={refresh}
            tintColor={colors.sunsetGold}
            colors={[colors.sunsetGold]}
          />
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.warmCream,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 12,
  },
  headerTitle: {
    flex: 1,
    fontFamily: fonts.playfair.bold,
    fontSize: 24,
    color: colors.midnightNavy,
    textAlign: 'center',
  },
  searchContainer: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  searchInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.openSans.regular,
    fontSize: 16,
    color: colors.midnightNavy,
    padding: 0,
  },
  listContent: {
    paddingHorizontal: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 24,
    marginBottom: 16,
  },
  sectionTitle: {
    fontFamily: fonts.dawning.regular,
    fontSize: 40,
    color: colors.adobeBrick,
    marginRight: 12,
  },
  sectionLine: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(193, 84, 62, 0.2)',
    marginTop: 4,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
    paddingTop: 60,
  },
  emptyTitle: {
    fontFamily: fonts.playfair.bold,
    fontSize: 20,
    color: colors.midnightNavy,
    marginTop: 16,
    marginBottom: 8,
  },
  emptyText: {
    fontFamily: fonts.openSans.regular,
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  clearSearchButton: {
    marginTop: 16,
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  clearSearchText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 14,
    color: colors.sunsetGold,
  },
  scanButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.sunsetGold,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
    marginTop: 24,
    gap: 8,
    shadowColor: colors.sunsetGold,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  scanButtonText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 16,
    color: colors.midnightNavy,
  },
});
