import { Ionicons } from '@expo/vector-icons';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CountryCard, VisitedCountryCard } from '@components/ui';
import { colors } from '@constants/colors';
import { useCountries } from '@hooks/useCountries';
import { useAddUserCountry, useRemoveUserCountry, useUserCountries } from '@hooks/useUserCountries';
import type { PassportStackScreenProps } from '@navigation/types';

type Props = PassportStackScreenProps<'PassportHome'>;

interface CountryDisplayItem {
  code: string;
  name: string;
  region: string;
  status: 'visited' | 'wishlist';
}

interface UnvisitedCountry {
  code: string;
  name: string;
  region: string;
  isWishlisted: boolean;
}

type ListItem =
  | { type: 'section-header'; title: string; key: string }
  | { type: 'visited-country'; data: CountryDisplayItem; key: string }
  | { type: 'unvisited-country'; data: UnvisitedCountry; key: string }
  | { type: 'empty-state'; key: string };

/** Travel status tiers based on number of countries visited */
const TRAVEL_STATUS_TIERS = [
  { threshold: 5, status: 'Local Wanderer' },
  { threshold: 15, status: 'Pathfinder' },
  { threshold: 30, status: 'Border Breaker' },
  { threshold: 50, status: 'Roving Explorer' },
  { threshold: 80, status: 'Globe Trotter' },
  { threshold: 120, status: 'World Seeker' },
  { threshold: 160, status: 'Continental Master' },
  { threshold: Infinity, status: 'Global Elite' },
] as const;

/**
 * Get travel status based on number of countries visited.
 */
function getTravelStatus(visitedCount: number): string {
  const tier = TRAVEL_STATUS_TIERS.find((t) => visitedCount <= t.threshold);
  return tier?.status ?? 'Global Elite';
}

interface StatBoxProps {
  value: string | number;
  label: string;
}

function StatBox({ value, label }: StatBoxProps) {
  return (
    <View style={styles.statBox}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export function PassportScreen({ navigation }: Props) {
  const { data: userCountries, isLoading: loadingUserCountries } = useUserCountries();
  const { data: countries, isLoading: loadingCountries } = useCountries();
  const addUserCountry = useAddUserCountry();
  const removeUserCountry = useRemoveUserCountry();
  const [searchQuery, setSearchQuery] = useState('');

  // Compute visited and wishlist countries
  const { visitedCountries, wishlistCountries } = useMemo(() => {
    if (!userCountries) return { visitedCountries: [], wishlistCountries: [] };
    return {
      visitedCountries: userCountries.filter((uc) => uc.status === 'visited'),
      wishlistCountries: userCountries.filter((uc) => uc.status === 'wishlist'),
    };
  }, [userCountries]);

  // Pre-compute searchable country data (avoids repeated toLowerCase calls during search)
  const searchableCountries = useMemo(() => {
    if (!countries) return [];
    return countries.map((c) => ({
      ...c,
      searchName: c.name.toLowerCase(),
    }));
  }, [countries]);

  // Combine visited countries with country metadata for display (filtered by search)
  const displayItems = useMemo((): CountryDisplayItem[] => {
    if (!visitedCountries.length || !searchableCountries.length) return [];

    const visitedCodes = visitedCountries.map((uc) => uc.country_code);
    const query = searchQuery.toLowerCase().trim();

    return searchableCountries
      .filter((c) => visitedCodes.includes(c.code))
      .filter((c) => !query || c.searchName.includes(query))
      .map((c) => ({
        code: c.code,
        name: c.name,
        region: c.region,
        status: 'visited' as const,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [visitedCountries, searchableCountries, searchQuery]);

  // Compute all stats
  const stats = useMemo(() => {
    const stampedCount = visitedCountries.length;
    const dreamsCount = wishlistCountries.length;
    const totalCountries = countries?.length || 197;
    const worldPercentage =
      totalCountries > 0 ? Math.round((stampedCount / totalCountries) * 100) : 0;

    // Calculate unique regions visited
    const visitedCodes = new Set(visitedCountries.map((uc) => uc.country_code));
    const visitedCountryDetails = countries?.filter((c) => visitedCodes.has(c.code)) || [];
    const uniqueRegions = new Set(visitedCountryDetails.map((c) => c.region));
    const regionsCount = uniqueRegions.size;

    const travelStatus = getTravelStatus(stampedCount);

    return {
      stampedCount,
      dreamsCount,
      totalCountries,
      worldPercentage,
      regionsCount,
      travelStatus,
    };
  }, [visitedCountries, wishlistCountries, countries]);

  // Compute unvisited countries for the Explore section (filtered by search)
  const unvisitedCountries = useMemo((): UnvisitedCountry[] => {
    if (!searchableCountries.length) return [];

    const visitedCodes = new Set(visitedCountries.map((uc) => uc.country_code));
    const wishlistCodes = new Set(wishlistCountries.map((uc) => uc.country_code));
    const query = searchQuery.toLowerCase().trim();

    return searchableCountries
      .filter((c) => !visitedCodes.has(c.code))
      .filter((c) => !query || c.searchName.includes(query))
      .map((c) => ({
        code: c.code,
        name: c.name,
        region: c.region,
        isWishlisted: wishlistCodes.has(c.code),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [searchableCountries, visitedCountries, wishlistCountries, searchQuery]);

  // Flatten data into single array with section markers for FlatList virtualization
  const flatListData = useMemo((): ListItem[] => {
    const items: ListItem[] = [];

    // Add visited section header (only if there are visited countries or no search)
    if (displayItems.length > 0 || !searchQuery) {
      items.push({ type: 'section-header', title: "Where you've been", key: 'header-visited' });
    }

    // Add empty state if no visited countries and no search
    if (!searchQuery && visitedCountries.length === 0) {
      items.push({ type: 'empty-state', key: 'empty-state' });
    }

    // Add visited countries
    displayItems.forEach((item) => {
      items.push({ type: 'visited-country', data: item, key: `visited-${item.code}` });
    });

    // Add explore section only when there are unvisited countries to show
    if (unvisitedCountries.length > 0) {
      items.push({ type: 'section-header', title: 'Explore the World', key: 'header-explore' });
      unvisitedCountries.forEach((country) => {
        items.push({ type: 'unvisited-country', data: country, key: `unvisited-${country.code}` });
      });
    }

    return items;
  }, [displayItems, unvisitedCountries, searchQuery, visitedCountries.length]);

  const handleCountryPress = useCallback(
    (item: CountryDisplayItem) => {
      navigation.navigate('CountryDetail', {
        countryId: item.code,
        countryName: item.name,
        countryCode: item.code,
      });
    },
    [navigation]
  );

  const handleUnvisitedCountryPress = useCallback(
    (country: { code: string; name: string }) => {
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
      addUserCountry.mutate({ country_code: countryCode, status: 'visited' });
    },
    [addUserCountry]
  );

  const handleToggleWishlist = useCallback(
    (countryCode: string) => {
      const isCurrentlyWishlisted = wishlistCountries.some((uc) => uc.country_code === countryCode);

      if (isCurrentlyWishlisted) {
        removeUserCountry.mutate(countryCode);
      } else {
        addUserCountry.mutate({ country_code: countryCode, status: 'wishlist' });
      }
    },
    [addUserCountry, removeUserCountry, wishlistCountries]
  );

  const renderVisitedCountryItem = useCallback(
    (item: CountryDisplayItem) => (
      <VisitedCountryCard
        code={item.code}
        name={item.name}
        region={item.region}
        onPress={() => handleCountryPress(item)}
      />
    ),
    [handleCountryPress]
  );

  const renderUnvisitedCountryItem = useCallback(
    (country: UnvisitedCountry) => {
      return (
        <View style={styles.countryCardWrapper}>
          <CountryCard
            code={country.code}
            name={country.name}
            region={country.region}
            isVisited={false}
            isWishlisted={country.isWishlisted}
            onPress={() => handleUnvisitedCountryPress(country)}
            onAddVisited={() => handleAddVisited(country.code)}
            onToggleWishlist={() => handleToggleWishlist(country.code)}
          />
        </View>
      );
    },
    [handleUnvisitedCountryPress, handleAddVisited, handleToggleWishlist]
  );

  const renderItem = useCallback(
    ({ item }: { item: ListItem }) => {
      switch (item.type) {
        case 'section-header':
          return <Text style={styles.sectionTitle}>{item.title}</Text>;
        case 'visited-country':
          return renderVisitedCountryItem(item.data);
        case 'unvisited-country':
          return renderUnvisitedCountryItem(item.data);
        case 'empty-state':
          return (
            <View style={styles.emptyState}>
              <Text style={styles.emptyIcon}>🌍</Text>
              <Text style={styles.emptyTitle}>No countries yet</Text>
              <Text style={styles.emptySubtitle}>
                Create a trip to start building your passport!
              </Text>
            </View>
          );
        default:
          return null;
      }
    },
    [renderVisitedCountryItem, renderUnvisitedCountryItem]
  );

  const getItemKey = useCallback((item: ListItem) => item.key, []);

  const isLoading = loadingUserCountries || loadingCountries;

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right']}>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      </SafeAreaView>
    );
  }

  const ListHeader = useMemo(
    () => (
      <View>
        {/* Travel Status Card */}
        <View style={styles.statusCard}>
          <View style={styles.statusHeader}>
            <View style={styles.statusLeft}>
              <Text style={styles.statusTitle}>{stats.travelStatus}</Text>
              <Text style={styles.statusLabel}>TRAVEL STATUS</Text>
            </View>
            <View style={styles.statusRight}>
              <Text style={styles.countryCount}>
                {stats.stampedCount}/{stats.totalCountries}
              </Text>
              <Text style={styles.countryLabel}>COUNTRIES</Text>
            </View>
          </View>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: `${stats.worldPercentage}%` }]} />
          </View>
        </View>

        {/* Stats Grid */}
        <View style={styles.statsGrid}>
          <StatBox value={stats.stampedCount} label="STAMPED" />
          <StatBox value={stats.dreamsCount} label="DREAMS" />
          <StatBox value={stats.regionsCount} label="REGIONS" />
          <StatBox value={`${stats.worldPercentage}%`} label="WORLD" />
        </View>

        {/* Search & Filter Row */}
        <View style={styles.searchRow}>
          <View style={styles.searchInputContainer}>
            <Ionicons
              name="search"
              size={18}
              color={colors.textTertiary}
              style={styles.searchIcon}
            />
            <TextInput
              style={styles.searchInput}
              placeholder="Search countries..."
              placeholderTextColor={colors.textTertiary}
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
            />
          </View>
          {searchQuery.length > 0 && (
            <TouchableOpacity
              style={styles.clearButton}
              onPress={() => setSearchQuery('')}
              activeOpacity={0.7}
            >
              <Text style={styles.clearButtonText}>Clear</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    ),
    [stats, searchQuery]
  );

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <FlatList
        data={flatListData}
        renderItem={renderItem}
        keyExtractor={getItemKey}
        ListHeaderComponent={ListHeader}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        removeClippedSubviews={true}
        maxToRenderPerBatch={10}
        windowSize={5}
        initialNumToRender={10}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 16,
    color: colors.textSecondary,
  },
  listContent: {
    paddingBottom: 24,
  },
  // Travel Status Card
  statusCard: {
    marginTop: 16,
    marginHorizontal: 16,
    backgroundColor: colors.backgroundCard,
    borderRadius: 12,
    padding: 16,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  statusHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  statusLeft: {
    flex: 1,
  },
  statusTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.successDark,
  },
  statusLabel: {
    fontSize: 12,
    color: colors.successDark,
    marginTop: 2,
    fontWeight: '500',
  },
  statusRight: {
    alignItems: 'flex-end',
  },
  countryCount: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.textPrimary,
  },
  countryLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
    fontWeight: '500',
  },
  progressBar: {
    width: '100%',
    height: 6,
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#4DB6AC', // Teal - keeping unique accent color
    borderRadius: 3,
  },
  // Stats Grid
  statsGrid: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 16,
    gap: 12,
  },
  statBox: {
    flex: 1,
    backgroundColor: colors.backgroundCard,
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 8,
    alignItems: 'center',
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  statValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.textPrimary,
  },
  statLabel: {
    fontSize: 10,
    color: colors.textSecondary,
    marginTop: 4,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  // Search Row
  searchRow: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 16,
    gap: 12,
    alignItems: 'center',
  },
  searchInputContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 20,
    paddingHorizontal: 16,
    height: 44,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: colors.textPrimary,
  },
  clearButton: {
    paddingHorizontal: 12,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  clearButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.primary,
  },
  // Section Title
  sectionTitle: {
    fontSize: 18,
    color: colors.textSecondary,
    marginHorizontal: 16,
    marginTop: 24,
    marginBottom: 12,
    fontStyle: 'italic',
  },
  // Country Card Wrapper
  countryCardWrapper: {
    marginBottom: 12,
  },
  // Empty State
  emptyState: {
    paddingVertical: 40,
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  emptyIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 16,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
