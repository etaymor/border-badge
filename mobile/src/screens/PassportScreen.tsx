import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  FlatList,
  Image,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import atlastLogo from '../../assets/atlasi-logo.png';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Analytics } from '@services/analytics';
import {
  OnboardingShareOverlay,
  ShareCardOverlay,
  type OnboardingShareContext,
} from '@components/share';
import {
  CountryCard,
  ExploreFilterSheet,
  GlassIconButton,
  PassportSkeleton,
  StampCard,
} from '@components/ui';
import { colors } from '@constants/colors';
import { CONTINENT_TOTALS, getCountryRarity } from '@constants/countryRarity';
import { ALL_REGIONS, RECOGNITION_GROUPS } from '@constants/regions';
import {
  isCountryAllowedByPreference,
  getCountryCountForPreference,
  getAllowedRecognitionGroupsForPreference,
} from '@constants/trackingPreferences';
import { fonts } from '@constants/typography';
import { useCountries } from '@hooks/useCountries';
import { useProfile } from '@hooks/useProfile';
import { useTrips } from '@hooks/useTrips';
import { useAddUserCountry, useRemoveUserCountry, useUserCountries } from '@hooks/useUserCountries';
import type { PassportStackScreenProps } from '@navigation/types';
import { buildMilestoneContext, type MilestoneContext } from '@utils/milestones';
import { getTravelStatus as getTravelTier } from '@utils/travelTier';
import {
  DEFAULT_FILTERS,
  hasActiveFilters,
  countActiveFilters,
  type ExploreFilters,
} from '../types/filters';

type Props = PassportStackScreenProps<'PassportHome'>;

interface CountryDisplayItem {
  code: string;
  name: string;
  region: string;
  status: 'visited' | 'wishlist';
  hasTrips: boolean;
}

interface UnvisitedCountry {
  code: string;
  name: string;
  region: string;
  isWishlisted: boolean;
  hasTrips: boolean;
}

type ListItem =
  | { type: 'section-header'; title: string; key: string }
  | { type: 'stamp-row'; data: CountryDisplayItem[]; key: string }
  | { type: 'unvisited-row'; data: UnvisitedCountry[]; key: string }
  | { type: 'empty-state'; key: string };

interface StatBoxProps {
  value: string | number;
  label: string;
  backgroundColor: string;
  textColor?: string;
  labelColor?: string;
  index: number;
  show: boolean;
}

// Animated row wrapper for scroll entrance animations
// Uses fast, subtle fade + slide for polish without causing gaps during fast scroll
interface AnimatedRowProps {
  children: React.ReactNode;
  style?: object;
}

function AnimatedRow({ children, style }: AnimatedRowProps) {
  const animValue = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.timing(animValue, {
      toValue: 1,
      duration: 200, // Fast enough to not cause gaps
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop(); // Cleanup on unmount
  }, []); // Only run on mount - animValue is stable ref

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: animValue,
          transform: [
            {
              translateY: animValue.interpolate({
                inputRange: [0, 1],
                outputRange: [12, 0], // Subtle slide up
              }),
            },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
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

// Calculate row heights dynamically based on screen width for accurate getItemLayout
const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Grid layout constants (must match styles)
const GRID_PADDING = 16;
const GRID_GAP = 12;
const ITEM_WIDTH = (SCREEN_WIDTH - GRID_PADDING * 2 - GRID_GAP) / 2;

// StampCard is square, CountryCard has 3:4 aspect ratio
const STAMP_HEIGHT = ITEM_WIDTH;
const COUNTRY_CARD_HEIGHT = ITEM_WIDTH * (4 / 3);

// Row heights including margins - must match actual rendered heights exactly
const ROW_HEIGHTS = {
  'section-header': 68, // fontSize 20-32 + marginTop 24 + marginBottom 8-12
  'stamp-row': Math.round(STAMP_HEIGHT) + 12, // stamp height + marginBottom
  'unvisited-row': Math.round(COUNTRY_CARD_HEIGHT) + 12, // card height + marginBottom
  'empty-state': 200,
} as const;

export function PassportScreen({ navigation }: Props) {
  const { data: userCountries, isLoading: loadingUserCountries } = useUserCountries();
  const { data: countries, isLoading: loadingCountries } = useCountries();
  const { data: trips, isLoading: loadingTrips } = useTrips();
  const { data: profile, isLoading: loadingProfile } = useProfile();
  const addUserCountry = useAddUserCountry();
  const removeUserCountry = useRemoveUserCountry();
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState<ExploreFilters>(DEFAULT_FILTERS);
  const [filterSheetVisible, setFilterSheetVisible] = useState(false);

  // Share card state (milestone share)
  const [shareCardVisible, setShareCardVisible] = useState(false);
  const [shareCardContext, setShareCardContext] = useState<MilestoneContext | null>(null);

  // Passport share overlay state
  const [passportShareVisible, setPassportShareVisible] = useState(false);

  // Get tracking preference from profile (default to full_atlas)
  const trackingPreference = profile?.tracking_preference ?? 'full_atlas';

  // Track passport view only when visited count changes.
  // Using a ref prevents duplicate tracking on re-renders when other
  // userCountries properties change (e.g., wishlist updates).
  const lastTrackedCountRef = useRef<number | null>(null);
  useEffect(() => {
    if (!loadingUserCountries && userCountries) {
      const visitedCount = userCountries.filter((uc) => uc.status === 'visited').length;
      if (lastTrackedCountRef.current !== visitedCount) {
        lastTrackedCountRef.current = visitedCount;
        Analytics.viewPassport(visitedCount);
      }
    }
  }, [loadingUserCountries, userCountries]);

  // Sync recognitionGroups filter when tracking preference changes
  // Remove any recognition groups that are no longer valid for the new preference
  useEffect(() => {
    if (filters.recognitionGroups.length === 0) return;

    const allowedGroups = getAllowedRecognitionGroupsForPreference(trackingPreference);
    const validGroups = filters.recognitionGroups.filter((group) => allowedGroups.has(group));

    // Only update if some groups were removed
    if (validGroups.length !== filters.recognitionGroups.length) {
      setFilters((prev) => ({
        ...prev,
        recognitionGroups: validGroups,
      }));
    }
  }, [trackingPreference, filters.recognitionGroups]);

  const isLoading = loadingUserCountries || loadingCountries || loadingTrips || loadingProfile;

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

  // Pre-compute visited, wishlist, and trip code sets for efficient filtering
  const { visitedCodes, wishlistCodes, countriesWithTrips } = useMemo(() => {
    return {
      visitedCodes: new Set(visitedCountries.map((uc) => uc.country_code)),
      wishlistCodes: new Set(wishlistCountries.map((uc) => uc.country_code)),
      countriesWithTrips: new Set(trips?.map((t) => t.country_code) ?? []),
    };
  }, [visitedCountries, wishlistCountries, trips]);

  // Pre-compute searchable country data filtered by tracking preference
  // This is the master list that respects the user's tracking preference
  const searchableCountries = useMemo(() => {
    if (!countries) return [];
    return countries
      .filter((c) => isCountryAllowedByPreference(c.recognition, trackingPreference))
      .map((c) => ({
        ...c,
        searchName: c.name.toLowerCase(),
      }));
  }, [countries, trackingPreference]);

  // Apply explore filters to countries
  const filteredCountries = useMemo(() => {
    if (!searchableCountries.length) return [];

    let filtered = [...searchableCountries];

    // Apply status filter (OR within category)
    if (filters.status.length > 0) {
      filtered = filtered.filter((country) => {
        const isVisited = visitedCodes.has(country.code);
        const isWishlisted = wishlistCodes.has(country.code);
        const isNotVisited = !isVisited && !isWishlisted;
        const hasTrips = countriesWithTrips.has(country.code);

        return (
          (filters.status.includes('visited') && isVisited) ||
          (filters.status.includes('dream') && isWishlisted) ||
          (filters.status.includes('not_visited') && isNotVisited) ||
          (filters.status.includes('has_trips') && hasTrips)
        );
      });
    }

    // Apply continent filter (OR within category)
    if (filters.continents.length > 0) {
      filtered = filtered.filter((country) => filters.continents.includes(country.region));
    }

    // Apply subregion filter (OR within category)
    if (filters.subregions.length > 0) {
      filtered = filtered.filter(
        (country) => country.subregion && filters.subregions.includes(country.subregion)
      );
    }

    // Apply recognition filter (OR within category)
    if (filters.recognitionGroups.length > 0) {
      const allowedRecognitions = filters.recognitionGroups.flatMap(
        (group) => RECOGNITION_GROUPS[group]
      );
      filtered = filtered.filter(
        (country) =>
          country.recognition &&
          allowedRecognitions.includes(country.recognition as (typeof allowedRecognitions)[number])
      );
    }

    return filtered;
  }, [searchableCountries, filters, visitedCodes, wishlistCodes, countriesWithTrips]);

  // Combine visited countries with country metadata for display (filtered by search and explore filters)
  const displayItems = useMemo((): CountryDisplayItem[] => {
    if (!visitedCountries.length || !filteredCountries.length) return [];

    const query = searchQuery.toLowerCase().trim();

    return filteredCountries
      .filter((c) => visitedCodes.has(c.code)) // O(1) Set lookup instead of O(n) array includes
      .filter((c) => !query || c.searchName.includes(query))
      .map((c) => ({
        code: c.code,
        name: c.name,
        region: c.region,
        status: 'visited' as const,
        hasTrips: countriesWithTrips.has(c.code),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [visitedCountries, filteredCountries, searchQuery, countriesWithTrips, visitedCodes]);

  // Compute all stats (filtered by tracking preference)
  const stats = useMemo(() => {
    // Filter visited/wishlist to only include countries allowed by tracking preference
    const allowedVisitedCountries = visitedCountries.filter((uc) => {
      const country = countries?.find((c) => c.code === uc.country_code);
      return country && isCountryAllowedByPreference(country.recognition, trackingPreference);
    });
    const allowedWishlistCountries = wishlistCountries.filter((uc) => {
      const country = countries?.find((c) => c.code === uc.country_code);
      return country && isCountryAllowedByPreference(country.recognition, trackingPreference);
    });

    const stampedCount = allowedVisitedCountries.length;
    const dreamsCount = allowedWishlistCountries.length;
    const totalCountries = getCountryCountForPreference(trackingPreference);
    const worldPercentage =
      totalCountries > 0 ? Math.round((stampedCount / totalCountries) * 100) : 0;

    // Calculate unique regions visited (from allowed countries only)
    const visitedCodesSet = new Set(allowedVisitedCountries.map((uc) => uc.country_code));
    const visitedCountryDetails = countries?.filter((c) => visitedCodesSet.has(c.code)) || [];
    const uniqueRegions = new Set(visitedCountryDetails.map((c) => c.region));
    const regionsCount = uniqueRegions.size;

    const travelStatus = getTravelTier(stampedCount).status;

    return {
      stampedCount,
      dreamsCount,
      totalCountries,
      worldPercentage,
      regionsCount,
      travelStatus,
    };
  }, [visitedCountries, wishlistCountries, countries, trackingPreference]);

  // Build share context for passport share overlay
  const passportShareContext: OnboardingShareContext | null = useMemo(() => {
    if (!countries?.length || !visitedCountries?.length) return null;

    // Use the pre-computed visitedCodes Set for O(1) lookups
    const visitedCodesArray = visitedCountries.map((uc) => uc.country_code);
    const visitedCountryData = countries.filter((c) => visitedCodes.has(c.code)); // O(1) Set lookup

    // Calculate unique regions and subregions
    const regions = [...new Set(visitedCountryData.map((c) => c.region))];
    const subregions = [
      ...new Set(visitedCountryData.map((c) => c.subregion).filter(Boolean)),
    ] as string[];

    // Calculate continent stats for share cards
    const continentStats = ALL_REGIONS.map((region) => {
      const visitedInRegion = visitedCountryData.filter((c) => c.region === region);

      // Find rarest visited country (highest rarity score)
      let rarestCountryCode: string | null = null;
      if (visitedInRegion.length > 0) {
        const rarest = visitedInRegion.reduce((best, c) =>
          getCountryRarity(c.code) > getCountryRarity(best.code) ? c : best
        );
        rarestCountryCode = rarest.code;
      }

      return {
        name: region,
        visitedCount: visitedInRegion.length,
        totalCount: CONTINENT_TOTALS[region] || 0,
        rarestCountryCode,
      };
    });

    return {
      visitedCountries: visitedCodesArray,
      totalCountries: visitedCodesArray.length,
      regions,
      regionCount: regions.length,
      subregions,
      subregionCount: subregions.length,
      travelTier: getTravelTier(visitedCodesArray.length),
      continentStats,
      motivationTags: profile?.travel_motives ?? [],
      personaTags: profile?.persona_tags ?? [],
    };
  }, [countries, visitedCountries, visitedCodes, profile]);

  // Compute unvisited countries for the Explore section (filtered by search and explore filters)
  const unvisitedCountries = useMemo((): UnvisitedCountry[] => {
    if (!filteredCountries.length) return [];

    const query = searchQuery.toLowerCase().trim();

    return filteredCountries
      .filter((c) => !visitedCodes.has(c.code))
      .filter((c) => !query || c.searchName.includes(query))
      .map((c) => ({
        code: c.code,
        name: c.name,
        region: c.region,
        isWishlisted: wishlistCodes.has(c.code),
        hasTrips: countriesWithTrips.has(c.code),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [filteredCountries, visitedCodes, wishlistCodes, countriesWithTrips, searchQuery]);

  // Flatten data into single array with section markers for FlatList virtualization
  const flatListData = useMemo((): ListItem[] => {
    const items: ListItem[] = [];

    // Add visited section header (only if there are visited countries or no search)
    if (displayItems.length > 0 || !searchQuery) {
      items.push({ type: 'section-header', title: "Where you've been", key: 'header-visited' });
    }

    // Add empty state if no visited countries (within tracking preference) and no search
    if (!searchQuery && displayItems.length === 0 && stats.stampedCount === 0) {
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
  }, [displayItems, unvisitedCountries, searchQuery, stats.stampedCount]);

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

      // Calculate milestone context BEFORE mutation
      const context = buildMilestoneContext(countryCode, countries ?? [], userCountries ?? []);

      // Fire mutation with onSuccess callback to show share card only on success
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
  }, []);

  const handleProfilePress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    navigation.navigate('ProfileSettings');
  }, [navigation]);

  const handleCloseFilters = useCallback(() => {
    setFilterSheetVisible(false);
  }, []);

  const handleClearFilters = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setFilters(DEFAULT_FILTERS);
  }, []);

  const activeFilterCount = countActiveFilters(filters);
  const filtersActive = hasActiveFilters(filters);

  const renderStampRow = useCallback(
    (stamps: CountryDisplayItem[]) => (
      <AnimatedRow style={styles.stampRow}>
        {stamps.map((item) => (
          <StampCard
            key={item.code}
            code={item.code}
            hasTrips={item.hasTrips}
            onPress={() => handleCountryPress(item)}
          />
        ))}
      </AnimatedRow>
    ),
    [handleCountryPress]
  );

  const renderUnvisitedRow = useCallback(
    (countries: UnvisitedCountry[]) => (
      <AnimatedRow style={styles.unvisitedRow}>
        {countries.map((country) => (
          <View key={country.code} style={styles.countryCardWrapper}>
            <CountryCard
              code={country.code}
              name={country.name}
              isVisited={false}
              isWishlisted={country.isWishlisted}
              hasTrips={country.hasTrips}
              onPress={() => handleUnvisitedCountryPress(country)}
              onAddVisited={() => handleAddVisited(country.code)}
              onToggleWishlist={() => handleToggleWishlist(country.code)}
            />
          </View>
        ))}
      </AnimatedRow>
    ),
    [handleUnvisitedCountryPress, handleAddVisited, handleToggleWishlist]
  );

  const renderItem = useCallback(
    ({ item }: { item: ListItem }) => {
      switch (item.type) {
        case 'section-header':
          // Add share button for "Where you've been" section
          if (item.key === 'header-visited' && passportShareContext) {
            return (
              <View style={styles.sectionHeaderRow}>
                <Text style={[styles.sectionTitle, styles.scriptTitle]}>{item.title}</Text>
                <TouchableOpacity
                  onPress={handlePassportShare}
                  style={styles.sectionShareButton}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityLabel="Share your passport"
                >
                  <Ionicons name="share-outline" size={22} color={colors.adobeBrick} />
                </TouchableOpacity>
              </View>
            );
          }
          return (
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
        case 'stamp-row':
          return renderStampRow(item.data);
        case 'unvisited-row':
          return renderUnvisitedRow(item.data);
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
    [renderStampRow, renderUnvisitedRow, passportShareContext, handlePassportShare]
  );

  // Precompute layout data for O(1) getItemLayout lookups
  const layoutData = useMemo(() => {
    const offsets: number[] = [];
    const lengths: number[] = [];
    let cumulativeOffset = 0;

    for (const item of flatListData) {
      offsets.push(cumulativeOffset);
      const length = ROW_HEIGHTS[item.type];
      lengths.push(length);
      cumulativeOffset += length;
    }

    return { offsets, lengths };
  }, [flatListData]);

  // Optimized layout calculation for instant scroll positioning - O(1) lookup
  const getItemLayout = useCallback(
    (_: ArrayLike<ListItem> | null | undefined, index: number) => {
      const length = layoutData.lengths[index] ?? 0;
      const offset = layoutData.offsets[index] ?? 0;
      return { length, offset, index };
    },
    [layoutData]
  );

  const getItemKey = useCallback((item: ListItem) => item.key, []);

  // ListHeader must be defined before any early returns to satisfy Rules of Hooks
  const ListHeader = useMemo(
    () => (
      <View>
        {/* App Header */}
        <View style={styles.header}>
          <View style={styles.headerSpacer} />
          <Image source={atlastLogo} style={styles.headerLogo} resizeMode="contain" />
          <GlassIconButton
            icon="settings-outline"
            onPress={handleProfilePress}
            accessibilityLabel="Open profile settings"
            testID="profile-settings-button"
          />
        </View>

        {/* Travel Status Card */}
        <View style={styles.statusCard}>
          <View style={styles.statusHeader}>
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
            style={[styles.exploreButton, filtersActive && styles.exploreButtonActive]}
            onPress={handleExplorePress}
            activeOpacity={0.7}
          >
            <Text
              style={[styles.exploreButtonText, filtersActive && styles.exploreButtonTextActive]}
            >
              {filtersActive ? `FILTERS (${activeFilterCount})` : 'EXPLORE'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    ),
    [
      stats,
      searchQuery,
      isLoading,
      filtersActive,
      activeFilterCount,
      handleExplorePress,
      handleProfilePress,
    ]
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 24,
  },
  headerSpacer: {
    width: 44, // Match GlassIconButton width for centering
  },
  headerLogo: {
    width: 140,
    height: 40,
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
    paddingHorizontal: 16,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 20,
  },
  exploreButtonActive: {
    backgroundColor: colors.mossGreen,
  },
  exploreButtonText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 14,
    color: colors.mossGreen,
    letterSpacing: 0.5,
  },
  exploreButtonTextActive: {
    color: colors.cloudWhite,
  },
  // Section Title
  sectionTitle: {
    fontFamily: fonts.playfair.bold,
    fontSize: 20,
    color: colors.midnightNavy,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 12,
  },
  scriptTitle: {
    fontFamily: fonts.dawning.regular,
    fontSize: 32,
    color: colors.adobeBrick,
    marginTop: 12,
    marginBottom: 8,
  },
  // Section header row with share button
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
  },
  sectionShareButton: {
    padding: 8,
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
