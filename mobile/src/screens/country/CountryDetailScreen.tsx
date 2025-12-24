import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Animated, Dimensions, StatusBar, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';

import { Button, GlassBackButton, TripCard } from '@components/ui';
import {
  CountryHero,
  CountryActionBar,
  CountryStats,
  CountryEmptyState,
  TripsSectionHeader,
} from '@components/country';
import { ShareCardOverlay } from '@components/share/ShareCardOverlay';
import { useCountries, useCountryByCode } from '@hooks/useCountries';
import { useTripsByCountry, Trip } from '@hooks/useTrips';
import { useUserCountries, useAddUserCountry, useRemoveUserCountry } from '@hooks/useUserCountries';
import type { PassportStackScreenProps } from '@navigation/types';
import { colors } from '@constants/colors';
import { getFlagEmoji } from '@utils/flags';
import { detectMilestones, type MilestoneContext } from '@utils/milestones';
import { getCountryImage } from '../../assets/countryImages';

type Props = PassportStackScreenProps<'CountryDetail'>;

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const HERO_HEIGHT = SCREEN_HEIGHT * 0.55;
const HEADER_MAX_HEIGHT = HERO_HEIGHT;
const HEADER_MIN_HEIGHT = 100;
const HEADER_SCROLL_DISTANCE = HEADER_MAX_HEIGHT - HEADER_MIN_HEIGHT;

export function CountryDetailScreen({ navigation, route }: Props) {
  const { countryId, countryName, countryCode } = route.params;
  const insets = useSafeAreaInsets();

  // Animation Values
  const scrollY = useRef(new Animated.Value(0)).current;

  // Share overlay state
  const [showShareOverlay, setShowShareOverlay] = useState(false);
  const [shareContext, setShareContext] = useState<MilestoneContext | null>(null);

  // Data Hooks
  const code = countryCode || countryId;
  const { data: country } = useCountryByCode(code);
  const { data: allCountries } = useCountries();
  const { data: trips, isLoading: loadingTrips, refetch } = useTripsByCountry(countryId);
  const { data: userCountries } = useUserCountries();
  const addUserCountry = useAddUserCountry();
  const removeUserCountry = useRemoveUserCountry();

  const flagEmoji = getFlagEmoji(code);
  const countryImage = getCountryImage(code);
  const displayName = country?.name || countryName || code;
  const subregion = country?.subregion || country?.region || '';
  const region = country?.region || '';

  // Derived State
  const visitedCountries = useMemo(
    () =>
      userCountries
        ?.filter((uc) => uc.status === 'visited')
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) ?? [],
    [userCountries]
  );

  const isVisited = useMemo(
    () => visitedCountries.some((uc) => uc.country_code === code),
    [visitedCountries, code]
  );

  const countryNumber = useMemo(() => {
    const index = visitedCountries.findIndex((uc) => uc.country_code === code);
    return index >= 0 ? index + 1 : null;
  }, [visitedCountries, code]);

  const isDream = useMemo(
    () =>
      userCountries?.some((uc) => uc.country_code === code && uc.status === 'wishlist') ?? false,
    [userCountries, code]
  );

  const hasTrips = (trips?.length ?? 0) > 0;

  // Handlers
  const handleAddTrip = useCallback(() => {
    navigation.navigate('Trips', {
      screen: 'TripForm',
      params: {
        countryId,
        countryName: displayName,
      },
    });
  }, [countryId, displayName, navigation]);

  const handleTripPress = useCallback(
    (trip: Trip) => {
      navigation.navigate('Trips', {
        screen: 'TripDetail',
        params: { tripId: trip.id },
      });
    },
    [navigation]
  );

  const handleMarkVisited = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (isVisited) {
      removeUserCountry.mutate(code);
    } else {
      addUserCountry.mutate({ country_code: code, status: 'visited' });
    }
  }, [isVisited, code, addUserCountry, removeUserCountry]);

  const handleToggleDream = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (isDream) {
      removeUserCountry.mutate(code);
    } else {
      addUserCountry.mutate({ country_code: code, status: 'wishlist' });
    }
  }, [isDream, code, addUserCountry, removeUserCountry]);

  const handleOpenShare = useCallback(() => {
    if (!country || !allCountries || !userCountries || countryNumber === null) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const thisCountryVisit = visitedCountries.find((uc) => uc.country_code === code);

    // If this country was added during onboarding, don't show milestones
    // since onboarding country order doesn't represent actual travel chronology
    const isOnboardingCountry = thisCountryVisit?.added_during_onboarding ?? false;

    // Filter to countries visited before this one, excluding onboarding countries
    const countriesVisitedBefore = thisCountryVisit
      ? visitedCountries.filter(
          (uc) =>
            new Date(uc.created_at).getTime() < new Date(thisCountryVisit.created_at).getTime() &&
            !uc.added_during_onboarding
        )
      : [];

    // Skip milestone detection for onboarding countries
    const milestones = isOnboardingCountry
      ? []
      : detectMilestones(code, allCountries, countriesVisitedBefore);

    const context: MilestoneContext = {
      countryCode: code,
      countryName: country.name,
      countryRegion: country.region,
      countrySubregion: country.subregion,
      newTotalCount: countryNumber,
      milestones,
    };

    setShareContext(context);
    setShowShareOverlay(true);
  }, [country, allCountries, userCountries, visitedCountries, countryNumber, code]);

  const handleCloseShare = useCallback(() => {
    setShowShareOverlay(false);
  }, []);

  // Animations
  const imageScale = scrollY.interpolate({
    inputRange: [-HERO_HEIGHT, 0],
    outputRange: [2, 1],
    extrapolateRight: 'clamp',
  });

  const imageTranslateY = scrollY.interpolate({
    inputRange: [-100, 0, HEADER_SCROLL_DISTANCE],
    outputRange: [0, 0, HEADER_SCROLL_DISTANCE * 0.5],
    extrapolate: 'clamp',
  });

  const titleScale = scrollY.interpolate({
    inputRange: [0, HEADER_SCROLL_DISTANCE / 2, HEADER_SCROLL_DISTANCE],
    outputRange: [1, 0.9, 0.8],
    extrapolate: 'clamp',
  });

  const titleOpacity = scrollY.interpolate({
    inputRange: [0, HEADER_SCROLL_DISTANCE * 0.6, HEADER_SCROLL_DISTANCE],
    outputRange: [1, 0.5, 0],
    extrapolate: 'clamp',
  });

  const renderTripItem = useCallback(
    ({ item }: { item: Trip }) => (
      <View style={styles.tripCardWrapper}>
        <TripCard
          trip={item}
          flagEmoji={flagEmoji}
          onPress={() => handleTripPress(item)}
          testID={`trip-card-${item.id}`}
        />
      </View>
    ),
    [flagEmoji, handleTripPress]
  );

  const ListHeader = useMemo(
    () => (
      <View style={styles.contentContainer}>
        {/* Spacer for the fixed hero section */}
        <View style={{ height: HERO_HEIGHT - 40 }} />

        <View style={styles.sheetContainer}>
          <CountryActionBar
            isVisited={isVisited}
            isDream={isDream}
            onMarkVisited={handleMarkVisited}
            onToggleDream={handleToggleDream}
          />

          <CountryStats
            region={region}
            subregion={subregion}
            isVisited={isVisited}
            countryNumber={countryNumber}
            reducedTopMargin={!isVisited}
          />

          {/* CTA Section */}
          <View style={styles.ctaSection}>
            <Button
              title={hasTrips ? 'Add Another Trip' : isVisited ? 'Log a Trip' : 'Plan a Trip'}
              onPress={handleAddTrip}
              variant="primary"
            />
          </View>

          <TripsSectionHeader tripCount={trips?.length ?? 0} />

          {/* Empty State */}
          {!hasTrips && !loadingTrips && (
            <CountryEmptyState flagEmoji={flagEmoji} displayName={displayName} />
          )}
        </View>
      </View>
    ),
    [
      isVisited,
      isDream,
      handleMarkVisited,
      handleToggleDream,
      region,
      subregion,
      countryNumber,
      hasTrips,
      trips?.length,
      handleAddTrip,
      loadingTrips,
      flagEmoji,
      displayName,
    ]
  );

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      <CountryHero
        displayName={displayName}
        subregion={subregion}
        flagEmoji={flagEmoji}
        countryImage={countryImage}
        heroHeight={HERO_HEIGHT}
        insetTop={insets.top}
        imageScale={imageScale}
        imageTranslateY={imageTranslateY}
        titleScale={titleScale}
        titleOpacity={titleOpacity}
      />

      {/* Main Scrollable Content */}
      <Animated.FlatList
        data={trips || []}
        renderItem={renderTripItem}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={ListHeader}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
          useNativeDriver: true,
        })}
        scrollEventThrottle={16}
        refreshing={loadingTrips}
        onRefresh={refetch}
      />

      {/* Sticky Header (Back Button & Share) */}
      <View style={[styles.fixedHeader, { paddingTop: insets.top }]}>
        <GlassBackButton onPress={() => navigation.goBack()} />

        {/* Right: Share Button */}
        {isVisited && (
          <TouchableOpacity
            onPress={handleOpenShare}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            activeOpacity={0.8}
            style={styles.headerShareButton}
            accessibilityLabel="Share country card"
          >
            <BlurView intensity={30} tint="light" style={styles.headerShareGlass}>
              <Ionicons name="share-outline" size={22} color={colors.midnightNavy} />
            </BlurView>
          </TouchableOpacity>
        )}
      </View>

      <ShareCardOverlay
        visible={showShareOverlay}
        context={shareContext}
        onDismiss={handleCloseShare}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.warmCream,
  },
  fixedHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    zIndex: 100,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    height: 60,
  },
  headerShareButton: {
    borderRadius: 22,
    overflow: 'hidden',
  },
  headerShareGlass: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.6)',
  },
  listContent: {
    flexGrow: 1,
    paddingBottom: 40,
  },
  contentContainer: {
    zIndex: 10,
  },
  sheetContainer: {
    backgroundColor: colors.warmCream,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingTop: 24,
    paddingHorizontal: 20,
    marginTop: -30,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 5,
  },
  ctaSection: {
    marginBottom: 16,
  },
  tripCardWrapper: {
    marginBottom: 16,
    paddingHorizontal: 4,
  },
});
