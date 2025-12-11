import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CountryCard, PassportSkeleton, StampCard } from '@components/ui';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
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
  | { type: 'stamp-row'; data: CountryDisplayItem[]; key: string }
  | { type: 'unvisited-row'; data: UnvisitedCountry[]; key: string }
  | { type: 'empty-state'; key: string };

/** Travel status tiers based on number of countries visited */
const TRAVEL_STATUS_TIERS = [
  { threshold: 5, status: 'Tourist' },
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
  backgroundColor: string;
  textColor?: string;
  labelColor?: string;
  index: number;
  show: boolean;
}

function StatBox({
  value,
  label,
  backgroundColor,
  textColor = colors.midnightNavy,
  labelColor,
  index,
  show,
}: StatBoxProps) {
  const scaleAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (show) {
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 6,
        tension: 50,
        delay: index * 100, // Staggered delay
        useNativeDriver: true,
      }).start();
    }
  }, [show, index, scaleAnim]);

  return (
    <Animated.View
      style={[
        styles.statBox,
        {
          backgroundColor,
          transform: [{ scale: scaleAnim }],
          opacity: scaleAnim,
        },
      ]}
    >
      <Text style={[styles.statValue, { color: textColor }]}>{value}</Text>
      <Text
        style={[
          styles.statLabel,
          labelColor ? { color: labelColor } : { color: textColor, opacity: 0.7 },
        ]}
      >
        {label}
      </Text>
    </Animated.View>
  );
}

function AnimatedListItem({
  children,
  index,
  baseDelay = 400,
}: {
  children: React.ReactNode;
  index: number;
  baseDelay?: number;
}) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 500,
        delay: baseDelay + index * 100,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 500,
        delay: baseDelay + index * 100,
        useNativeDriver: true,
      }),
    ]).start();
  }, [fadeAnim, translateY, index, baseDelay]);

  return (
    <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY }] }}>
      {children}
    </Animated.View>
  );
}

export function PassportScreen({ navigation }: Props) {
  const { data: userCountries, isLoading: loadingUserCountries } = useUserCountries();
  const { data: countries, isLoading: loadingCountries } = useCountries();
  const addUserCountry = useAddUserCountry();
  const removeUserCountry = useRemoveUserCountry();
  const [searchQuery, setSearchQuery] = useState('');

  const isLoading = loadingUserCountries || loadingCountries;

  // Fade-in animation for content
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isLoading) {
      fadeAnim.setValue(0); // Reset so fade-in can replay on subsequent loads
      return;
    }

    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [isLoading, fadeAnim]);

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
    const totalCountries = countries?.length || 193; // 193 UN member states usually
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

    // Add visited countries as stamp rows (2 per row)
    for (let i = 0; i < displayItems.length; i += 2) {
      const rowItems = displayItems.slice(i, i + 2);
      const rowKey = rowItems.map((item) => item.code).join('-');
      items.push({ type: 'stamp-row', data: rowItems, key: `stamps-${rowKey}` });
    }

    // Add explore section only when there are unvisited countries to show
    if (unvisitedCountries.length > 0) {
      items.push({ type: 'section-header', title: 'Explore the World', key: 'header-explore' });
      // Group unvisited countries into rows of 2
      for (let i = 0; i < unvisitedCountries.length; i += 2) {
        const rowItems = unvisitedCountries.slice(i, i + 2);
        const rowKey = rowItems.map((item) => item.code).join('-');
        items.push({ type: 'unvisited-row', data: rowItems, key: `unvisited-${rowKey}` });
      }
    }

    return items;
  }, [displayItems, unvisitedCountries, searchQuery, visitedCountries.length]);

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
    (country: { code: string; name: string }) => {
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
      addUserCountry.mutate({ country_code: countryCode, status: 'visited' });
    },
    [addUserCountry]
  );

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

  const renderStampRow = useCallback(
    (stamps: CountryDisplayItem[]) => (
      <View style={styles.stampRow}>
        {stamps.map((item) => (
          <StampCard key={item.code} code={item.code} onPress={() => handleCountryPress(item)} />
        ))}
      </View>
    ),
    [handleCountryPress]
  );

  const renderUnvisitedRow = useCallback(
    (countries: UnvisitedCountry[]) => (
      <View style={styles.unvisitedRow}>
        {countries.map((country) => (
          <View key={country.code} style={styles.countryCardWrapper}>
            <CountryCard
              code={country.code}
              name={country.name}
              isVisited={false}
              isWishlisted={country.isWishlisted}
              onPress={() => handleUnvisitedCountryPress(country)}
              onAddVisited={() => handleAddVisited(country.code)}
              onToggleWishlist={() => handleToggleWishlist(country.code)}
            />
          </View>
        ))}
      </View>
    ),
    [handleUnvisitedCountryPress, handleAddVisited, handleToggleWishlist]
  );

  const renderItem = useCallback(
    ({ item, index }: { item: ListItem; index: number }) => {
      let content;
      switch (item.type) {
        case 'section-header':
          content = (
            <Text
              style={[
                styles.sectionTitle,
                (item.key === 'header-visited' || item.key === 'header-explore') &&
                  styles.scriptTitle,
              ]}
            >
              {item.title}
            </Text>
          );
          break;
        case 'stamp-row':
          content = renderStampRow(item.data);
          break;
        case 'unvisited-row':
          content = renderUnvisitedRow(item.data);
          break;
        case 'empty-state':
          content = (
            <View style={styles.emptyState}>
              <Text style={styles.emptyIcon}>🌍</Text>
              <Text style={styles.emptyTitle}>No countries yet</Text>
              <Text style={styles.emptySubtitle}>
                Create a trip to start building your passport!
              </Text>
            </View>
          );
          break;
        default:
          return null;
      }

      return <AnimatedListItem index={index}>{content}</AnimatedListItem>;
    },
    [renderStampRow, renderUnvisitedRow]
  );

  const getItemKey = useCallback((item: ListItem) => item.key, []);

  // ListHeader must be defined before any early returns to satisfy Rules of Hooks
  const ListHeader = useMemo(
    () => (
      <View>
        {/* App Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>BorderBadge</Text>
        </View>

        {/* Travel Status Card */}
        <View style={styles.statusCard}>
          <View style={styles.statusHeader}>
            {/* Square Icon Placeholder */}
            <View style={styles.statusIcon} />

            <View style={styles.statusContent}>
              <View style={styles.statusRow}>
                <Text style={styles.statusTitle}>{stats.travelStatus.toUpperCase()}</Text>
                <View style={styles.countContainer}>
                  <Text style={styles.countText}>
                    <Text style={styles.countCurrent}>{stats.stampedCount}</Text>
                    <Text style={styles.countTotal}>/{stats.totalCountries}</Text>
                  </Text>
                </View>
              </View>
              <View style={styles.statusLabelsRow}>
                <Text style={styles.statusLabel}>TRAVEL STATUS</Text>
                <Text style={styles.countriesLabel}>COUNTRIES</Text>
              </View>

              <View style={styles.progressBar}>
                <View style={[styles.progressFill, { width: `${stats.worldPercentage}%` }]} />
              </View>
            </View>
          </View>
        </View>

        {/* Stats Grid */}
        <View style={styles.statsGrid}>
          <StatBox
            value={stats.stampedCount}
            label="STAMPED"
            backgroundColor={colors.adobeBrick}
            textColor={colors.cloudWhite}
            labelColor="rgba(255,255,255,0.8)"
            index={0}
            show={!isLoading}
          />
          <StatBox
            value={stats.dreamsCount}
            label="DREAMS"
            backgroundColor={colors.lakeBlue} // Using Lake Blue for Dreams
            textColor={colors.midnightNavy}
            labelColor={colors.midnightNavy}
            index={1}
            show={!isLoading}
          />
          <StatBox
            value={stats.regionsCount}
            label="REGIONS"
            backgroundColor={colors.sunsetGold}
            textColor={colors.midnightNavy}
            labelColor={colors.midnightNavy}
            index={2}
            show={!isLoading}
          />
          <StatBox
            value={`${stats.worldPercentage}%`}
            label="WORLD"
            backgroundColor={colors.dustyCoral}
            textColor={colors.midnightNavy}
            labelColor={colors.midnightNavy}
            index={3}
            show={!isLoading}
          />
        </View>

        {/* Search & Filter Row with Liquid Glass */}
        <View style={styles.searchRow}>
          <View style={styles.searchGlassWrapper}>
            <BlurView intensity={60} tint="light" style={styles.searchGlassContainer}>
              <View style={styles.searchInputContainer}>
                <Ionicons
                  name="search"
                  size={18}
                  color={colors.stormGray}
                  style={styles.searchIcon}
                />
                <TextInput
                  style={styles.searchInput}
                  placeholder="Type Country"
                  placeholderTextColor={colors.stormGray}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  autoCapitalize="words"
                  autoCorrect={false}
                  returnKeyType="search"
                />
              </View>
            </BlurView>
          </View>
          <TouchableOpacity
            style={styles.exploreButton}
            onPress={() => setSearchQuery('')}
            activeOpacity={0.7}
          >
            <Text style={styles.exploreButtonText}>EXPLORE</Text>
          </TouchableOpacity>
        </View>
      </View>
    ),
    [stats, searchQuery, isLoading]
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
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.warmCream, // Matching background to screenshot
  },
  animatedContainer: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 24,
  },
  // Header
  header: {
    alignItems: 'center',
    paddingTop: 16,
    paddingBottom: 24,
  },
  headerTitle: {
    fontFamily: fonts.playfair.bold,
    fontSize: 28,
    color: colors.midnightNavy,
    textAlign: 'center',
  },
  // Travel Status Card
  statusCard: {
    marginTop: 0,
    marginHorizontal: 16,
    backgroundColor: colors.cloudWhite,
    borderRadius: 16,
    padding: 16,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  statusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusIcon: {
    width: 48,
    height: 48,
    backgroundColor: '#D9D9D9', // Placeholder grey from screenshot
    borderRadius: 4,
    marginRight: 12,
  },
  statusContent: {
    flex: 1,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 2,
  },
  statusLabelsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  statusTitle: {
    fontFamily: fonts.openSans.bold,
    fontSize: 18,
    color: colors.adobeBrick,
    letterSpacing: 0.5,
  },
  countContainer: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  countText: {
    fontFamily: fonts.openSans.bold,
  },
  countCurrent: {
    fontSize: 16,
    color: colors.adobeBrick,
  },
  countTotal: {
    fontSize: 14,
    color: colors.adobeBrick,
    opacity: 0.7,
  },
  statusLabel: {
    fontFamily: fonts.openSans.bold,
    fontSize: 11,
    color: colors.adobeBrick,
    opacity: 0.8,
  },
  countriesLabel: {
    fontFamily: fonts.openSans.bold,
    fontSize: 11,
    color: colors.adobeBrick,
    opacity: 0.8,
  },
  progressBar: {
    width: '100%',
    height: 8,
    backgroundColor: '#E0E0E0',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#64B5F6', // Blue from screenshot
    borderRadius: 4,
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
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  statValue: {
    fontFamily: fonts.openSans.bold,
    fontSize: 22,
    marginBottom: 4,
  },
  statLabel: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 10,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  // Search Row with Liquid Glass
  searchRow: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 20,
    gap: 16,
    alignItems: 'center',
  },
  searchGlassWrapper: {
    flex: 1,
    borderRadius: 24,
    overflow: 'hidden',
    shadowColor: colors.midnightNavy,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 4,
  },
  searchGlassContainer: {
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: 'rgba(255, 255, 255, 0.7)',
  },
  searchInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.9)',
    backgroundColor: 'rgba(253, 246, 237, 0.5)',
  },
  searchIcon: {
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.openSans.regular,
    fontSize: 16,
    color: colors.midnightNavy,
  },
  exploreButton: {
    paddingHorizontal: 4,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  exploreButtonText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 14,
    color: colors.mossGreen,
    letterSpacing: 0.5,
  },
  // Section Title
  sectionTitle: {
    fontFamily: fonts.playfair.bold,
    fontSize: 20,
    color: colors.midnightNavy,
    marginHorizontal: 16,
    marginTop: 24,
    marginBottom: 12,
  },
  scriptTitle: {
    fontFamily: fonts.dawning.regular,
    fontSize: 32,
    color: colors.adobeBrick,
    marginTop: 24,
    marginBottom: 8,
  },
  // Stamp Row (2-up grid)
  stampRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 12,
    marginBottom: 12,
  },
  // Unvisited Row (2-up grid)
  unvisitedRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 12,
    marginBottom: 12,
  },
  // Country Card Wrapper
  countryCardWrapper: {
    flex: 1,
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
