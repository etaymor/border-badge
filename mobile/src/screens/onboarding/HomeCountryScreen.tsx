import { useMemo, useState } from 'react';
import { FlatList, Keyboard, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, SearchInput } from '@components/ui';
import { useCountries, type Country } from '@hooks/useCountries';
import type { OnboardingStackScreenProps } from '@navigation/types';
import { useOnboardingStore } from '@stores/onboardingStore';

type Props = OnboardingStackScreenProps<'HomeCountry'>;

// Helper to get flag emoji from country code
function getFlagEmoji(countryCode: string): string {
  const codePoints = countryCode
    .toUpperCase()
    .split('')
    .map((char) => 127397 + char.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

export function HomeCountryScreen({ navigation }: Props) {
  const [searchQuery, setSearchQuery] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const { homeCountry, setHomeCountry, toggleCountry, selectedCountries } = useOnboardingStore();
  const { data: countries, isLoading } = useCountries();

  const filteredCountries = useMemo(() => {
    if (!countries || !searchQuery) return [];
    const query = searchQuery.toLowerCase();
    return countries
      .filter((c) => c.name.toLowerCase().includes(query) || c.code.toLowerCase().includes(query))
      .slice(0, 10); // Limit results for performance
  }, [countries, searchQuery]);

  const selectedCountry = useMemo(() => {
    if (!homeCountry || !countries) return null;
    return countries.find((c) => c.code === homeCountry) || null;
  }, [homeCountry, countries]);

  const handleSelectCountry = (country: Country) => {
    setHomeCountry(country.code);
    // Also add to visited countries if not already there
    if (!selectedCountries.includes(country.code)) {
      toggleCountry(country.code);
    }
    setSearchQuery('');
    setShowDropdown(false);
    Keyboard.dismiss();
  };

  const handleNext = () => {
    navigation.navigate('DreamDestination');
  };

  const handleSkip = () => {
    navigation.navigate('DreamDestination');
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.header}>
          <Text style={styles.step}>Step 2 of 4</Text>
          <Text style={styles.title}>Where do you live today?</Text>
        </View>

        {/* Grey placeholder for compass icon */}
        <View style={styles.iconPlaceholder} />

        <View style={styles.searchContainer}>
          <SearchInput
            value={searchQuery}
            onChangeText={(text) => {
              setSearchQuery(text);
              setShowDropdown(text.length > 0);
            }}
            placeholder="Search countries..."
            onFocus={() => setShowDropdown(searchQuery.length > 0)}
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
        </View>

        {/* Selected country display */}
        {selectedCountry && (
          <View style={styles.selectedContainer}>
            <View style={styles.selectedCard}>
              <Text style={styles.selectedFlag}>{getFlagEmoji(selectedCountry.code)}</Text>
              <Text style={styles.selectedName}>{selectedCountry.name}</Text>
            </View>
            <Text style={styles.successText}>
              Great! {selectedCountry.name} logged – you&apos;re 1 country in.
            </Text>
          </View>
        )}

        {isLoading && (
          <View style={styles.loadingContainer}>
            <Text style={styles.loadingText}>Loading countries...</Text>
          </View>
        )}

        <View style={styles.footer}>
          <Button title="Next" onPress={handleNext} disabled={!homeCountry} style={styles.button} />
          <Button title="Skip" onPress={handleSkip} variant="ghost" style={styles.skipButton} />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 24,
  },
  header: {
    marginBottom: 24,
  },
  step: {
    fontSize: 14,
    color: '#007AFF',
    fontWeight: '600',
    marginBottom: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#1a1a1a',
  },
  iconPlaceholder: {
    width: 80,
    height: 80,
    backgroundColor: '#E5E5EA',
    borderRadius: 40,
    alignSelf: 'center',
    marginBottom: 32,
  },
  searchContainer: {
    position: 'relative',
    zIndex: 1,
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
  selectedContainer: {
    marginTop: 24,
    alignItems: 'center',
  },
  selectedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F2F2F7',
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
    marginBottom: 12,
  },
  selectedFlag: {
    fontSize: 32,
    marginRight: 12,
  },
  selectedName: {
    fontSize: 20,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  successText: {
    fontSize: 14,
    color: '#34C759',
    fontWeight: '500',
    textAlign: 'center',
  },
  loadingContainer: {
    marginTop: 24,
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 16,
    color: '#666',
  },
  footer: {
    marginTop: 'auto',
    paddingVertical: 24,
  },
  button: {
    width: '100%',
  },
  skipButton: {
    width: '100%',
    marginTop: 8,
  },
});
