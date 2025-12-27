import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CoverImagePicker } from '@components/media';
import { CountryPicker, TravelFriendsSection } from '@components/trips';
import { Button, GlassBackButton, GlassInput } from '@components/ui';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { useCountryPicker } from '@hooks/useCountryPicker';
import { useTripForm } from '@hooks/useTripForm';
import type { TripsStackScreenProps } from '@navigation/types';

type Props = TripsStackScreenProps<'TripForm'>;

export function TripFormScreen({ navigation, route }: Props) {
  const tripId = route.params?.tripId;
  const initialCountryId = route.params?.countryId;
  const initialCountryName = route.params?.countryName;
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
    clearSelection,
  } = useCountryPicker({ initialCountryCode: initialCountryId });

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

  const onSave = useCallback(() => {
    handleSave(selectedCountryCode, (newTripId) => {
      if (isEditing) {
        navigation.goBack();
      } else if (newTripId) {
        navigation.replace('TripDetail', { tripId: newTripId });
      }
    });
  }, [handleSave, selectedCountryCode, isEditing, navigation]);

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

            {/* Country Picker - only show for new trips */}
            {!isEditing && (
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

            {/* Show country context when editing */}
            {isEditing && initialCountryName && (
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

            {/* Tag Friends */}
            <TravelFriendsSection
              selectedIds={selectedFriendIds}
              invitedEmails={invitedEmails}
              onToggleSelection={handleToggleFriend}
              onToggleEmailInvite={handleToggleEmailInvite}
              onSearchFocus={handleFriendsSearchFocus}
              disabled={isLoading}
            />
          </View>

          {/* Save Button */}
          <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) + 16 }]}>
            <Button
              title={isEditing ? 'Save Changes' : 'Create Trip'}
              onPress={onSave}
              loading={isLoading}
              disabled={isLoading}
              testID="trip-save-button"
            />
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
});
