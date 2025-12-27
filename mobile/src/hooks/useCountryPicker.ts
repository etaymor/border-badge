import { useCallback, useMemo, useState } from 'react';
import { Keyboard } from 'react-native';

import type { Country } from './useCountries';
import { useCountries } from './useCountries';

export interface UseCountryPickerOptions {
  initialCountryCode?: string | null;
}

export interface UseCountryPickerResult {
  // Search state
  countrySearch: string;
  setCountrySearch: (value: string) => void;
  showDropdown: boolean;
  setShowDropdown: (value: boolean) => void;

  // Selected country
  selectedCountryCode: string | null;
  selectedCountry: Country | null;

  // Filtered results
  filteredCountries: Country[];

  // Loading state
  isLoading: boolean;

  // Actions
  handleSelectCountry: (country: Country) => void;
  clearSelection: () => void;
}

/**
 * Hook for managing country picker state and logic.
 * Handles search, filtering, and selection of countries.
 */
export function useCountryPicker(
  options: UseCountryPickerOptions = {}
): UseCountryPickerResult {
  const { initialCountryCode = null } = options;

  // State
  const [countrySearch, setCountrySearch] = useState('');
  const [selectedCountryCode, setSelectedCountryCode] = useState<string | null>(
    initialCountryCode
  );
  const [showDropdown, setShowDropdown] = useState(false);

  // Fetch countries
  const { data: countries, isLoading } = useCountries();

  // Filter countries based on search
  const filteredCountries = useMemo(() => {
    if (!countries || !countrySearch) return [];
    const query = countrySearch.toLowerCase();
    return countries
      .filter(
        (c) =>
          c.name.toLowerCase().includes(query) ||
          c.code.toLowerCase().includes(query)
      )
      .slice(0, 10);
  }, [countries, countrySearch]);

  // Get selected country object
  const selectedCountry = useMemo(() => {
    if (!selectedCountryCode || !countries) return null;
    return countries.find((c) => c.code === selectedCountryCode) || null;
  }, [selectedCountryCode, countries]);

  // Handle country selection
  const handleSelectCountry = useCallback((country: Country) => {
    setSelectedCountryCode(country.code);
    setCountrySearch('');
    setShowDropdown(false);
    Keyboard.dismiss();
  }, []);

  // Clear selection
  const clearSelection = useCallback(() => {
    setSelectedCountryCode(null);
    setCountrySearch('');
  }, []);

  return {
    countrySearch,
    setCountrySearch,
    showDropdown,
    setShowDropdown,
    selectedCountryCode,
    selectedCountry,
    filteredCountries,
    isLoading,
    handleSelectCountry,
    clearSelection,
  };
}
