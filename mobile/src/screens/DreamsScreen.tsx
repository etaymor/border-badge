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
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CountryCard, ExploreFilterSheet, Snackbar } from '@components/ui';
import { colors } from '@constants/colors';
import { RECOGNITION_GROUPS } from '@constants/regions';
import { fonts } from '@constants/typography';
import { useCountries } from '@hooks/useCountries';
import { useAddUserCountry, useRemoveUserCountry, useUserCountries } from '@hooks/useUserCountries';
import type { DreamsStackScreenProps } from '@navigation/types';
import {
  DEFAULT_FILTERS,
  hasActiveFilters,
  countActiveFilters,
  type ExploreFilters,
} from '../types/filters';

// Animation timing constants
const HEART_PULSE_DELAY_MS = 150;
const CARD_EXIT_DURATION_MS = 250;
const CARD_EXIT_TRANSLATE_Y = -20;
const CARD_EXIT_SCALE = 0.95;

type Props = DreamsStackScreenProps<'DreamsHome'>;

interface DreamCountry {
  code: string;
  name: string;
  region: string;
  isWishlisted: boolean;
}

interface SnackbarState {
  visible: boolean;
  message: string;
  countryCode?: string;
}

export function DreamsScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { data: userCountries, isLoading: loadingUserCountries } = useUserCountries();
  const { data: countries, isLoading: loadingCountries } = useCountries();
  const addUserCountry = useAddUserCountry();
  const removeUserCountry = useRemoveUserCountry();
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState<ExploreFilters>(DEFAULT_FILTERS);
  const [filterSheetVisible, setFilterSheetVisible] = useState(false);

  // Track if component is mounted to prevent state updates after unmount
  const isMountedRef = useRef(true);
  // Track pending timeouts for cleanup
  const pendingTimeoutsRef = useRef<Set<NodeJS.Timeout>>(new Set());

  useEffect(() => {
    const timeouts = pendingTimeoutsRef.current;
    return () => {
      isMountedRef.current = false;
      // Clear all pending timeouts on unmount
      timeouts.forEach(clearTimeout);
      timeouts.clear();
    };
  }, []);

  // Animation state (per-card to prevent shared interference)
  const [animatingCards, setAnimatingCards] = useState<Set<string>>(new Set());
  const animationValuesRef = useRef(
    new Map<
      string,
      { scale: Animated.Value; opacity: Animated.Value; translateY: Animated.Value }
    >()
  );

  const getAnimationValues = useCallback((code: string) => {
    if (!animationValuesRef.current.has(code)) {
      animationValuesRef.current.set(code, {
        scale: new Animated.Value(1),
        opacity: new Animated.Value(1),
        translateY: new Animated.Value(0),
      });
    }
    return animationValuesRef.current.get(code)!;
  }, []);

  // Snackbar state
  const [snackbar, setSnackbar] = useState<SnackbarState>({ visible: false, message: '' });

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

  // Apply explore filters to countries (excluding status filter since Dreams doesn't use it)
  const filteredCountries = useMemo(() => {
    if (!searchableCountries.length) return [];

    let filtered = [...searchableCountries];

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
  }, [searchableCountries, filters]);

  // Compute sorted countries: dreams first, then alphabetical, excluding visited
  const sortedCountries = useMemo((): DreamCountry[] => {
    if (!filteredCountries.length) return [];

    const query = searchQuery.toLowerCase().trim();
    const wishlistCodes = new Set(wishlistCountries.map((uc) => uc.country_code));
    const visitedCodes = new Set(visitedCountries.map((uc) => uc.country_code));

    // Filter by search, exclude visited
    const filtered = filteredCountries
      .filter((c) => !visitedCodes.has(c.code))
      .filter((c) => !query || c.searchName.includes(query));

    // Partition into wishlisted and not
    const wishlisted = filtered
      .filter((c) => wishlistCodes.has(c.code))
      .sort((a, b) => a.name.localeCompare(b.name));

    const notWishlisted = filtered
      .filter((c) => !wishlistCodes.has(c.code))
      .sort((a, b) => a.name.localeCompare(b.name));

    // Dreams first, then rest alphabetically
    return [...wishlisted, ...notWishlisted].map((c) => ({
      code: c.code,
      name: c.name,
      region: c.region,
      isWishlisted: wishlistCodes.has(c.code),
    }));
  }, [filteredCountries, wishlistCountries, visitedCountries, searchQuery]);

  const handleCountryPress = useCallback(
    (country: DreamCountry) => {
      navigation.navigate('CountryDetail', {
        countryId: country.code,
        countryName: country.name,
        countryCode: country.code,
      });
    },
    [navigation]
  );

  const handleAddVisited = useCallback(
    (countryCode: string, countryName: string) => {
      addUserCountry.mutate(
        { country_code: countryCode, status: 'visited' },
        {
          onError: () => {
            if (!isMountedRef.current) return;
            setSnackbar({
              visible: true,
              message: `Failed to mark ${countryName} as visited`,
            });
          },
        }
      );
    },
    [addUserCountry]
  );

  const handleToggleWishlist = useCallback(
    (countryCode: string, countryName: string) => {
      const isCurrentlyWishlisted = wishlistCountries.some((uc) => uc.country_code === countryCode);

      if (isCurrentlyWishlisted) {
        // Removing from wishlist - no exit animation needed
        removeUserCountry.mutate(countryCode, {
          onError: () => {
            if (!isMountedRef.current) return;
            setSnackbar({
              visible: true,
              message: `Failed to remove ${countryName} from dreams`,
            });
          },
        });
      } else {
        // Prevent duplicate animation if already animating
        if (animatingCards.has(countryCode)) return;

        // Adding to wishlist - animate card exit then add
        const { scale, opacity, translateY } = getAnimationValues(countryCode);
        setAnimatingCards((prev) => {
          const next = new Set(prev);
          next.add(countryCode);
          return next;
        });

        // Short delay to let the heart pulse animation start first
        const timeoutId = setTimeout(() => {
          pendingTimeoutsRef.current.delete(timeoutId);
          Animated.parallel([
            Animated.timing(scale, {
              toValue: CARD_EXIT_SCALE,
              duration: CARD_EXIT_DURATION_MS,
              useNativeDriver: true,
            }),
            Animated.timing(opacity, {
              toValue: 0,
              duration: CARD_EXIT_DURATION_MS,
              useNativeDriver: true,
            }),
            Animated.timing(translateY, {
              toValue: CARD_EXIT_TRANSLATE_Y,
              duration: CARD_EXIT_DURATION_MS,
              useNativeDriver: true,
            }),
          ]).start(() => {
            // Check if still mounted before updating state
            if (!isMountedRef.current) return;

            // After animation completes, add to wishlist
            addUserCountry.mutate(
              { country_code: countryCode, status: 'wishlist' },
              {
                onError: () => {
                  if (!isMountedRef.current) return;
                  setSnackbar({
                    visible: true,
                    message: `Failed to add ${countryName} to dreams`,
                  });
                },
              }
            );

            // Reset animation values
            scale.setValue(1);
            opacity.setValue(1);
            translateY.setValue(0);
            setAnimatingCards((prev) => {
              const next = new Set(prev);
              next.delete(countryCode);
              return next;
            });
          });
        }, HEART_PULSE_DELAY_MS);
        pendingTimeoutsRef.current.add(timeoutId);

        // Show snackbar immediately
        setSnackbar({
          visible: true,
          message: `${countryName} added to your dreams`,
          countryCode,
        });
      }
    },
    [addUserCountry, removeUserCountry, wishlistCountries, getAnimationValues, animatingCards]
  );

  const renderItem = useCallback(
    ({ item }: { item: DreamCountry }) => {
      const { scale, opacity, translateY } = getAnimationValues(item.code);
      const isAnimating = animatingCards.has(item.code);

      return (
        <Animated.View
          style={[
            styles.countryCardWrapper,
            isAnimating && {
              transform: [{ scale }, { translateY }],
              opacity,
            },
          ]}
        >
          <CountryCard
            code={item.code}
            name={item.name}
            isVisited={false}
            isWishlisted={item.isWishlisted}
            onPress={() => handleCountryPress(item)}
            onAddVisited={() => handleAddVisited(item.code, item.name)}
            onToggleWishlist={() => handleToggleWishlist(item.code, item.name)}
          />
        </Animated.View>
      );
    },
    [handleCountryPress, handleAddVisited, handleToggleWishlist, animatingCards, getAnimationValues]
  );

  const getItemKey = useCallback((item: DreamCountry) => item.code, []);

  const handleExplorePress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setFilterSheetVisible(true);
  }, []);

  const handleCloseFilters = useCallback(() => {
    setFilterSheetVisible(false);
  }, []);

  const handleClearFilters = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setFilters(DEFAULT_FILTERS);
  }, []);

  const activeFilterCount = countActiveFilters(filters) - filters.status.length; // Exclude status from count
  const filtersActive = hasActiveFilters(filters) && activeFilterCount > 0;

  const ListHeader = useMemo(
    () => (
      <>
        {/* Lake Blue Header */}
        <View style={[styles.headerContainer, { paddingTop: insets.top + 16 }]}>
          <Text style={styles.headerTitle}>Your Dreams</Text>
        </View>
        {/* Search Row with Liquid Glass */}
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
                  autoCapitalize="none"
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
      </>
    ),
    [searchQuery, insets.top, filtersActive, activeFilterCount, handleExplorePress]
  );

  const ListEmpty = useMemo(
    () => (
      <View style={styles.emptyState}>
        <Text style={styles.emptyIcon}>✨</Text>
        <Text style={styles.emptyTitle}>
          {searchQuery ? 'No countries found' : 'Start dreaming!'}
        </Text>
        <Text style={styles.emptySubtitle}>
          {searchQuery
            ? 'Try a different search term'
            : 'Tap the heart on any country to add it to your dreams'}
        </Text>
      </View>
    ),
    [searchQuery]
  );

  const handleSnackbarUndo = useCallback(() => {
    if (snackbar.countryCode) {
      removeUserCountry.mutate(snackbar.countryCode);
    }
    setSnackbar({ visible: false, message: '' });
  }, [snackbar.countryCode, removeUserCountry]);

  const handleSnackbarDismiss = useCallback(() => {
    setSnackbar({ visible: false, message: '' });
  }, []);

  const isLoading = loadingUserCountries || loadingCountries;

  if (isLoading) {
    return (
      <View style={styles.container}>
        <View style={[styles.headerContainer, { paddingTop: insets.top + 16 }]}>
          <Text style={styles.headerTitle}>Your Dreams</Text>
        </View>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={sortedCountries}
        renderItem={renderItem}
        keyExtractor={getItemKey}
        numColumns={2}
        columnWrapperStyle={styles.columnWrapper}
        ListHeaderComponent={ListHeader}
        ListEmptyComponent={ListEmpty}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        removeClippedSubviews={true}
        maxToRenderPerBatch={10}
        windowSize={5}
        initialNumToRender={10}
      />
      <Snackbar
        visible={snackbar.visible}
        message={snackbar.message}
        actionLabel="Undo"
        onAction={handleSnackbarUndo}
        onDismiss={handleSnackbarDismiss}
        duration={3000}
      />
      <ExploreFilterSheet
        visible={filterSheetVisible}
        filters={filters}
        onFiltersChange={setFilters}
        onClose={handleCloseFilters}
        onClearAll={handleClearFilters}
        onApply={handleCloseFilters}
        showStatusSection={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.warmCream,
  },
  // Header
  headerContainer: {
    backgroundColor: colors.lakeBlue,
    paddingBottom: 24,
    alignItems: 'center',
  },
  headerTitle: {
    fontFamily: fonts.playfair.bold,
    fontSize: 28,
    color: colors.midnightNavy,
    fontStyle: 'italic',
    letterSpacing: -0.5,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.warmCream,
  },
  loadingText: {
    fontFamily: fonts.openSans.regular,
    fontSize: 16,
    color: colors.stormGray,
  },
  listContent: {
    paddingBottom: 100,
    flexGrow: 1,
  },
  columnWrapper: {
    gap: 12,
    marginBottom: 12,
    paddingHorizontal: 16,
  },
  // Search Row with Liquid Glass
  searchRow: {
    flexDirection: 'row',
    paddingTop: 16,
    paddingBottom: 16,
    paddingHorizontal: 16,
    gap: 16,
    alignItems: 'center',
    backgroundColor: colors.warmCream,
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
  // Country Card Wrapper
  countryCardWrapper: {
    flex: 1,
  },
  // Empty State
  emptyState: {
    flex: 1,
    paddingVertical: 80,
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  emptyIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
  emptyTitle: {
    fontFamily: fonts.playfair.bold,
    fontSize: 20,
    color: colors.midnightNavy,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontFamily: fonts.openSans.regular,
    fontSize: 16,
    color: colors.stormGray,
    textAlign: 'center',
    lineHeight: 24,
  },
});
