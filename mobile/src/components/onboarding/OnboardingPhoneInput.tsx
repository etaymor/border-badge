import { Ionicons } from '@expo/vector-icons';
import { isValidPhoneNumber } from 'libphonenumber-js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SearchInput, Text } from '@components/ui';
import { colors } from '@constants/colors';
import {
  COUNTRY_DIAL_CODES,
  getCountryByCode,
  type CountryDialCode,
} from '@constants/countryDialCodes';
import { fonts } from '@constants/typography';
import { getFlagEmoji } from '@utils/flags';

export interface OnboardingPhoneInputProps {
  value: string; // E.164 format: +1234567890
  onChangeText: (phone: string) => void;
  defaultCountryCode?: string | null; // ISO 2-letter code (e.g., "US", "GB")
  error?: string;
  placeholder?: string;
  containerStyle?: ViewStyle;
  testID?: string;
  onValidationChange?: (isValid: boolean) => void; // Optional callback for real-time validation
}

export default function OnboardingPhoneInput({
  value,
  onChangeText,
  defaultCountryCode,
  error,
  placeholder = 'Phone Number',
  containerStyle,
  testID,
  onValidationChange,
}: OnboardingPhoneInputProps) {
  const [selectedCountry, setSelectedCountry] = useState<CountryDialCode>(() =>
    getCountryByCode(defaultCountryCode ?? null)
  );
  const [localNumber, setLocalNumber] = useState('');
  const [isPickerVisible, setIsPickerVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isFocused, setIsFocused] = useState(false);

  // Track the last value we emitted to avoid sync loops
  const lastEmittedValue = useRef<string>('');

  // Track if user has explicitly selected a country (to prevent defaultCountryCode from overriding)
  const userHasSelectedCountry = useRef(false);

  // Sync external value prop to internal state (controlled component behavior)
  // Note: defaultCountryCode removed from deps to prevent re-parsing when it changes (Issue #1)
  useEffect(() => {
    // Skip if this is the value we just emitted (prevents infinite loops)
    if (value === lastEmittedValue.current) {
      return;
    }

    // Update ref to track current external value
    lastEmittedValue.current = value;

    if (!value) {
      setLocalNumber('');
      return;
    }

    // Parse E.164 value to extract country and local number
    // Sort by dial code length descending to match longest first (e.g., +1684 before +1)
    const sortedCountries = [...COUNTRY_DIAL_CODES].sort(
      (a, b) => b.dialCode.length - a.dialCode.length
    );

    // Only prioritize defaultCountryCode if user hasn't explicitly selected a country (Issue #3)
    // This prevents the flag from unexpectedly switching when the parent has a different default
    if (defaultCountryCode && !userHasSelectedCountry.current) {
      const defaultCountry = getCountryByCode(defaultCountryCode);
      if (value.startsWith(defaultCountry.dialCode)) {
        setSelectedCountry(defaultCountry);
        setLocalNumber(value.slice(defaultCountry.dialCode.length));
        return;
      }
    }

    // Find matching country by dial code
    for (const country of sortedCountries) {
      if (value.startsWith(country.dialCode)) {
        setSelectedCountry(country);
        setLocalNumber(value.slice(country.dialCode.length));
        return;
      }
    }

    // No matching dial code found - reset to default (or US) to avoid flag mismatch
    const fallbackCountry = getCountryByCode(defaultCountryCode ?? null);
    setSelectedCountry(fallbackCountry);
    setLocalNumber(value.replace(/^\+/, ''));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- defaultCountryCode intentionally excluded to prevent infinite loop (Issue #1)
  }, [value]);

  // Update selected country when default changes (and no value is set, and user hasn't selected)
  useEffect(() => {
    if (defaultCountryCode && !value && !userHasSelectedCountry.current) {
      setSelectedCountry(getCountryByCode(defaultCountryCode));
    }
  }, [defaultCountryCode, value]);

  // Real-time validation using libphonenumber-js (Issue #4)
  const isCurrentNumberValid = useMemo(() => {
    if (!localNumber) return false;
    const e164 = `${selectedCountry.dialCode}${localNumber}`;
    return isValidPhoneNumber(e164);
  }, [localNumber, selectedCountry.dialCode]);

  // Notify parent of validation state changes
  useEffect(() => {
    onValidationChange?.(isCurrentNumberValid);
  }, [isCurrentNumberValid, onValidationChange]);

  // Update parent with E.164 format whenever local number or country changes
  const handleLocalNumberChange = (text: string) => {
    // Only allow digits
    const digitsOnly = text.replace(/\D/g, '');
    // E.164 max is 15 digits total; enforce reasonable max for local number
    const truncated = digitsOnly.slice(0, 15);
    setLocalNumber(truncated);

    // Construct E.164 format
    const e164 = truncated ? `${selectedCountry.dialCode}${truncated}` : '';
    lastEmittedValue.current = e164;
    onChangeText(e164);
  };

  const handleCountrySelect = (country: CountryDialCode) => {
    // Mark that user has explicitly selected a country (Issue #3)
    userHasSelectedCountry.current = true;

    setSelectedCountry(country);
    setIsPickerVisible(false);
    setSearchQuery('');

    // Update E.164 with new country code
    const e164 = localNumber ? `${country.dialCode}${localNumber}` : '';
    lastEmittedValue.current = e164;
    onChangeText(e164);
  };

  // Filter countries based on search (memoized to prevent recalculation on unrelated state changes)
  const filteredCountries = useMemo(() => {
    if (!searchQuery) return COUNTRY_DIAL_CODES;
    const query = searchQuery.toLowerCase();
    return COUNTRY_DIAL_CODES.filter(
      (c) =>
        c.name.toLowerCase().includes(query) ||
        c.dialCode.includes(searchQuery) ||
        c.code.toLowerCase().includes(query)
    );
  }, [searchQuery]);

  // Row height for FlatList optimization (paddingVertical: 12 * 2 + content ~24 + separator 1)
  const COUNTRY_ROW_HEIGHT = 49;

  // getItemLayout for instant scroll calculations
  const getItemLayout = useCallback(
    (_: ArrayLike<CountryDialCode> | null | undefined, index: number) => ({
      length: COUNTRY_ROW_HEIGHT,
      offset: COUNTRY_ROW_HEIGHT * index,
      index,
    }),
    []
  );

  return (
    <View style={containerStyle}>
      <View
        style={[
          styles.inputWrapper,
          isFocused && styles.inputWrapperFocused,
          error && styles.inputWrapperError,
        ]}
      >
        {/* Country Selector */}
        <TouchableOpacity
          style={styles.countrySelector}
          onPress={() => setIsPickerVisible(true)}
          testID={testID ? `${testID}-country-picker` : undefined}
          accessibilityRole="button"
          accessibilityLabel={`Select country, currently ${selectedCountry.name} ${selectedCountry.dialCode}`}
          accessibilityHint="Opens country picker"
        >
          <Text style={styles.flag}>{getFlagEmoji(selectedCountry.code)}</Text>
          <Text style={styles.dialCode}>{selectedCountry.dialCode}</Text>
          <Ionicons name="chevron-down" size={16} color={colors.midnightNavyMuted} />
        </TouchableOpacity>

        {/* Divider */}
        <View style={styles.divider} />

        {/* Phone Number Input */}
        <TextInput
          style={styles.phoneInput}
          value={localNumber}
          onChangeText={handleLocalNumberChange}
          placeholder={placeholder}
          placeholderTextColor={colors.midnightNavyMuted}
          keyboardType="phone-pad"
          autoComplete="tel"
          textContentType="telephoneNumber"
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          testID={testID}
        />

        {/* Clear button */}
        {localNumber.length > 0 && (
          <TouchableOpacity onPress={() => handleLocalNumberChange('')} style={styles.clearButton}>
            <Ionicons name="close-circle" size={26} color={colors.midnightNavyMuted} />
          </TouchableOpacity>
        )}
      </View>

      {error && (
        <Text variant="caption" style={styles.errorText}>
          {error}
        </Text>
      )}

      {/* Country Picker Modal */}
      <Modal visible={isPickerVisible} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text variant="heading" style={styles.modalTitle}>
              Select Country
            </Text>
            <TouchableOpacity
              onPress={() => {
                setIsPickerVisible(false);
                setSearchQuery('');
              }}
              style={styles.closeButton}
              accessibilityRole="button"
              accessibilityLabel="Done, close country picker"
            >
              <Text variant="body" style={styles.closeButtonText}>
                Done
              </Text>
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
            getItemLayout={getItemLayout}
            renderItem={({ item }) => (
              <Pressable
                style={({ pressed }) => [
                  styles.countryRow,
                  pressed && styles.countryRowPressed,
                  item.code === selectedCountry.code && styles.countryRowSelected,
                ]}
                onPress={() => handleCountrySelect(item)}
                accessibilityRole="button"
                accessibilityLabel={`${item.name} ${item.dialCode}`}
                accessibilityState={{ selected: item.code === selectedCountry.code }}
              >
                <Text style={styles.countryFlag}>{getFlagEmoji(item.code)}</Text>
                <Text variant="body" style={styles.countryName}>
                  {item.name}
                </Text>
                <Text variant="caption" style={styles.countryDialCode}>
                  {item.dialCode}
                </Text>
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
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.midnightNavyLight,
    borderRadius: 16,
    paddingRight: 12,
    minHeight: 60,
  },
  inputWrapperFocused: {
    backgroundColor: colors.midnightNavyFocused,
  },
  inputWrapperError: {
    borderWidth: 1,
    borderColor: colors.error,
  },
  countrySelector: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 8,
  },
  flag: {
    fontSize: 24,
  },
  dialCode: {
    fontSize: 18,
    fontFamily: fonts.openSans.regular,
    color: colors.midnightNavy,
  },
  divider: {
    width: 1,
    height: 28,
    backgroundColor: colors.midnightNavyBorder,
  },
  phoneInput: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 24,
    fontFamily: fonts.openSans.regular,
    color: colors.midnightNavy,
  },
  clearButton: {
    padding: 4,
  },
  errorText: {
    color: colors.error,
    marginTop: 8,
    marginLeft: 4,
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
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.white,
  },
  modalTitle: {
    color: colors.textPrimary,
  },
  closeButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  closeButtonText: {
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
    paddingVertical: 14,
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
    marginRight: 16,
  },
  countryName: {
    flex: 1,
    color: colors.textPrimary,
  },
  countryDialCode: {
    color: colors.textSecondary,
  },
  separator: {
    height: 1,
    backgroundColor: colors.border,
    marginLeft: 56,
  },
});
