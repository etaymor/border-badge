/**
 * Places autocomplete component with Google Places API integration.
 * Provides search functionality with fallback to manual entry.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { logger } from '@utils/logger';
import {
  type Prediction,
  type SelectedPlace,
  getPlaceDetails,
  getPhotoUrl,
  hasApiKey,
  searchPlaces,
  QuotaExceededError,
  NetworkError,
} from '@services/placesApi';

import { ManualEntryForm } from './ManualEntryForm';
import { NoResultsDropdown, PredictionsDropdown } from './PredictionsDropdown';
import { PlacesSearchInput } from './PlacesSearchInput';
import { SelectedPlaceDisplay } from './SelectedPlaceDisplay';

// Re-export types for backwards compatibility
export type { PlaceResult, SelectedPlace } from '@services/placesApi';

const DEBOUNCE_MS = 300;

interface PlacesAutocompleteProps {
  value?: SelectedPlace | null;
  onSelect: (place: SelectedPlace | null) => void;
  placeholder?: string;
  countryCode?: string;
  testID?: string;
  onDropdownOpen?: (isOpen: boolean) => void;
}

export function PlacesAutocomplete({
  value,
  onSelect,
  placeholder = 'Search for a place...',
  countryCode,
  testID = 'places-search',
  onDropdownOpen,
}: PlacesAutocompleteProps) {
  const [query, setQuery] = useState(value?.name ?? '');
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  // Combined state to prevent race conditions between show flag and initial name
  const [manualEntry, setManualEntry] = useState<{ show: boolean; initialName: string }>({
    show: false,
    initialName: '',
  });
  const [error, setError] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const inputRef = useRef<TextInput>(null);
  const hasSelectedRef = useRef(false);
  const pendingSelectionRef = useRef<string | null>(null);

  // Clear selection
  const handleClear = useCallback(() => {
    setQuery('');
    setPredictions([]);
    setShowDropdown(false);
    onDropdownOpen?.(false);
    setManualEntry({ show: false, initialName: '' });
    setError(null);
    hasSelectedRef.current = false;
    onSelect(null);
  }, [onSelect, onDropdownOpen]);

  // Handle text input change with debouncing
  const handleTextChange = useCallback(
    (text: string) => {
      setQuery(text);
      setError(null);
      hasSelectedRef.current = false;

      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }

      if (!text.trim()) {
        setPredictions([]);
        setShowDropdown(false);
        return;
      }

      debounceRef.current = setTimeout(async () => {
        abortControllerRef.current?.abort();
        abortControllerRef.current = new AbortController();

        setIsLoading(true);
        try {
          const results = await searchPlaces(text, countryCode, abortControllerRef.current.signal);
          if (!abortControllerRef.current.signal.aborted && !hasSelectedRef.current) {
            setPredictions(results);
            setShowDropdown(true);
            onDropdownOpen?.(true);
          }
        } catch (err) {
          if ((err as Error).name === 'AbortError') return;

          if (err instanceof QuotaExceededError) {
            setError('Places search unavailable. Enter details manually.');
            setManualEntry({ show: true, initialName: '' }); // Don't pre-fill from error state
            setShowDropdown(false);
            onDropdownOpen?.(false);
          } else if (err instanceof NetworkError) {
            setError('Connection error. Check your network or enter manually.');
            setShowDropdown(false);
            onDropdownOpen?.(false);
          }
        } finally {
          setIsLoading(false);
        }
      }, DEBOUNCE_MS);
    },
    [countryCode, onDropdownOpen]
  );

  // Handle prediction selection
  const handleSelectPrediction = useCallback(
    async (prediction: Prediction) => {
      const selectionId = prediction.place_id;
      pendingSelectionRef.current = selectionId;

      hasSelectedRef.current = true;
      setShowDropdown(false);
      onDropdownOpen?.(false);
      setPredictions([]);
      Keyboard.dismiss();

      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      abortControllerRef.current?.abort();

      setIsLoading(true);

      try {
        const details = await getPlaceDetails(prediction.place_id);

        if (pendingSelectionRef.current !== selectionId) {
          return;
        }

        if (details) {
          // Get the first photo URL if available
          const firstPhoto = details.photos?.[0];
          const googlePhotoUrl = firstPhoto ? getPhotoUrl(firstPhoto.name) : null;

          const selectedPlace: SelectedPlace = {
            google_place_id: details.place_id,
            name: details.name,
            address: details.formatted_address ?? null,
            latitude: details.geometry?.location.lat ?? null,
            longitude: details.geometry?.location.lng ?? null,
            google_photo_url: googlePhotoUrl,
            website_url: details.website_uri ?? null,
            country_code: details.country_code ?? null,
          };

          setQuery(details.name);
          onSelect(selectedPlace);
        } else {
          const selectedPlace: SelectedPlace = {
            google_place_id: prediction.place_id,
            name: prediction.structured_formatting.main_text,
            address: prediction.structured_formatting.secondary_text ?? null,
            latitude: null,
            longitude: null,
            google_photo_url: null,
            website_url: null,
            country_code: null,
          };

          setQuery(prediction.structured_formatting.main_text);
          onSelect(selectedPlace);
        }
      } catch (err) {
        if (pendingSelectionRef.current !== selectionId) {
          return;
        }

        logger.error('Error fetching place details:', err);
        const selectedPlace: SelectedPlace = {
          google_place_id: prediction.place_id,
          name: prediction.structured_formatting.main_text,
          address: prediction.structured_formatting.secondary_text ?? null,
          latitude: null,
          longitude: null,
          google_photo_url: null,
          website_url: null,
          country_code: null,
        };

        setQuery(prediction.structured_formatting.main_text);
        onSelect(selectedPlace);
      } finally {
        if (pendingSelectionRef.current === selectionId) {
          setIsLoading(false);
        }
      }
    },
    [onSelect, onDropdownOpen]
  );

  // Handle manual entry submission
  const handleManualSubmit = useCallback(
    (place: SelectedPlace) => {
      hasSelectedRef.current = true;
      setQuery(place.name);
      setManualEntry({ show: false, initialName: '' });
      onSelect(place);
    },
    [onSelect]
  );

  // Handle switching to manual entry mode
  const handleManualEntry = useCallback(() => {
    setShowDropdown(false);
    setManualEntry({ show: true, initialName: query }); // Pre-fill when user clicks "Enter manually"
  }, [query]);

  // Handle input focus
  const handleInputFocus = useCallback(() => {
    if (query.length > 0 && predictions.length > 0 && !value && !hasSelectedRef.current) {
      setShowDropdown(true);
    }
  }, [query, predictions.length, value]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      abortControllerRef.current?.abort();
    };
  }, []);

  // Sync value prop changes - use functional update to avoid stale closure issues
  useEffect(() => {
    console.log('[PlacesAutocomplete] Sync effect triggered', {
      value,
      valueName: value?.name,
      valueGooglePlaceId: value?.google_place_id,
    });

    const newQuery = value?.name ?? '';
    // Use functional update to get current query value and avoid stale closure
    setQuery((currentQuery) => {
      console.log('[PlacesAutocomplete] setQuery comparison', {
        newQuery,
        currentQuery,
        willUpdate: newQuery !== currentQuery,
      });
      if (newQuery !== currentQuery) {
        return newQuery;
      }
      return currentQuery;
    });
    hasSelectedRef.current = !!value;
    // Close dropdown when a value is set externally
    if (value) {
      setShowDropdown(false);
    }
  }, [value]);

  // Manual entry form
  if (manualEntry.show) {
    return (
      <ManualEntryForm
        initialName={manualEntry.initialName}
        onSubmit={handleManualSubmit}
        onCancel={() => setManualEntry({ show: false, initialName: '' })}
        testID={testID}
      />
    );
  }

  return (
    <View style={styles.container}>
      {/* Search Input */}
      <PlacesSearchInput
        ref={inputRef}
        value={query}
        onChangeText={handleTextChange}
        onClear={handleClear}
        onFocus={handleInputFocus}
        isLoading={isLoading}
        placeholder={placeholder}
        testID={testID}
      />

      {/* Error Message */}
      {error && <Text style={styles.errorText}>{error}</Text>}

      {/* Manual Entry Link */}
      {!showDropdown && !value && !hasApiKey() && (
        <Pressable onPress={handleManualEntry}>
          <Text style={styles.manualLink}>Enter place manually</Text>
        </Pressable>
      )}

      {/* Selected Place Display */}
      {value && !showDropdown && <SelectedPlaceDisplay place={value} />}

      {/* Predictions Dropdown */}
      {showDropdown && predictions.length > 0 && (
        <PredictionsDropdown
          predictions={predictions}
          onSelectPrediction={handleSelectPrediction}
          onManualEntry={handleManualEntry}
          testID={testID}
        />
      )}

      {/* No Results */}
      {showDropdown && predictions.length === 0 && query.length > 2 && !isLoading && (
        <NoResultsDropdown onManualEntry={handleManualEntry} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    zIndex: 2000, // Ensure dropdown appears above other content
  },
  errorText: {
    fontSize: 13,
    color: colors.adobeBrick,
    marginTop: 6,
    marginLeft: 4,
    fontFamily: fonts.openSans.regular,
  },
  manualLink: {
    fontSize: 14,
    color: colors.adobeBrick,
    marginTop: 8,
    marginLeft: 4,
    fontFamily: fonts.openSans.semiBold,
  },
});
