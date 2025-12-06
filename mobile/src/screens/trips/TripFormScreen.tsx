import { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { CoverImagePicker } from '@components/media';
import { Button, Input, SearchInput } from '@components/ui';
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
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {/* Country Picker - only show for new trips */}
        {!isEditing && (
          <View style={styles.section}>
            <Text style={styles.label}>Country *</Text>

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
                <SearchInput
                  value={countrySearch}
                  onChangeText={(text) => {
                    setCountrySearch(text);
                    setShowDropdown(text.length > 0);
                  }}
                  placeholder="Search countries..."
                  onFocus={() => setShowDropdown(countrySearch.length > 0)}
                  testID="country-search"
                />

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
            <Text style={styles.contextText}>Trip in {initialCountryName}</Text>
          </View>
        )}

        {/* Trip Name */}
        <Input
          label="Trip Name *"
          value={name}
          onChangeText={setName}
          placeholder="e.g., Spring in Kyoto"
          error={nameError}
          autoCapitalize="words"
          autoFocus={isEditing || !!selectedCountryCode}
          testID="trip-name-input"
        />

        {/* Cover Image */}
        <CoverImagePicker
          value={coverImageUrl || undefined}
          onChange={(url) => setCoverImageUrl(url || '')}
          disabled={isLoading}
        />

        {/* Future Feature Hint */}
        <View style={styles.comingSoon}>
          <Text style={styles.comingSoonTitle}>Tag Friends (Coming Soon)</Text>
          <Text style={styles.comingSoonText}>
            Soon you&apos;ll be able to tag friends on your trips and share memories together.
          </Text>
        </View>
      </ScrollView>

      {/* Save Button */}
      <View style={styles.footer}>
        <Button
          title={isEditing ? 'Save Changes' : 'Create Trip'}
          onPress={handleSave}
          loading={isLoading}
          disabled={isLoading}
          testID="trip-save-button"
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  loadingText: {
    fontSize: 16,
    color: '#666',
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 20,
    paddingBottom: 100,
  },
  section: {
    marginBottom: 20,
    zIndex: 1,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: '#1a1a1a',
    marginBottom: 8,
  },
  searchContainer: {
    position: 'relative',
  },
  dropdown: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E5EA',
    maxHeight: 250,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
    zIndex: 10,
  },
  dropdownList: {
    maxHeight: 250,
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F2F2F7',
  },
  flagEmoji: {
    fontSize: 24,
    marginRight: 12,
  },
  countryName: {
    fontSize: 16,
    color: '#1a1a1a',
  },
  selectedCountry: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F2F2F7',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
  },
  selectedFlag: {
    fontSize: 28,
    marginRight: 12,
  },
  selectedName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
    flex: 1,
  },
  changeText: {
    fontSize: 14,
    color: '#007AFF',
    fontWeight: '500',
  },
  loadingHint: {
    fontSize: 12,
    color: '#666',
    marginTop: 8,
  },
  contextBanner: {
    backgroundColor: '#E8F4FF',
    padding: 12,
    borderRadius: 8,
    marginBottom: 20,
  },
  contextText: {
    fontSize: 14,
    color: '#007AFF',
    fontWeight: '500',
    textAlign: 'center',
  },
  errorText: {
    fontSize: 12,
    color: '#FF3B30',
    marginTop: 8,
    marginLeft: 4,
  },
  comingSoon: {
    backgroundColor: '#F8F9FA',
    padding: 16,
    borderRadius: 8,
    marginTop: 24,
    borderWidth: 1,
    borderColor: '#E5E5EA',
    borderStyle: 'dashed',
  },
  comingSoonTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
    marginBottom: 4,
  },
  comingSoonText: {
    fontSize: 13,
    color: '#999',
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 20,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#F2F2F7',
  },
});
