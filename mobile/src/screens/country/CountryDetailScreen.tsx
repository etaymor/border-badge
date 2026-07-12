import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActionSheetIOS,
  Alert,
  Animated,
  Dimensions,
  Platform,
  StatusBar,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';

import { Button, GlassBackButton, GlassButton, TripCard } from '@components/ui';
import {
  CountryHero,
  CountryStats,
  CountryEmptyState,
  TripsSectionHeader,
} from '@components/country';
import { SatisfactionModal } from '@components/review';
import { ShareCardOverlay } from '@components/share/ShareCardOverlay';
import { useCountries, useCountryByCode } from '@hooks/useCountries';
import { useCountryPhotoInfo } from '@hooks/useCountryPhotoInfo';
import { useReviewRequest } from '@hooks/useReviewRequest';
import { useStableCallback } from '@hooks/useStableCallback';
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

  // Review request state
  const [showReviewModal, setShowReviewModal] = useState(false);
  const {
    checkEligibility,
    startReviewFlow,
    handlePositiveResponse,
    handleNegativeResponse,
    handleDismiss,
  } = useReviewRequest();

  // Data Hooks
  const code = countryCode || countryId;
  const { data: country } = useCountryByCode(code);
  const { data: allCountries } = useCountries();
  const { data: trips, isLoading: loadingTrips, refetch } = useTripsByCountry(countryId);
  const { data: userCountries } = useUserCountries();
  const addUserCountry = useAddUserCountry();
  const removeUserCountry = useRemoveUserCountry();

  // Photo import state
  const { hasPhotos, tripCount, hasInitialImport } = useCountryPhotoInfo(code);

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
    navigation.navigate('TripForm', {
      countryId,
      countryName: displayName,
    });
  }, [countryId, displayName, navigation]);

  const handleImportPhotos = useCallback(() => {
    navigation.navigate('PhotoImport', {
      countryCode: code,
      autoStart: true,
      skipToSuggestions: hasPhotos && hasInitialImport,
    });
  }, [code, hasPhotos, hasInitialImport, navigation]);

  // Show photo button only when:
  // 1. Country is visited AND
  // 2. Either no import has happened yet OR this country has photos
  const showPhotoButton = useMemo(() => {
    if (!isVisited) return false;
    if (!hasInitialImport) return true; // First time - show to enable initial scan
    return hasPhotos; // After import, only show if photos exist for this country
  }, [isVisited, hasInitialImport, hasPhotos]);

  const handleTripPress = useCallback(
    (tripId: string) => {
      navigation.navigate('Trips', {
        screen: 'TripDetail',
        params: { tripId },
      });
    },
    [navigation]
  );

  // Identity-stable wrapper that always dispatches to the latest handler, so the
  // per-id callbacks below can be created once and cached.
  const stableTripPress = useStableCallback(handleTripPress);

  // Per-id, stable onPress callbacks so TripCard's React.memo holds across
  // parent re-renders (this screen re-renders on scroll via Animated.Value).
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

  const handleMarkVisited = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (isVisited) {
      removeUserCountry.mutate(code);
    } else {
      // Build milestone context before mutation (uses current userCountries state)
      const context = country
        ? {
            countryCode: code,
            countryName: country.name,
            countryRegion: country.region,
            countrySubregion: country.subregion,
            newTotalCount: visitedCountries.length + 1,
            milestones: detectMilestones(code, allCountries ?? [], userCountries ?? []),
          }
        : null;

      addUserCountry.mutate(
        { country_code: code, status: 'visited' },
        {
          onSuccess: () => {
            if (context) {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              setShareContext(context);
              setShowShareOverlay(true);
            }
          },
        }
      );
    }
  }, [
    isVisited,
    code,
    country,
    allCountries,
    userCountries,
    visitedCountries.length,
    addUserCountry,
    removeUserCountry,
  ]);

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

    // Filter to countries visited before this one (including onboarding countries
    // so milestone detection properly considers all prior visits)
    const countriesVisitedBefore = thisCountryVisit
      ? visitedCountries.filter(
          (uc) =>
            new Date(uc.created_at).getTime() < new Date(thisCountryVisit.created_at).getTime()
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

    // Check if we should show review prompt after sharing milestone
    if (checkEligibility('country_visited')) {
      if (startReviewFlow('country_visited')) {
        setShowReviewModal(true);
      }
    }
  }, [checkEligibility, startReviewFlow]);

  const handleReviewPositive = useCallback(async () => {
    setShowReviewModal(false);
    await handlePositiveResponse('country_visited');
  }, [handlePositiveResponse]);

  const handleReviewNegative = useCallback(() => {
    setShowReviewModal(false);
    handleNegativeResponse('country_visited');
  }, [handleNegativeResponse]);

  const handleReviewDismiss = useCallback(() => {
    setShowReviewModal(false);
    handleDismiss('country_visited');
  }, [handleDismiss]);

  const handleRemoveVisited = useCallback(() => {
    Alert.alert('Unmark as Visited?', 'This will remove this country from your visited list.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Unmark',
        style: 'destructive',
        onPress: () => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          removeUserCountry.mutate(code);
        },
      },
    ]);
  }, [code, removeUserCountry]);

  const showOptionsMenu = useCallback(() => {
    const options = ['Share', 'Unmark as Visited', 'Cancel'];
    const destructiveButtonIndex = 1;
    const cancelButtonIndex = 2;

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options,
          destructiveButtonIndex,
          cancelButtonIndex,
        },
        (buttonIndex) => {
          if (buttonIndex === 0) {
            handleOpenShare();
          } else if (buttonIndex === 1) {
            handleRemoveVisited();
          }
        }
      );
    } else {
      Alert.alert('Options', undefined, [
        { text: 'Share', onPress: handleOpenShare },
        { text: 'Unmark as Visited', style: 'destructive', onPress: handleRemoveVisited },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  }, [handleOpenShare, handleRemoveVisited]);

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

  // Hero Controls Parallax (matches image movement)
  const controlsTranslateY = imageTranslateY;

  const renderTripItem = useCallback(
    ({ item }: { item: Trip }) => (
      <View style={styles.tripCardWrapper}>
        <TripCard
          trip={item}
          flagEmoji={flagEmoji}
          onPress={getTripPressHandler(item.id)}
          testID={`trip-card-${item.id}`}
        />
      </View>
    ),
    [flagEmoji, getTripPressHandler]
  );

  const ListHeader = useMemo(
    () => (
      <View style={styles.contentContainer}>
        {/* Spacer for the fixed hero section */}
        <View style={{ height: HERO_HEIGHT - 40 }}>
          {/* Hero Controls (Overlay Buttons) */}
          {!isVisited && (
            <Animated.View
              style={[styles.heroControls, { transform: [{ translateY: controlsTranslateY }] }]}
            >
              {/* Visited Button */}
              <TouchableOpacity
                onPress={handleMarkVisited}
                activeOpacity={0.8}
                accessibilityLabel="Mark as visited"
              >
                <BlurView intensity={30} tint="light" style={styles.heroActionButton}>
                  <Ionicons name="add" size={24} color={colors.successDark} />
                </BlurView>
              </TouchableOpacity>

              {/* Dream Button */}
              <TouchableOpacity
                onPress={handleToggleDream}
                activeOpacity={0.8}
                accessibilityLabel={isDream ? 'In wishlist' : 'Add to wishlist'}
              >
                <BlurView
                  intensity={30}
                  tint="light"
                  style={[styles.heroActionButton, isDream && styles.heroActionButtonDreamActive]}
                >
                  <View style={styles.airplaneIconRotated}>
                    <Ionicons
                      name={isDream ? 'airplane' : 'airplane-outline'}
                      size={22}
                      color={isDream ? colors.wishlistBrown : colors.textTertiary}
                    />
                  </View>
                </BlurView>
              </TouchableOpacity>
            </Animated.View>
          )}
        </View>

        <View style={styles.sheetContainer}>
          <CountryStats
            region={region}
            subregion={subregion}
            isVisited={isVisited}
            countryNumber={countryNumber}
            reducedTopMargin={!isVisited}
          />

          {/* CTA Section */}
          <View style={[styles.ctaSection, showPhotoButton && styles.ctaSectionRow]}>
            <Button
              title={isVisited ? 'Add Trip' : 'Plan a Trip'}
              onPress={handleAddTrip}
              variant="primary"
              style={
                showPhotoButton
                  ? { ...styles.ctaButton, ...styles.ctaButtonFlex }
                  : styles.ctaButton
              }
            />
            {showPhotoButton && (
              <GlassButton
                title={
                  hasPhotos
                    ? tripCount === 1
                      ? '1 Trip Found'
                      : `${tripCount} Trips Found`
                    : 'Find via Photos'
                }
                onPress={handleImportPhotos}
                icon={hasPhotos ? 'images' : 'camera-outline'}
                style={{ ...styles.ctaButton, ...styles.ctaButtonFlex }}
              />
            )}
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
      handleImportPhotos,
      showPhotoButton,
      hasPhotos,
      tripCount,
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

        {/* Right: Options Menu Button */}
        {isVisited && (
          <TouchableOpacity
            onPress={showOptionsMenu}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            activeOpacity={0.8}
            style={styles.headerMenuButton}
            accessibilityLabel="More options"
          >
            <BlurView intensity={30} tint="light" style={styles.headerMenuGlass}>
              <Ionicons name="ellipsis-horizontal" size={22} color={colors.midnightNavy} />
            </BlurView>
          </TouchableOpacity>
        )}
      </View>

      <ShareCardOverlay
        visible={showShareOverlay}
        context={shareContext}
        onDismiss={handleCloseShare}
      />

      <SatisfactionModal
        visible={showReviewModal}
        onPositive={handleReviewPositive}
        onNegative={handleReviewNegative}
        onDismiss={handleReviewDismiss}
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
  headerMenuButton: {
    borderRadius: 22,
    overflow: 'hidden',
  },
  headerMenuGlass: {
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
    borderTopLeftRadius: 36,
    borderTopRightRadius: 36,
    paddingTop: 28,
    paddingHorizontal: 24,
    marginTop: -40,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 8,
  },
  ctaSection: {
    flexDirection: 'column',
    gap: 16,
    marginBottom: 32,
  },
  ctaSectionRow: {
    flexDirection: 'row',
  },
  ctaButton: {
    width: '100%',
  },
  ctaButtonFlex: {
    flex: 1,
    width: undefined,
  },
  tripCardWrapper: {
    marginBottom: 24,
    paddingHorizontal: 4,
  },
  heroControls: {
    position: 'absolute',
    bottom: 24,
    right: 20,
    flexDirection: 'row',
    gap: 12,
    zIndex: 20,
  },
  heroActionButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.6)',
  },
  heroActionButtonActive: {
    backgroundColor: colors.successDark,
    borderColor: colors.successDark,
  },
  heroActionButtonDreamActive: {
    backgroundColor: colors.wishlistGold,
    borderColor: colors.wishlistGold,
  },
  airplaneIconRotated: {
    transform: [{ rotate: '-35deg' }],
  },
});
