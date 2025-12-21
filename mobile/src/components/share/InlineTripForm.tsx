/**
 * Inline trip creation form for use within the share flow.
 * Allows quick trip creation without navigating away.
 */

import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useCountries } from '@hooks/useCountries';
import { GlassInput, Button } from '@components/ui';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { getFlagEmoji } from '@utils/flags';

interface InlineTripFormProps {
  defaultCountryCode?: string;
  onSubmit: (name: string, countryCode: string) => Promise<void>;
  onCancel: () => void;
  onError?: (error: string) => void;
  isSubmitting: boolean;
}

export function InlineTripForm({
  defaultCountryCode,
  onSubmit,
  onCancel,
  onError,
  isSubmitting,
}: InlineTripFormProps) {
  const [name, setName] = useState('');
  const [countryCode, setCountryCode] = useState(defaultCountryCode ?? '');
  const [showCountryPicker, setShowCountryPicker] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const { data: countries = [], isLoading: loadingCountries } = useCountries();

  const selectedCountry = useMemo(
    () => countries.find((c) => c.code === countryCode),
    [countries, countryCode]
  );

  const validateForm = useCallback((): boolean => {
    const newErrors: Record<string, string> = {};

    if (!name.trim()) {
      newErrors.name = 'Trip name is required';
    }

    if (!countryCode) {
      newErrors.country = 'Please select a country';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [name, countryCode]);

  const handleSubmit = useCallback(async () => {
    if (!validateForm()) return;

    try {
      await onSubmit(name.trim(), countryCode);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create trip';
      onError?.(message);
    }
  }, [validateForm, onSubmit, name, countryCode, onError]);

  const handleSelectCountry = useCallback(
    (code: string) => {
      setCountryCode(code);
      setShowCountryPicker(false);
      if (errors.country) {
        setErrors((prev) => ({ ...prev, country: '' }));
      }
    },
    [errors.country]
  );

  if (showCountryPicker) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => setShowCountryPicker(false)}>
            <Ionicons name="arrow-back" size={24} color={colors.midnightNavy} />
          </TouchableOpacity>
          <Text style={styles.title}>Select Country</Text>
          <View style={{ width: 24 }} />
        </View>

        {loadingCountries ? (
          <ActivityIndicator size="large" color={colors.sunsetGold} style={styles.loader} />
        ) : (
          <ScrollView
            style={styles.countryList}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {countries.map((country) => (
              <TouchableOpacity
                key={country.code}
                style={[
                  styles.countryItem,
                  countryCode === country.code && styles.countryItemSelected,
                ]}
                onPress={() => handleSelectCountry(country.code)}
                activeOpacity={0.7}
              >
                <Text style={styles.countryFlag}>{getFlagEmoji(country.code)}</Text>
                <Text
                  style={[
                    styles.countryName,
                    countryCode === country.code && styles.countryNameSelected,
                  ]}
                  numberOfLines={1}
                >
                  {country.name}
                </Text>
                {countryCode === country.code && (
                  <Ionicons name="checkmark-circle" size={20} color={colors.mossGreen} />
                )}
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Create New Trip</Text>

      {/* Trip Name */}
      <View style={styles.field}>
        <GlassInput
          label="TRIP NAME"
          placeholder="e.g., Summer in Italy"
          value={name}
          onChangeText={(text) => {
            setName(text);
            if (errors.name) setErrors((prev) => ({ ...prev, name: '' }));
          }}
          error={errors.name}
          autoFocus
          returnKeyType="next"
        />
      </View>

      {/* Country Selector */}
      <View style={styles.field}>
        <Text style={styles.label}>COUNTRY</Text>
        <Pressable
          style={[styles.countryButton, errors.country && styles.countryButtonError]}
          onPress={() => setShowCountryPicker(true)}
        >
          {selectedCountry ? (
            <View style={styles.selectedCountry}>
              <Text style={styles.countryFlag}>{getFlagEmoji(selectedCountry.code)}</Text>
              <Text style={styles.selectedCountryName}>{selectedCountry.name}</Text>
            </View>
          ) : (
            <Text style={styles.countryPlaceholder}>Select a country...</Text>
          )}
          <Ionicons name="chevron-forward" size={20} color={colors.stormGray} />
        </Pressable>
        {errors.country && <Text style={styles.errorText}>{errors.country}</Text>}
      </View>

      {/* Actions */}
      <View style={styles.actions}>
        <Button
          title="Create Trip"
          onPress={handleSubmit}
          loading={isSubmitting}
          disabled={isSubmitting}
        />
        <TouchableOpacity style={styles.cancelButton} onPress={onCancel} disabled={isSubmitting}>
          <Text style={styles.cancelButtonText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  title: {
    fontFamily: fonts.playfair.bold,
    fontSize: 22,
    color: colors.midnightNavy,
    textAlign: 'center',
    marginBottom: 20,
  },
  field: {
    marginBottom: 20,
  },
  label: {
    fontFamily: fonts.oswald.medium,
    fontSize: 12,
    color: colors.midnightNavy,
    marginBottom: 8,
    letterSpacing: 1.5,
    opacity: 0.7,
    textTransform: 'uppercase',
  },

  // Country Button
  countryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.6)',
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 52,
  },
  countryButtonError: {
    borderColor: colors.adobeBrick,
  },
  selectedCountry: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  countryFlag: {
    fontSize: 20,
  },
  selectedCountryName: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 16,
    color: colors.midnightNavy,
  },
  countryPlaceholder: {
    flex: 1,
    fontFamily: fonts.openSans.regular,
    fontSize: 16,
    color: colors.stormGray,
  },
  errorText: {
    fontSize: 13,
    color: colors.adobeBrick,
    marginTop: 6,
    marginLeft: 4,
    fontFamily: fonts.openSans.regular,
  },

  // Country List
  countryList: {
    maxHeight: 400,
  },
  countryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 10,
    marginBottom: 4,
    gap: 12,
  },
  countryItemSelected: {
    backgroundColor: 'rgba(84, 122, 95, 0.1)',
  },
  countryName: {
    flex: 1,
    fontFamily: fonts.openSans.regular,
    fontSize: 15,
    color: colors.midnightNavy,
  },
  countryNameSelected: {
    fontFamily: fonts.openSans.semiBold,
    color: colors.mossGreen,
  },
  loader: {
    marginTop: 40,
  },

  // Actions
  actions: {
    marginTop: 8,
  },
  cancelButton: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  cancelButtonText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 16,
    color: colors.stormGray,
  },
});
