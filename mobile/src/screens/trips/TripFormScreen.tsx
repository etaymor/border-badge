import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Keyboard,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CoverImagePicker } from '@components/media';
import { Button, GlassBackButton, GlassInput, SearchInput } from '@components/ui';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { useCountries, type Country } from '@hooks/useCountries';
import { useCreateTrip, useTrip, useUpdateTrip } from '@hooks/useTrips';
import type { TripsStackScreenProps } from '@navigation/types';
import { getFlagEmoji } from '@utils/flags';

type Props = TripsStackScreenProps<'TripForm'>;

export function TripFormScreen({ navigation, route }: Props) {
  const tripId = route.params?.tripId;
  const initialCountryId = route.params?.countryId;
  const initialCountryName = route.params?.countryName;
  const isEditing = !!tripId;
  const insets = useSafeAreaInsets();

  // Form state
  const [name, setName] = useState('');
  const [coverImageUrl, setCoverImageUrl] = useState('');

  // Country picker state
  const [countrySearch, setCountrySearch] = useState('');
  const [selectedCountryCode, setSelectedCountryCode] = useState<string | null>(
    initialCountryId || null
  );
  const [showDropdown, setShowDropdown] = useState(false);

  // Validation state
  const [nameError, setNameError] = useState('');
  const [countryError, setCountryError] = useState('');

  // Fetch countries for picker
  const { data: countries, isLoading: loadingCountries } = useCountries();

  // Fetch existing trip if editing
  const { data: existingTrip, isLoading: loadingTrip } = useTrip(tripId || '');

  // Mutations
  const createTrip = useCreateTrip();
  const updateTrip = useUpdateTrip();

  // Filter countries based on search
  const filteredCountries = useMemo(() => {
    if (!countries || !countrySearch) return [];
    const query = countrySearch.toLowerCase();
    return countries
      .filter((c) => c.name.toLowerCase().includes(query) || c.code.toLowerCase().includes(query))
      .slice(0, 10);
  }, [countries, countrySearch]);

  // Get selected country object
  const selectedCountry = useMemo(() => {
    if (!selectedCountryCode || !countries) return null;
    return countries.find((c) => c.code === selectedCountryCode) || null;
  }, [selectedCountryCode, countries]);

  // Populate form when editing
  useEffect(() => {
    if (existingTrip && isEditing) {
      setName(existingTrip.name);
      setCoverImageUrl(existingTrip.cover_image_url || '');
    }
  }, [existingTrip, isEditing]);

  // Update country when navigating with a new countryId
  useEffect(() => {
    if (initialCountryId && !isEditing) {
      setSelectedCountryCode(initialCountryId);
    }
  }, [initialCountryId, isEditing]);

  const handleSelectCountry = (country: Country) => {
    setSelectedCountryCode(country.code);
    setCountrySearch('');
    setShowDropdown(false);
    setCountryError('');
    Keyboard.dismiss();
  };

  const validate = (): boolean => {
    let isValid = true;

    // Name is required
    if (!name.trim()) {
      setNameError('Trip name is required');
      isValid = false;
    } else {
      setNameError('');
    }

    // Country is required for new trips
    if (!isEditing && !selectedCountryCode) {
      setCountryError('Please select a country');
      isValid = false;
    } else {
      setCountryError('');
    }

    return isValid;
  };

  const handleSave = async () => {
    if (!validate()) return;

    try {
      if (isEditing && tripId) {
        // Update existing trip
        await updateTrip.mutateAsync({
          id: tripId,
          name: name.trim(),
          cover_image_url: coverImageUrl.trim() || undefined,
        });
        navigation.goBack();
      } else {
        // Create new trip and navigate to trip details
        const newTrip = await createTrip.mutateAsync({
          name: name.trim(),
          country_code: selectedCountryCode!,
          cover_image_url: coverImageUrl.trim() || undefined,
        });
        // Navigate to trip details, replacing the form screen
        navigation.replace('TripDetail', { tripId: newTrip.id });
      }
    } catch {
      // Error is handled by the mutation's onError
    }
  };

  const isLoading = createTrip.isPending || updateTrip.isPending;
  const isFetching = loadingTrip && isEditing;

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
          {/* Spacer to balance layout */}
          <View style={styles.headerSpacer} />
        </View>
      </View>

      <ScrollView
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
            <View style={styles.section}>
              <Text style={styles.label}>DESTINATION</Text>

              {/* Show selected country or search input */}
              {selectedCountry ? (
                <TouchableOpacity
                  style={styles.selectedCountry}
                  onPress={() => {
                    setSelectedCountryCode(null);
                    setCountrySearch('');
                  }}
                >
                  <Text style={styles.selectedFlag}>{getFlagEmoji(selectedCountry.code)}</Text>
                  <Text style={styles.selectedName}>{selectedCountry.name}</Text>
                  <Text style={styles.changeText}>Change</Text>
                </TouchableOpacity>
              ) : (
                <View style={styles.searchContainer}>
                  <View style={styles.searchGlassWrapper}>
                    <BlurView intensity={30} tint="light" style={styles.searchGlassContainer}>
                      <SearchInput
                        value={countrySearch}
                        onChangeText={(text) => {
                          setCountrySearch(text);
                          setShowDropdown(text.length > 0);
                        }}
                        placeholder="Search countries..."
                        onFocus={() => setShowDropdown(countrySearch.length > 0)}
                        testID="country-search"
                        style={styles.searchInput}
                      />
                    </BlurView>
                  </View>

                  {/* Autocomplete dropdown */}
                  {showDropdown && filteredCountries.length > 0 && (
                    <View style={styles.dropdown}>
                      <FlatList
                        data={filteredCountries}
                        keyExtractor={(item) => item.code}
                        renderItem={({ item }) => (
                          <TouchableOpacity
                            style={styles.dropdownItem}
                            onPress={() => handleSelectCountry(item)}
                            testID={`country-option-${item.code}`}
                          >
                            <Text style={styles.flagEmoji}>{getFlagEmoji(item.code)}</Text>
                            <Text style={styles.countryName}>{item.name}</Text>
                          </TouchableOpacity>
                        )}
                        keyboardShouldPersistTaps="handled"
                        style={styles.dropdownList}
                      />
                    </View>
                  )}

                  {loadingCountries && <Text style={styles.loadingHint}>Loading countries...</Text>}
                </View>
              )}
              {countryError ? <Text style={styles.errorText}>{countryError}</Text> : null}
            </View>
          )}

          {/* Show country context when editing or pre-selected */}
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

          {/* Travel Companions Feature Teaser */}
          <View style={styles.visaStampContainer}>
            <View style={styles.visaStampBorder}>
              <View style={styles.comingSoonHeader}>
                <Ionicons name="people" size={20} color={colors.mossGreen} />
                <Text style={styles.comingSoonTitle}>Travel Companions</Text>
              </View>
              <Text style={styles.comingSoonText}>
                Tagging friends is coming in the next update.
              </Text>
              <View style={styles.stampBadge}>
                <Text style={styles.stampBadgeText}>VISA PENDING</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Save Button - inside ScrollView for proper keyboard handling */}
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) + 16 }]}>
          <Button
            title={isEditing ? 'Save Changes' : 'Create Trip'}
            onPress={handleSave}
            loading={isLoading}
            disabled={isLoading}
            testID="trip-save-button"
          />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
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
    lineHeight: 44, // Match GlassBackButton height for vertical centering
  },
  headerSpacer: {
    width: 44, // Same width as GlassBackButton to balance the layout
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
  searchContainer: {
    position: 'relative',
  },
  searchGlassWrapper: {
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  searchGlassContainer: {
    borderRadius: 12,
    backgroundColor: '#fff',
  },
  searchInput: {
    backgroundColor: 'transparent',
    borderWidth: 0,
  },
  dropdown: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    marginTop: 4,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.05)',
    maxHeight: 250,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 8,
    zIndex: 100,
  },
  dropdownList: {
    maxHeight: 250,
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f5f5f5',
  },
  flagEmoji: {
    fontSize: 24,
    marginRight: 12,
  },
  countryName: {
    fontSize: 16,
    color: colors.midnightNavy,
    fontFamily: fonts.openSans.regular,
  },
  selectedCountry: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.05)',
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  selectedFlag: {
    fontSize: 28,
    marginRight: 12,
  },
  selectedName: {
    fontSize: 18,
    fontFamily: fonts.playfair.bold,
    color: colors.midnightNavy,
    flex: 1,
  },
  changeText: {
    fontSize: 14,
    color: colors.adobeBrick, // Changed from sunsetGold for accessibility
    fontFamily: fonts.openSans.semiBold,
  },
  loadingHint: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 8,
    fontFamily: fonts.openSans.regular,
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
  errorText: {
    fontSize: 12,
    color: colors.adobeBrick,
    marginTop: 8,
    marginLeft: 4,
    fontFamily: fonts.openSans.regular,
  },

  // Whimsical Visa Stamp Section
  visaStampContainer: {
    marginTop: 12,
    transform: [{ rotate: '-1deg' }],
  },
  visaStampBorder: {
    backgroundColor: 'rgba(84, 122, 95, 0.05)', // Moss Green light
    padding: 24,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: 'rgba(84, 122, 95, 0.2)',
    borderStyle: 'dashed',
  },
  comingSoonHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 8,
  },
  comingSoonTitle: {
    fontSize: 18,
    fontFamily: fonts.playfair.bold,
    color: colors.mossGreen,
  },
  comingSoonText: {
    fontSize: 14,
    color: colors.textSecondary,
    fontFamily: fonts.openSans.regular,
    lineHeight: 22,
    marginBottom: 16,
    fontStyle: 'italic',
  },
  stampBadge: {
    borderWidth: 2,
    borderColor: colors.mossGreen,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    alignSelf: 'flex-start',
    transform: [{ rotate: '-2deg' }],
    opacity: 0.8,
  },
  stampBadgeText: {
    color: colors.mossGreen,
    fontSize: 12,
    fontFamily: fonts.oswald.bold,
    letterSpacing: 1,
  },
  footer: {
    padding: 24,
    paddingTop: 16,
  },
});
