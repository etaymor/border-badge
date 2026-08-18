import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { SafeAreaView } from 'react-native-safe-area-context';

import { NotificationBell, SegmentedTabs, TripCard } from '@components/ui';
import { features } from '@config/features';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { useCountries } from '@hooks/useCountries';
import { usePhotoTrips } from '@hooks/usePhotoTrips';
import { useScreenEntrance } from '@hooks/useScreenEntrance';
import { useStableCallback } from '@hooks/useStableCallback';
import { usePendingTripTagCount } from '@hooks/useTripTags';
import { TripWithTags, useTrips, useUncategorizedTrip } from '@hooks/useTrips';
import { useUserCountries } from '@hooks/useUserCountries';
import { getFlagEmoji } from '@utils/flags';
import type { TripsStackScreenProps } from '@navigation/types';
import { useAuthStore } from '@stores/authStore';

import { PhotoTripsCallout } from '../lists/components/PhotoTripsCallout';

/* eslint-disable @typescript-eslint/no-require-imports */
const backpackIllustration = require('../../../assets/illustations/backpack-illustration-compressed.png');
/* eslint-enable @typescript-eslint/no-require-imports */

type Props = TripsStackScreenProps<'TripsList'>;

interface TripSection {
  title: string;
  data: TripWithTags[];
}

type TripsListRenderable =
  | { type: 'header'; title: string; key: string }
  | { type: 'trip'; trip: TripWithTags; key: string };

const SectionHeader = memo(function SectionHeader({ title }: { title: string }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionHeaderText}>{title}</Text>
      <View style={styles.sectionHeaderLine} />
    </View>
  );
});

interface EmptyStateProps {
  variant: 'my' | 'tagged';
  onAddTrip: () => void;
}

function EmptyState({ variant, onAddTrip }: EmptyStateProps) {
  if (variant === 'tagged') {
    return (
      <View style={styles.emptyContainer}>
        <View style={styles.emptyIconCircle}>
          <Text style={styles.emptyIcon}>👥</Text>
        </View>
        <Text style={styles.emptyTitle}>No Tagged Trips</Text>
        <Text style={styles.emptySubtitle}>
          When friends tag you on their adventures, they&apos;ll appear here.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.emptyContainer}>
      <Image source={backpackIllustration} style={styles.emptyIllustration} resizeMode="contain" />
      <Text style={styles.emptyTitle}>The World Awaits</Text>
      <Text style={styles.emptySubtitle}>
        Your passport is ready. Add your first trip to start your collection of memories.
      </Text>
      <Pressable style={styles.emptyButton} onPress={onAddTrip} testID="empty-add-trip-button">
        <Ionicons name="add" size={20} color={colors.midnightNavy} />
        <Text style={styles.emptyButtonText}>Plan a New Adventure</Text>
      </Pressable>
    </View>
  );
}

// Saved Places Header Badge Component
function SavedPlacesBadge({ entryCount, onPress }: { entryCount: number; onPress: () => void }) {
  if (entryCount === 0) return null;

  return (
    <Pressable
      style={styles.savedPlacesBadge}
      onPress={onPress}
      hitSlop={8}
      accessibilityLabel={`${entryCount} saved places to organize`}
    >
      <Ionicons name="bookmark" size={22} color={colors.stormGray} />
      <View style={styles.badgeCount}>
        <Text style={styles.badgeCountText}>{entryCount > 99 ? '99+' : entryCount}</Text>
      </View>
    </Pressable>
  );
}

export function TripsListScreen({ navigation }: Props) {
  const currentUserId = useAuthStore((state) => state.session?.user.id);
  const { data: trips, isLoading, isRefetching, refetch, error } = useTrips();
  const { data: countries } = useCountries();
  const { data: userCountries } = useUserCountries();
  const { data: pendingTagCount } = usePendingTripTagCount();
  const { data: uncategorizedTrip } = useUncategorizedTrip();
  const {
    trips: photoTrips,
    previewUris,
    hasInitialImport,
    isLoading: isPhotoTripsLoading,
  } = usePhotoTrips();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTab, setSelectedTab] = useState<'my' | 'tagged'>('my');

  const handleNotificationsPress = useCallback(() => {
    navigation.navigate('PendingTripTags');
  }, [navigation]);

  // Staggered entrance animations for premium feel
  // 0: Title, 1: Search bar, 2: Photo callout, 3: FAB
  const { getAnimatedStyle, getButtonStyle } = useScreenEntrance({ elementCount: 4 });

  // Create a set of visited country codes for quick lookup
  const visitedCountryCodes = useMemo(() => {
    if (!userCountries) return new Set<string>();
    return new Set(
      userCountries.filter((uc) => uc.status === 'visited').map((uc) => uc.country_code)
    );
  }, [userCountries]);

  // Create a Map for O(1) country lookup by code
  const countriesMap = useMemo(() => {
    if (!countries) return new Map<string, (typeof countries)[0]>();
    return new Map(countries.map((c) => [c.code, c]));
  }, [countries]);

  // Filter trips by ownership based on selected tab
  const tripsForTab = useMemo(() => {
    if (!trips?.length) return [];

    if (selectedTab === 'my') {
      return trips.filter((trip) => trip.user_id === currentUserId);
    } else {
      return trips.filter((trip) => trip.user_id !== currentUserId);
    }
  }, [trips, selectedTab, currentUserId]);

  // Separate trips into sections based on whether the country has been visited
  const sections = useMemo((): TripSection[] => {
    if (!tripsForTab?.length) return [];

    const query = searchQuery.toLowerCase().trim();
    const filteredTrips = tripsForTab.filter((trip) => {
      if (!query) return true;
      const country = trip.country_code ? countriesMap.get(trip.country_code) : undefined; // O(1) Map lookup instead of O(n) find
      const countryName = country?.name.toLowerCase() || '';
      return trip.name.toLowerCase().includes(query) || countryName.includes(query);
    });

    if (filteredTrips.length === 0) return [];

    const visitedTrips: TripWithTags[] = [];
    const plannedTrips: TripWithTags[] = [];

    filteredTrips.forEach((trip) => {
      if (trip.country_code && visitedCountryCodes.has(trip.country_code)) {
        visitedTrips.push(trip);
      } else {
        plannedTrips.push(trip);
      }
    });

    const result: TripSection[] = [];
    if (visitedTrips.length > 0) {
      result.push({ title: 'My Adventures', data: visitedTrips });
    }
    if (plannedTrips.length > 0) {
      result.push({ title: 'Upcoming Plans', data: plannedTrips });
    }
    return result;
  }, [tripsForTab, visitedCountryCodes, searchQuery, countriesMap]);

  const flatData = useMemo<TripsListRenderable[]>(() => {
    if (!sections.length) return [];

    const rows: TripsListRenderable[] = [];
    sections.forEach((section) => {
      rows.push({ type: 'header', title: section.title, key: `header-${section.title}` });
      section.data.forEach((trip) => {
        rows.push({ type: 'trip', trip, key: `trip-${trip.id}` });
      });
    });
    return rows;
  }, [sections]);

  const hasTrips = sections.reduce((sum, s) => sum + s.data.length, 0) > 0;

  const handleAddTrip = useCallback(() => {
    navigation.navigate('TripForm', {});
  }, [navigation]);

  const handleSavedPlacesPress = useCallback(() => {
    navigation.navigate('SavedPlaces');
  }, [navigation]);

  const handleViewPhotoTrips = useCallback(() => {
    navigation.navigate('PhotoTrips', {});
  }, [navigation]);

  const handleTripPress = useCallback(
    (tripId: string) => {
      navigation.navigate('TripDetail', { tripId });
    },
    [navigation]
  );

  // Identity-stable wrapper that always dispatches to the latest handler, so the
  // per-id callbacks below can be created once and cached.
  const stableTripPress = useStableCallback(handleTripPress);

  // Per-id, stable onPress callbacks so TripCard's React.memo holds across
  // parent re-renders instead of being defeated by a fresh inline closure.
  const tripPressCallbacksRef = useRef<Map<string, () => void>>(new Map());
  const getTripPressHandler = useCallback(
    (tripId: string) => {
      const existing = tripPressCallbacksRef.current.get(tripId);
      if (existing) return existing;
      const handler = () => stableTripPress(tripId);
      tripPressCallbacksRef.current.set(tripId, handler);
      return handler;
    },
    [stableTripPress]
  );

  const renderFlatItem = useCallback(
    ({ item }: { item: TripsListRenderable }) => {
      if (item.type === 'header') {
        return <SectionHeader title={item.title} />;
      }

      const flagEmoji = item.trip.country_code ? getFlagEmoji(item.trip.country_code) : '';
      return (
        <View style={styles.tripCardWrapper}>
          <TripCard
            trip={item.trip}
            flagEmoji={flagEmoji}
            onPress={getTripPressHandler(item.trip.id)}
            tags={item.trip.tags}
            owner={item.trip.owner}
            currentUserId={currentUserId}
          />
        </View>
      );
    },
    [getTripPressHandler, currentUserId]
  );

  const handleTabSelect = useCallback((index: number) => {
    setSelectedTab(index === 0 ? 'my' : 'tagged');
  }, []);

  const renderHeader = useMemo(
    () => (
      <>
        {/* Header Title with Notification Bell + Saved Places Badge - animates first */}
        <Animated.View style={[styles.headerContainer, getAnimatedStyle(0)]}>
          <View style={styles.headerRow}>
            <View style={styles.headerSpacer} />
            <Text style={styles.headerTitle}>My Trips</Text>
            <View style={styles.headerRight}>
              {features.enableSocial && (
                <NotificationBell count={pendingTagCount ?? 0} onPress={handleNotificationsPress} />
              )}
            </View>
          </View>
          <SavedPlacesBadge
            entryCount={uncategorizedTrip?.entry_count ?? 0}
            onPress={handleSavedPlacesPress}
          />
        </Animated.View>

        {/* Tab Selector - Tagged trips are a social feature */}
        {features.enableSocial && (
          <SegmentedTabs
            tabs={['My Trips', 'Tagged']}
            selectedIndex={selectedTab === 'my' ? 0 : 1}
            onSelect={handleTabSelect}
            testID="trip-tabs"
          />
        )}

        {/* Search Bar with Liquid Glass - animates second */}
        <Animated.View style={[styles.searchRow, getAnimatedStyle(1)]}>
          <View style={styles.searchGlassWrapper}>
            <BlurView intensity={80} tint="light" style={styles.searchGlassContainer}>
              <View style={styles.searchInputContainer}>
                <Ionicons
                  name="search"
                  size={18}
                  color={colors.stormGray}
                  style={styles.searchIcon}
                />
                <TextInput
                  style={styles.searchInput}
                  placeholder="Find a trip or country..."
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
        </Animated.View>

        {/* Photo Trips Callout - animates third */}
        <Animated.View style={[styles.photoTripsContainer, getAnimatedStyle(2)]}>
          <PhotoTripsCallout
            tripCount={photoTrips.length}
            previewUris={previewUris}
            hasInitialImport={hasInitialImport}
            onPress={handleViewPhotoTrips}
            isLoading={isPhotoTripsLoading}
          />
        </Animated.View>
      </>
    ),
    [
      searchQuery,
      pendingTagCount,
      handleNotificationsPress,
      selectedTab,
      handleTabSelect,
      uncategorizedTrip?.entry_count,
      handleSavedPlacesPress,
      photoTrips.length,
      previewUris,
      hasInitialImport,
      handleViewPhotoTrips,
      isPhotoTripsLoading,
      getAnimatedStyle,
    ]
  );

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.sunsetGold} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Ionicons name="alert-circle-outline" size={48} color={colors.adobeBrick} />
        <Text style={styles.errorText}>Failed to load trips</Text>
        <Pressable style={styles.retryButton} onPress={() => refetch()}>
          <Text style={styles.retryButtonText}>Try Again</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <FlashList
        data={flatData}
        keyExtractor={(item) => item.key}
        renderItem={renderFlatItem}
        ListHeaderComponent={renderHeader}
        contentContainerStyle={[styles.listContent, !hasTrips && styles.listContentEmpty]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor={colors.sunsetGold}
          />
        }
        ListEmptyComponent={
          !isLoading && flatData.length === 0 ? (
            <EmptyState variant={selectedTab} onAddTrip={handleAddTrip} />
          ) : null
        }
      />

      {/* FAB for adding new trip - only when user has trips */}
      {hasTrips && (
        <Animated.View style={[styles.fabContainer, getButtonStyle(3)]}>
          <Pressable style={styles.fab} onPress={handleAddTrip} testID="fab-add-trip">
            <Ionicons name="add" size={28} color={colors.midnightNavy} />
          </Pressable>
        </Animated.View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.warmCream,
  },
  headerContainer: {
    paddingTop: 16,
    paddingBottom: 16,
    paddingHorizontal: 16,
    position: 'relative',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerSpacer: {
    width: 40,
  },
  headerRight: {
    width: 40,
    alignItems: 'flex-end',
  },
  headerTitle: {
    fontFamily: fonts.playfair.bold,
    fontSize: 28,
    color: colors.midnightNavy,
    fontStyle: 'italic',
    letterSpacing: -0.5,
  },
  savedPlacesBadge: {
    position: 'absolute',
    // Sits left of the NotificationBell (which occupies the headerRight slot)
    right: 60,
    top: 16,
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeCount: {
    position: 'absolute',
    top: 0,
    right: 0,
    minWidth: 18,
    height: 18,
    backgroundColor: colors.adobeBrick,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  badgeCountText: {
    fontFamily: fonts.openSans.bold,
    fontSize: 11,
    color: '#fff',
  },
  searchRow: {
    paddingTop: 8,
    paddingBottom: 8,
    paddingHorizontal: 16,
  },
  searchGlassWrapper: {
    borderRadius: 24,
    overflow: 'hidden',
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  searchGlassContainer: {
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: 'rgba(255, 255, 255, 0.6)',
  },
  searchInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    height: 52,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.8)',
    backgroundColor: 'rgba(253, 246, 237, 0.3)',
  },
  searchIcon: {
    marginRight: 10,
    opacity: 0.7,
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.openSans.regular,
    fontSize: 16,
    color: colors.midnightNavy,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.warmCream,
    padding: 24,
  },
  errorText: {
    fontSize: 16,
    color: colors.textSecondary,
    marginTop: 12,
    marginBottom: 24,
    fontFamily: fonts.openSans.regular,
  },
  retryButton: {
    backgroundColor: colors.sunsetGold,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  retryButtonText: {
    color: colors.midnightNavy,
    fontSize: 16,
    fontFamily: fonts.openSans.semiBold,
  },
  listContent: {
    paddingBottom: 130, // Space for FAB + Tab Bar
  },
  listContentEmpty: {
    paddingBottom: 80, // No FAB when empty; space for Tab Bar
  },
  tripCardWrapper: {
    marginBottom: 24, // Space for shadow to render below card
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
  },
  sectionHeaderText: {
    fontFamily: fonts.dawning.regular,
    fontSize: 34,
    color: colors.adobeBrick,
    marginRight: 12,
    transform: [{ rotate: '-1deg' }], // Slight whimsical tilt
  },
  sectionHeaderLine: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(193, 84, 62, 0.2)', // Faint Adobe Brick line
    borderRadius: 1,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'flex-start',
    alignItems: 'center',
    padding: 32,
    paddingTop: 24,
    marginTop: 0,
  },
  emptyIllustration: {
    width: 120,
    height: 120,
    marginBottom: 24,
  },
  emptyIconCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(244, 194, 78, 0.1)', // Light Sunset Gold
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
    borderWidth: 1,
    borderColor: 'rgba(244, 194, 78, 0.3)',
    borderStyle: 'dashed',
  },
  emptyIcon: {
    fontSize: 48,
  },
  emptyTitle: {
    fontSize: 24,
    fontFamily: fonts.playfair.bold,
    color: colors.midnightNavy,
    marginBottom: 12,
  },
  emptySubtitle: {
    fontSize: 16,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 24,
    fontFamily: fonts.openSans.regular,
    maxWidth: 280,
  },
  emptyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.sunsetGold,
    paddingHorizontal: 28,
    paddingVertical: 16,
    borderRadius: 12,
    gap: 8,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  emptyButtonText: {
    color: colors.midnightNavy,
    fontSize: 16,
    fontFamily: fonts.openSans.semiBold,
  },
  fabContainer: {
    position: 'absolute',
    right: 20,
    bottom: 120,
  },
  fab: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.sunsetGold,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 8,
  },
  photoTripsContainer: {
    paddingHorizontal: 16,
  },
});
