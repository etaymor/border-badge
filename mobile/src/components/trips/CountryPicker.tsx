import { BlurView } from 'expo-blur';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { SearchInput } from '@components/ui';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import type { Country } from '@hooks/useCountries';
import { getFlagEmoji } from '@utils/flags';

export interface CountryPickerProps {
  /** Currently selected country */
  selectedCountry: Country | null;
  /** Search query */
  searchQuery: string;
  /** Handler for search query changes */
  onSearchChange: (query: string) => void;
  /** Whether dropdown is visible */
  showDropdown: boolean;
  /** Handler for dropdown visibility changes */
  onShowDropdownChange: (show: boolean) => void;
  /** Filtered list of countries to show in dropdown */
  filteredCountries: Country[];
  /** Handler for country selection */
  onSelectCountry: (country: Country) => void;
  /** Handler to clear selection */
  onClearSelection: () => void;
  /** Whether countries are loading */
  isLoading?: boolean;
  /** Error message to display */
  error?: string;
}

/**
 * Country picker component with search and autocomplete dropdown.
 * Shows either the selected country or a search input for finding countries.
 */
export function CountryPicker({
  selectedCountry,
  searchQuery,
  onSearchChange,
  showDropdown,
  onShowDropdownChange,
  filteredCountries,
  onSelectCountry,
  onClearSelection,
  isLoading = false,
  error,
}: CountryPickerProps) {
  return (
    <View style={styles.section}>
      <Text style={styles.label}>DESTINATION</Text>

      {selectedCountry ? (
        <TouchableOpacity style={styles.selectedCountry} onPress={onClearSelection}>
          <Text style={styles.selectedFlag}>{getFlagEmoji(selectedCountry.code)}</Text>
          <Text style={styles.selectedName}>{selectedCountry.name}</Text>
          <Text style={styles.changeText}>Change</Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.searchContainer}>
          <View style={styles.searchGlassWrapper}>
            <BlurView intensity={30} tint="light" style={styles.searchGlassContainer}>
              <SearchInput
                value={searchQuery}
                onChangeText={(text) => {
                  onSearchChange(text);
                  onShowDropdownChange(text.length > 0);
                }}
                placeholder="Search countries..."
                onFocus={() => onShowDropdownChange(searchQuery.length > 0)}
                testID="country-search"
                style={styles.searchInput}
              />
            </BlurView>
          </View>

          {showDropdown && filteredCountries.length > 0 && (
            <View style={styles.dropdown}>
              <FlatList
                data={filteredCountries}
                keyExtractor={(item) => item.code}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.dropdownItem}
                    onPress={() => onSelectCountry(item)}
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

          {isLoading && <Text style={styles.loadingHint}>Loading countries...</Text>}
        </View>
      )}

      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
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
    color: colors.adobeBrick,
    fontFamily: fonts.openSans.semiBold,
  },
  loadingHint: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 8,
    fontFamily: fonts.openSans.regular,
  },
  errorText: {
    fontSize: 12,
    color: colors.adobeBrick,
    marginTop: 8,
    marginLeft: 4,
    fontFamily: fonts.openSans.regular,
  },
});
