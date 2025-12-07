import { useEffect, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '@constants/colors';
import {
  COUNTRY_DIAL_CODES,
  getCountryByCode,
  type CountryDialCode,
} from '@constants/countryDialCodes';
import { getFlagEmoji } from '@utils/flags';

import { SearchInput } from './SearchInput';

interface PhoneInputProps {
  value: string; // E.164 format: +1234567890
  onChangeText: (phone: string) => void;
  defaultCountryCode?: string | null; // ISO 2-letter code (e.g., "US", "GB")
  label?: string;
  error?: string;
  placeholder?: string;
  containerStyle?: ViewStyle;
  testID?: string;
}

export function PhoneInput({
  value,
  onChangeText,
  defaultCountryCode,
  label,
  error,
  placeholder = 'Phone number',
  containerStyle,
  testID,
}: PhoneInputProps) {
  const [selectedCountry, setSelectedCountry] = useState<CountryDialCode>(() =>
    getCountryByCode(defaultCountryCode ?? null)
  );
  const [localNumber, setLocalNumber] = useState('');
  const [isPickerVisible, setIsPickerVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isFocused, setIsFocused] = useState(false);

  // Update selected country when default changes
  useEffect(() => {
    if (defaultCountryCode) {
      setSelectedCountry(getCountryByCode(defaultCountryCode));
    }
  }, [defaultCountryCode]);

  // Parse initial value if provided (only on mount)
  useEffect(() => {
    if (value && value.startsWith('+')) {
      // Try to find matching country by dial code
      const matchingCountry = COUNTRY_DIAL_CODES.find((c) => value.startsWith(c.dialCode));
      if (matchingCountry) {
        setSelectedCountry(matchingCountry);
        setLocalNumber(value.slice(matchingCountry.dialCode.length));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update parent with E.164 format whenever local number or country changes
  const handleLocalNumberChange = (text: string) => {
    // Only allow digits
    const digitsOnly = text.replace(/\D/g, '');
    setLocalNumber(digitsOnly);

    // Construct E.164 format
    const e164 = digitsOnly ? `${selectedCountry.dialCode}${digitsOnly}` : '';
    onChangeText(e164);
  };

  const handleCountrySelect = (country: CountryDialCode) => {
    setSelectedCountry(country);
    setIsPickerVisible(false);
    setSearchQuery('');

    // Update E.164 with new country code
    const e164 = localNumber ? `${country.dialCode}${localNumber}` : '';
    onChangeText(e164);
  };

  // Filter countries based on search
  const filteredCountries = searchQuery
    ? COUNTRY_DIAL_CODES.filter(
        (c) =>
          c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          c.dialCode.includes(searchQuery) ||
          c.code.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : COUNTRY_DIAL_CODES;

  // Format phone number for display (basic US formatting as example)
  const formatForDisplay = (number: string): string => {
    // Simple formatting - just add spaces for readability
    if (number.length <= 3) return number;
    if (number.length <= 6) return `${number.slice(0, 3)} ${number.slice(3)}`;
    return `${number.slice(0, 3)} ${number.slice(3, 6)} ${number.slice(6)}`;
  };

  return (
    <View style={[styles.container, containerStyle]}>
      {label && <Text style={styles.label}>{label}</Text>}

      <View
        style={[
          styles.inputRow,
          isFocused && styles.inputRowFocused,
          error && styles.inputRowError,
        ]}
      >
        {/* Country Selector */}
        <TouchableOpacity
          style={styles.countrySelector}
          onPress={() => setIsPickerVisible(true)}
          testID={testID ? `${testID}-country-picker` : undefined}
        >
          <Text style={styles.flag}>{getFlagEmoji(selectedCountry.code)}</Text>
          <Text style={styles.dialCode}>{selectedCountry.dialCode}</Text>
          <Text style={styles.chevron}>{'  \u25BC'}</Text>
        </TouchableOpacity>

        {/* Divider */}
        <View style={styles.divider} />

        {/* Phone Number Input */}
        <TextInput
          style={styles.phoneInput}
          value={formatForDisplay(localNumber)}
          onChangeText={handleLocalNumberChange}
          placeholder={placeholder}
          placeholderTextColor={colors.textTertiary}
          keyboardType="phone-pad"
          autoComplete="tel"
          textContentType="telephoneNumber"
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          testID={testID}
        />
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      {/* Country Picker Modal */}
      <Modal visible={isPickerVisible} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Select Country</Text>
            <TouchableOpacity onPress={() => setIsPickerVisible(false)} style={styles.closeButton}>
              <Text style={styles.closeButtonText}>Done</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.searchContainer}>
            <SearchInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search countries..."
            />
          </View>

          <FlatList
            data={filteredCountries}
            keyExtractor={(item) => item.code}
            renderItem={({ item }) => (
              <Pressable
                style={({ pressed }) => [
                  styles.countryRow,
                  pressed && styles.countryRowPressed,
                  item.code === selectedCountry.code && styles.countryRowSelected,
                ]}
                onPress={() => handleCountrySelect(item)}
              >
                <Text style={styles.countryFlag}>{getFlagEmoji(item.code)}</Text>
                <Text style={styles.countryName}>{item.name}</Text>
                <Text style={styles.countryDialCode}>{item.dialCode}</Text>
              </Pressable>
            )}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            keyboardShouldPersistTaps="handled"
          />
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textPrimary,
    marginBottom: 6,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    backgroundColor: colors.white,
  },
  inputRowFocused: {
    borderColor: colors.primary,
  },
  inputRowError: {
    borderColor: colors.error,
  },
  countrySelector: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  flag: {
    fontSize: 20,
    marginRight: 4,
  },
  dialCode: {
    fontSize: 16,
    color: colors.textPrimary,
    fontWeight: '500',
  },
  chevron: {
    fontSize: 10,
    color: colors.textTertiary,
    marginLeft: 2,
  },
  divider: {
    width: 1,
    height: 24,
    backgroundColor: colors.border,
  },
  phoneInput: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.textPrimary,
  },
  error: {
    fontSize: 12,
    color: colors.error,
    marginTop: 4,
  },
  // Modal styles
  modalContainer: {
    flex: 1,
    backgroundColor: colors.background,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.white,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  closeButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  closeButtonText: {
    fontSize: 16,
    color: colors.primary,
    fontWeight: '600',
  },
  searchContainer: {
    padding: 16,
    backgroundColor: colors.white,
  },
  countryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: colors.white,
  },
  countryRowPressed: {
    backgroundColor: colors.backgroundTertiary,
  },
  countryRowSelected: {
    backgroundColor: colors.backgroundTertiary,
  },
  countryFlag: {
    fontSize: 24,
    marginRight: 12,
  },
  countryName: {
    flex: 1,
    fontSize: 16,
    color: colors.textPrimary,
  },
  countryDialCode: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  separator: {
    height: 1,
    backgroundColor: colors.border,
    marginLeft: 52, // Align with text after flag
  },
});
