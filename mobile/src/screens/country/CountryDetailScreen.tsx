import { useCallback, useMemo } from 'react';
import {
  FlatList,
  Image,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';

import { Button, GlassBackButton, TripCard } from '@components/ui';
import { useCountryByCode } from '@hooks/useCountries';
import { useTripsByCountry, Trip } from '@hooks/useTrips';
import { useUserCountries, useAddUserCountry, useRemoveUserCountry } from '@hooks/useUserCountries';
import type { PassportStackScreenProps } from '@navigation/types';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { getFlagEmoji } from '@utils/flags';
import { getCountryImage } from '../../assets/countryImages';

type Props = PassportStackScreenProps<'CountryDetail'>;

// Image aspect ratio is 1856:2464 (width:height) = 0.753
const IMAGE_ASPECT_RATIO = 1856 / 2464;

const ItemSeparator = () => <View style={styles.separator} />;

export function CountryDetailScreen({ navigation, route }: Props) {
  const { countryId, countryName, countryCode } = route.params;
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();

  // Calculate hero image height based on screen width (responsive to rotation)
  const heroImageHeight = useMemo(() => screenWidth / IMAGE_ASPECT_RATIO, [screenWidth]);

  // Use countryCode if available, otherwise use countryId (they should be the same)
  const code = countryCode || countryId;
  const { data: country } = useCountryByCode(code);
  const { data: trips, isLoading: loadingTrips, refetch } = useTripsByCountry(countryId);
  const { data: userCountries } = useUserCountries();
  const addUserCountry = useAddUserCountry();
  const removeUserCountry = useRemoveUserCountry();

  const flagEmoji = getFlagEmoji(code);
  const countryImage = getCountryImage(code);
  const displayName = country?.name || countryName || code;
  const region = country?.region || '';

  // Get visited countries and calculate this country's number
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

  // Country number (1-indexed position in visited list)
  const countryNumber = useMemo(() => {
    const index = visitedCountries.findIndex((uc) => uc.country_code === code);
    return index >= 0 ? index + 1 : null;
  }, [visitedCountries, code]);

  const isWishlisted = useMemo(
    () =>
      userCountries?.some((uc) => uc.country_code === code && uc.status === 'wishlist') ?? false,
    [userCountries, code]
  );

  const handleAddTrip = useCallback(() => {
    // Navigate to trips stack and then to TripForm
    navigation.getParent()?.navigate('Trips', {
      screen: 'TripForm',
      params: {
        countryId,
        countryName: displayName,
      },
    });
  }, [countryId, displayName, navigation]);

  const handleTripPress = useCallback(
    (trip: Trip) => {
      // Navigate to trips stack and then to TripDetail
      navigation.getParent()?.navigate('Trips', {
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

  const handleToggleWishlist = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (isWishlisted) {
      removeUserCountry.mutate(code);
    } else {
      addUserCountry.mutate({ country_code: code, status: 'wishlist' });
    }
  }, [isWishlisted, code, addUserCountry, removeUserCountry]);

  const renderTripItem = useCallback(
    ({ item }: { item: Trip }) => (
      <TripCard
        trip={item}
        flagEmoji={flagEmoji}
        onPress={() => handleTripPress(item)}
        testID={`trip-card-${item.id}`}
      />
    ),
    [flagEmoji, handleTripPress]
  );

  // Determine button text based on visited status
  const ctaButtonText = useMemo(() => {
    if ((trips?.length ?? 0) > 0) {
      return 'Add Another Trip';
    }
    return isVisited ? 'Log Your Trip' : 'Plan a Trip';
  }, [trips?.length, isVisited]);

  const ListHeader = useMemo(
    () => (
      <View style={styles.header}>
        {/* Hero Image */}
        {countryImage ? (
          <View style={[styles.heroContainer, { height: heroImageHeight }]}>
            <Image source={countryImage} style={styles.heroImage} resizeMode="cover" />

            {/* Top overlay for header row and stamp title */}
            <View style={[styles.heroTopOverlay, { paddingTop: insets.top + 8 }]}>
              {/* Header row with back button and title */}
              <View style={styles.headerRow}>
                <GlassBackButton onPress={() => navigation.goBack()} />
                {/* Stamp-style country name - Oswald font, midnight navy */}
                <Text
                  style={styles.stampTitle}
                  accessibilityRole="header"
                  accessibilityLabel={`Country: ${displayName}`}
                  numberOfLines={1}
                >
                  {displayName}
                </Text>
                {/* Empty spacer to balance back button */}
                <View style={styles.headerSpacer} />
              </View>
            </View>

            {/* Bottom overlay for flag/region and action icons */}
            <View style={styles.heroBottomOverlay}>
              {/* Bottom left: Flag and Region */}
              <View style={styles.bottomLeftInfo}>
                <Text style={styles.heroFlag}>{flagEmoji}</Text>
                {region ? (
                  <BlurView intensity={30} tint="light" style={styles.heroRegionBadgeGlass}>
                    <Text style={styles.heroRegionText}>{region}</Text>
                  </BlurView>
                ) : null}
              </View>

              {/* Bottom right: Country Number OR Action Icons */}
              <View style={styles.bottomRightActions}>
                {isVisited ? (
                  // Show country number badge when visited
                  <View style={styles.countryNumberBadge}>
                    <Text style={styles.countryNumberLabel}>Country</Text>
                    <Text style={styles.countryNumberValue}>#{countryNumber}</Text>
                  </View>
                ) : (
                  // Show action icons when not visited
                  <>
                    <TouchableOpacity
                      onPress={handleMarkVisited}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      accessibilityRole="button"
                      accessibilityLabel="Mark as visited"
                      style={styles.actionIconButtonContainer}
                    >
                      <BlurView
                        intensity={30}
                        tint="light"
                        style={[styles.actionIconButtonGlass, styles.visitedIconButton]}
                      >
                        <Ionicons name="add" size={24} color={colors.mossGreen} />
                      </BlurView>
                    </TouchableOpacity>

                    <TouchableOpacity
                      onPress={handleToggleWishlist}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      accessibilityRole="button"
                      accessibilityLabel={isWishlisted ? 'Remove from wishlist' : 'Add to wishlist'}
                      style={styles.actionIconButtonContainer}
                    >
                      <BlurView
                        intensity={30}
                        tint="light"
                        style={[
                          styles.actionIconButtonGlass,
                          styles.wishlistIconButton,
                          isWishlisted && styles.wishlistIconButtonActive,
                        ]}
                      >
                        <Ionicons
                          name={isWishlisted ? 'heart' : 'heart-outline'}
                          size={22}
                          color={isWishlisted ? colors.white : colors.adobeBrick}
                        />
                      </BlurView>
                    </TouchableOpacity>
                  </>
                )}
              </View>
            </View>
          </View>
        ) : (
          /* Fallback when no country image */
          <View style={[styles.fallbackHeader, { paddingTop: insets.top + 60 }]}>
            <Text style={styles.fallbackName}>{displayName}</Text>
            <View style={styles.fallbackInfoRow}>
              <Text style={styles.fallbackFlag}>{flagEmoji}</Text>
              {region ? <Text style={styles.fallbackRegion}>{region}</Text> : null}
            </View>
          </View>
        )}

        {/* CTA Button Section */}
        <View style={styles.ctaSection}>
          <Button title={ctaButtonText} onPress={handleAddTrip} testID="add-trip-button" />
        </View>

        {/* Trips Section Header */}
        {(trips?.length ?? 0) > 0 && (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Your Trips</Text>
            <View style={styles.tripCountBadge}>
              <Text style={styles.tripCountText}>{trips?.length}</Text>
            </View>
          </View>
        )}
      </View>
    ),
    [
      countryImage,
      heroImageHeight,
      insets.top,
      displayName,
      flagEmoji,
      region,
      countryNumber,
      isVisited,
      isWishlisted,
      handleMarkVisited,
      handleToggleWishlist,
      ctaButtonText,
      handleAddTrip,
      trips?.length,
      navigation,
    ]
  );

  const ListEmpty = useMemo(
    () =>
      !loadingTrips ? (
        <View style={styles.emptyState}>
          {/* Placeholder for illustration - user will add custom asset */}
          <View style={styles.emptyIllustration}>
            <Ionicons name="book-outline" size={64} color={colors.lakeBlue} />
          </View>

          <Text style={styles.emptyTitle}>No adventures yet</Text>
          <Text style={styles.emptySubtitle}>
            {isVisited
              ? `Log your memories from ${displayName}`
              : `Start planning your trip to ${displayName}`}
          </Text>
        </View>
      ) : null,
    [loadingTrips, displayName, isVisited]
  );

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" />

      <FlatList
        data={trips || []}
        renderItem={renderTripItem}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={ListHeader}
        ListEmptyComponent={ListEmpty}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={ItemSeparator}
        refreshing={loadingTrips}
        onRefresh={refetch}
        removeClippedSubviews={true}
        maxToRenderPerBatch={10}
        windowSize={5}
        initialNumToRender={5}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.warmCream,
  },
  listContent: {
    flexGrow: 1,
    paddingBottom: 40,
  },
  header: {
    paddingTop: 0,
  },

  // Hero Section
  heroContainer: {
    position: 'relative',
    backgroundColor: colors.warmCream,
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  heroTopOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  headerSpacer: {
    width: 44, // Same width as GlassBackButton to balance the layout
  },
  heroBottomOverlay: {
    position: 'absolute',
    bottom: 16,
    left: 16,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  stampTitle: {
    flex: 1,
    fontFamily: fonts.oswald.bold,
    fontSize: 28,
    lineHeight: 44, // Match GlassBackButton height for vertical centering
    color: colors.midnightNavy,
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: 1,
    textShadowColor: 'rgba(255, 255, 255, 0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },

  // Bottom left info (flag + region)
  bottomLeftInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  heroFlag: {
    fontSize: 32,
    textShadowColor: 'rgba(255, 255, 255, 0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  heroRegionBadgeGlass: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.6)',
  },
  heroRegionText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 12,
    color: colors.midnightNavy,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  // Bottom right actions
  bottomRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },

  // Action icon buttons (when not visited)
  actionIconButtonContainer: {
    borderRadius: 22,
    overflow: 'hidden',
  },
  actionIconButtonGlass: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.6)',
  },
  visitedIconButton: {
    // Default glass style works
  },
  wishlistIconButton: {
    // Default glass style works
  },
  wishlistIconButtonActive: {
    backgroundColor: colors.adobeBrick, // Keep active state opaque or change if desired
    borderColor: colors.adobeBrick,
  },

  // Country number badge (bottom right, when visited)
  countryNumberBadge: {
    backgroundColor: colors.sunsetGold,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    alignItems: 'center',
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  countryNumberLabel: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 10,
    color: colors.midnightNavy,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    opacity: 0.8,
  },
  countryNumberValue: {
    fontFamily: fonts.oswald.bold,
    fontSize: 20,
    color: colors.midnightNavy,
  },

  // Fallback (no image)
  fallbackHeader: {
    alignItems: 'center',
    marginBottom: 24,
    paddingHorizontal: 20,
    backgroundColor: colors.warmCream,
  },
  fallbackName: {
    fontFamily: fonts.oswald.bold,
    fontSize: 32,
    lineHeight: 34,
    color: colors.midnightNavy,
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 16,
  },
  fallbackInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  fallbackFlag: {
    fontSize: 32,
  },
  fallbackRegion: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 14,
    color: colors.stormGray,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },

  // CTA Section
  ctaSection: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 8,
  },

  // Section Header
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 20,
    marginTop: 24,
    marginBottom: 12,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: colors.midnightNavyBorder,
  },
  sectionTitle: {
    fontFamily: fonts.playfair.bold,
    fontSize: 20,
    color: colors.midnightNavy,
  },
  tripCountBadge: {
    backgroundColor: colors.mossGreen,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  tripCountText: {
    fontFamily: fonts.openSans.bold,
    fontSize: 14,
    color: colors.cloudWhite,
  },

  // Trip Card Separator
  separator: {
    height: 0,
  },

  // Empty State
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
    paddingVertical: 60,
  },
  emptyIllustration: {
    width: 128,
    height: 128,
    borderRadius: 64,
    backgroundColor: colors.paperBeige,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  emptyTitle: {
    fontFamily: fonts.playfair.bold,
    fontSize: 22,
    color: colors.midnightNavy,
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontFamily: fonts.openSans.regular,
    fontSize: 16,
    color: colors.stormGray,
    textAlign: 'center',
    lineHeight: 24,
  },
});
