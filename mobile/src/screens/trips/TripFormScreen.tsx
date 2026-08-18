import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CoverImagePicker } from '@components/media';
import { CountryPicker, TravelFriendsSection } from '@components/trips';
import { Button, GlassBackButton, GlassInput } from '@components/ui';
import { features } from '@config/features';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { useCountryPicker } from '@hooks/useCountryPicker';
import { usePhotoPermissionStatus } from '@hooks/usePhotoPermissions';
import { useTripForm } from '@hooks/useTripForm';
import { useDeleteTrip } from '@hooks/useTrips';
import type {
  DreamsStackScreenProps,
  PassportStackScreenProps,
  TripsStackScreenProps,
} from '@navigation/types';
import type { CompositeScreenProps } from '@react-navigation/native';

// TripFormScreen can be rendered in TripsNavigator, PassportNavigator, or DreamsNavigator
// Use CompositeScreenProps to create a union type that covers all three cases
type Props = CompositeScreenProps<
  TripsStackScreenProps<'TripForm'>,
  CompositeScreenProps<PassportStackScreenProps<'TripForm'>, DreamsStackScreenProps<'TripForm'>>
>;

export function TripFormScreen({ navigation, route }: Props) {
  const tripId = route.params?.tripId;
  const initialCountryId = route.params?.countryId;
  const initialCountryName = route.params?.countryName;
  const prefillPlace = route.params?.prefillPlace;
  const prefillPhotos = route.params?.prefillPhotos;
  const insets = useSafeAreaInsets();
  const scrollViewRef = useRef<ScrollView>(null);

  // Form state and logic
  const {
    name,
    setName,
    coverImageUrl,
    setCoverImageUrl,
    selectedFriendIds,
    invitedEmails,
    handleToggleFriend,
    handleToggleEmailInvite,
    nameError,
    countryError,
    setCountryError,
    isLoading,
    isFetching,
    handleSave,
    isEditing,
    existingTrip,
  } = useTripForm({ tripId });

  // Country picker state
  const {
    countrySearch,
    setCountrySearch,
    showDropdown,
    setShowDropdown,
    selectedCountryCode,
    selectedCountry,
    filteredCountries,
    isLoading: loadingCountries,
    handleSelectCountry,
    selectCountryCode,
    clearSelection,
  } = useCountryPicker({ initialCountryCode: initialCountryId });

  // Delete support (edit mode only)
  const deleteTrip = useDeleteTrip();
  const isDeleting = deleteTrip.isPending;
  const isMutating = isLoading || isDeleting;

  // Photo permissions for photo assist card
  const { status: photoPermissionStatus } = usePhotoPermissionStatus();

  // System trips (Saved Places) cannot have their country changed.
  const isSystemTrip = !!existingTrip?.is_system;
  const showCountryPicker = !isEditing || !isSystemTrip;

  // Seed the country picker from the existing trip when editing
  useEffect(() => {
    if (isEditing && existingTrip?.country_code && !selectedCountryCode) {
      selectCountryCode(existingTrip.country_code);
    }
  }, [isEditing, existingTrip?.country_code, selectedCountryCode, selectCountryCode]);

  // Clear country error when country is selected
  useEffect(() => {
    if (selectedCountryCode) {
      setCountryError('');
    }
  }, [selectedCountryCode, setCountryError]);

  const handleFriendsSearchFocus = useCallback(() => {
    setTimeout(() => {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    }, 100);
  }, []);

  // Navigate to photo trips (filtered by country)
  // TripsStack and PassportStack both have PhotoTrips; DreamsStack does not.
  // We check if the current navigator has PhotoTrips route before navigating.
  const handleImportPhotos = useCallback(() => {
    const routeNames = navigation.getState()?.routeNames ?? [];
    if (routeNames.includes('PhotoTrips')) {
      navigation.navigate('PhotoTrips', {
        countryCode: selectedCountryCode ?? undefined,
      });
    } else {
      const parentNav = navigation.getParent();
      const parentRouteNames = parentNav?.getState()?.routeNames ?? [];
      if (parentNav && parentRouteNames.includes('PhotoTrips')) {
        parentNav.navigate('PhotoTrips', {
          countryCode: selectedCountryCode ?? undefined,
        });
      }
    }
  }, [navigation, selectedCountryCode]);

  const onSave = useCallback(() => {
    handleSave(selectedCountryCode, (newTripId) => {
      if (isEditing) {
        navigation.goBack();
      } else if (newTripId) {
        // When inside TripsNavigator, replace with TripDetail.
        // When inside PassportNavigator (from CountryDetail), just go back —
        // the country screen will show the new trip via React Query refetch.
        const routeNames = navigation.getState()?.routeNames ?? [];
        if (routeNames.includes('TripDetail')) {
          navigation.replace('TripDetail', {
            tripId: newTripId,
            prefillPlace,
            prefillPhotos,
          });
        } else {
          navigation.goBack();
        }
      }
    });
  }, [handleSave, selectedCountryCode, isEditing, navigation, prefillPlace, prefillPhotos]);

  const handleDelete = useCallback(() => {
    if (!tripId) return;

    Alert.alert(
      'Delete Trip',
      'Are you sure you want to delete this trip? This will also delete all entries and media.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteTrip.mutateAsync(tripId);
              navigation.pop(2);
            } catch {
              // Error is handled by the mutation's onError
            }
          },
        },
      ]
    );
  }, [tripId, deleteTrip, navigation]);

  if (isFetching) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>Loading trip...</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Custom Header */}
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <GlassBackButton onPress={() => navigation.goBack()} />
          <Text style={styles.headerTitle}>{isEditing ? 'Edit Trip' : 'New Trip'}</Text>
          <View style={styles.headerSpacer} />
        </View>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardAvoid}
        keyboardVerticalOffset={0}
      >
        <ScrollView
          ref={scrollViewRef}
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.content}>
            <Text style={styles.headerSubtitle}>
              {isEditing ? 'Update your trip details' : 'Where are you heading next?'}
            </Text>

            {/* Country Picker - shown for new trips and when editing a non-system trip */}
            {showCountryPicker && (
              <CountryPicker
                selectedCountry={selectedCountry}
                searchQuery={countrySearch}
                onSearchChange={setCountrySearch}
                showDropdown={showDropdown}
                onShowDropdownChange={setShowDropdown}
                filteredCountries={filteredCountries}
                onSelectCountry={handleSelectCountry}
                onClearSelection={clearSelection}
                isLoading={loadingCountries}
                error={countryError}
              />
            )}

            {/* Photo Assist Card - only show for new trips */}
            {!isEditing && (
              <Pressable style={styles.photoAssistCard} onPress={handleImportPhotos}>
                <View style={styles.photoAssistIconContainer}>
                  <Ionicons name="images-outline" size={24} color={colors.sunsetGold} />
                </View>
                <View style={styles.photoAssistContent}>
                  <Text style={styles.photoAssistTitle}>Start from Photos</Text>
                  <Text style={styles.photoAssistDescription}>
                    {photoPermissionStatus === 'granted' || photoPermissionStatus === 'limited'
                      ? 'Scan photos to find places'
                      : 'Build trip from your photos'}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.sunsetGold} />
              </Pressable>
            )}

            {/* Fallback country context — shown only when the picker is hidden
                (system trips), since the picker itself already shows the country. */}
            {isEditing && !showCountryPicker && initialCountryName && (
              <View style={styles.contextBanner}>
                <Ionicons name="location-sharp" size={16} color={colors.adobeBrick} />
                <Text style={styles.contextText}>Trip in {initialCountryName}</Text>
              </View>
            )}

            {/* Trip Name */}
            <View style={styles.section}>
              <GlassInput
                label="TRIP NAME"
                value={name}
                onChangeText={setName}
                placeholder="e.g., Spring in Kyoto"
                error={nameError}
                autoCapitalize="words"
                testID="trip-name-input"
              />
            </View>

            {/* Cover Image */}
            <View style={styles.section}>
              <Text style={styles.label}>COVER PHOTO</Text>
              <CoverImagePicker
                value={coverImageUrl || undefined}
                onChange={(url) => setCoverImageUrl(url || '')}
                disabled={isLoading}
              />
            </View>

            {/* Tag Friends - social feature, hidden when the flag is off */}
            {features.enableSocial && (
              <TravelFriendsSection
                selectedIds={selectedFriendIds}
                invitedEmails={invitedEmails}
                onToggleSelection={handleToggleFriend}
                onToggleEmailInvite={handleToggleEmailInvite}
                onSearchFocus={handleFriendsSearchFocus}
                disabled={isLoading}
              />
            )}
          </View>

          {/* Save Button */}
          <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) + 16 }]}>
            <Button
              title={isEditing ? 'Save Changes' : 'Create Trip'}
              onPress={onSave}
              loading={isLoading}
              disabled={isMutating}
              testID="trip-save-button"
            />
            {isEditing && (
              <Button
                title="Delete Trip"
                onPress={handleDelete}
                variant="destructive"
                loading={isDeleting}
                disabled={isMutating}
                style={styles.deleteButton}
                testID="trip-delete-button"
              />
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  keyboardAvoid: {
    flex: 1,
  },
  container: {
    flex: 1,
    backgroundColor: colors.warmCream,
  },
  header: {
    backgroundColor: colors.warmCream,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerTitle: {
    flex: 1,
    fontFamily: fonts.playfair.bold,
    fontSize: 24,
    color: colors.midnightNavy,
    textAlign: 'center',
    lineHeight: 44,
  },
  headerSpacer: {
    width: 44,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.warmCream,
  },
  loadingText: {
    fontSize: 16,
    color: colors.textSecondary,
    fontFamily: fonts.openSans.regular,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  content: {
    padding: 24,
    paddingTop: 8,
  },
  headerSubtitle: {
    fontFamily: fonts.openSans.regular,
    fontSize: 16,
    color: colors.textSecondary,
    marginBottom: 24,
    lineHeight: 24,
  },
  section: {
    marginBottom: 28,
    zIndex: 1,
  },
  label: {
    fontFamily: fonts.oswald.medium,
    fontSize: 12,
    color: colors.midnightNavy,
    marginBottom: 10,
    letterSpacing: 1.5,
    opacity: 0.7,
    textTransform: 'uppercase',
  },
  photoAssistCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(228, 168, 81, 0.08)',
    padding: 16,
    borderRadius: 16,
    marginBottom: 28,
    gap: 12,
    borderWidth: 1,
    borderColor: 'rgba(228, 168, 81, 0.2)',
  },
  photoAssistIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(228, 168, 81, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoAssistContent: {
    flex: 1,
  },
  photoAssistTitle: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 15,
    color: colors.midnightNavy,
  },
  photoAssistDescription: {
    fontFamily: fonts.openSans.regular,
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  contextBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(193, 84, 62, 0.08)',
    padding: 12,
    borderRadius: 12,
    marginBottom: 24,
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(193, 84, 62, 0.1)',
  },
  contextText: {
    fontSize: 14,
    color: colors.adobeBrick,
    fontFamily: fonts.openSans.semiBold,
  },
  footer: {
    padding: 24,
    paddingTop: 16,
  },
  deleteButton: {
    marginTop: 12,
  },
});
