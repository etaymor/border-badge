import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import Constants from 'expo-constants';

import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';

const GOOGLE_PLACES_API_KEY = Constants.expoConfig?.extra?.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY ?? '';

// Types for place data
export interface PlaceResult {
  place_id: string;
  name: string;
  formatted_address: string;
  geometry?: {
    location: {
      lat: number;
      lng: number;
    };
  };
}

export interface SelectedPlace {
  google_place_id: string;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
}

interface PlacesAutocompleteProps {
  value?: SelectedPlace | null;
  onSelect: (place: SelectedPlace | null) => void;
  placeholder?: string;
  countryCode?: string; // ISO 3166-1 alpha-2 country code for biasing results
  testID?: string;
}

interface Prediction {
  place_id: string;
  description: string;
  structured_formatting: {
    main_text: string;
    secondary_text: string;
  };
}

const DEBOUNCE_MS = 300;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 500;

// Helper to delay execution
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function searchPlaces(
  query: string,
  countryCode?: string,
  signal?: AbortSignal,
  retryCount = 0
): Promise<Prediction[]> {
  if (!GOOGLE_PLACES_API_KEY || !query.trim()) {
    return [];
  }

  // Use the new Places API (New) endpoint
  const url = 'https://places.googleapis.com/v1/places:autocomplete';
  const body: Record<string, unknown> = {
    input: query,
    includedPrimaryTypes: ['establishment'],
  };

  if (countryCode) {
    body.includedRegionCodes = [countryCode.toLowerCase()];
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
      },
      body: JSON.stringify(body),
      signal,
    });

    // New API uses HTTP status codes for errors
    if (!response.ok) {
      if (response.status === 403 || response.status === 429) {
        throw new Error('QUOTA_EXCEEDED');
      }
      if (retryCount < MAX_RETRIES && !signal?.aborted) {
        await delay(RETRY_DELAY_MS * (retryCount + 1));
        return searchPlaces(query, countryCode, signal, retryCount + 1);
      }
      console.warn(`Places API returned status ${response.status} after ${MAX_RETRIES} retries`);
      return [];
    }

    const data = await response.json();

    // New API returns suggestions array directly
    const suggestions = data.suggestions ?? [];
    return suggestions
      .filter((s: { placePrediction?: unknown }) => s.placePrediction)
      .map(
        (s: {
          placePrediction: {
            placeId: string;
            text?: { text: string };
            structuredFormat?: {
              mainText?: { text: string };
              secondaryText?: { text: string };
            };
          };
        }) => ({
          place_id: s.placePrediction.placeId,
          description: s.placePrediction.text?.text ?? '',
          structured_formatting: {
            main_text: s.placePrediction.structuredFormat?.mainText?.text ?? '',
            secondary_text: s.placePrediction.structuredFormat?.secondaryText?.text ?? '',
          },
        })
      );
  } catch (error) {
    // Silently ignore aborted requests
    if ((error as Error).name === 'AbortError') {
      return [];
    }

    if ((error as Error).message === 'QUOTA_EXCEEDED') {
      throw error;
    }

    // Retry network errors (unless aborted)
    if (retryCount < MAX_RETRIES && !signal?.aborted) {
      console.warn(`Places fetch failed, retrying (${retryCount + 1}/${MAX_RETRIES})...`);
      await delay(RETRY_DELAY_MS * (retryCount + 1));
      return searchPlaces(query, countryCode, signal, retryCount + 1);
    }

    console.error('Places autocomplete error after retries:', error);
    throw new Error('NETWORK_ERROR');
  }
}

async function getPlaceDetails(placeId: string): Promise<PlaceResult | null> {
  if (!GOOGLE_PLACES_API_KEY) {
    return null;
  }

  // Use the new Places API (New) endpoint
  const url = `https://places.googleapis.com/v1/places/${placeId}`;

  try {
    const response = await fetch(url, {
      headers: {
        'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
        'X-Goog-FieldMask': 'id,displayName,formattedAddress,location',
      },
    });

    if (!response.ok) {
      console.error('Place details API error:', response.status);
      return null;
    }

    const data = await response.json();

    // Transform new API response to match expected PlaceResult format
    return {
      place_id: data.id,
      name: data.displayName?.text ?? '',
      formatted_address: data.formattedAddress ?? '',
      geometry: data.location
        ? {
            location: {
              lat: data.location.latitude,
              lng: data.location.longitude,
            },
          }
        : undefined,
    };
  } catch (error) {
    console.error('Place details error:', error);
    return null;
  }
}

export function PlacesAutocomplete({
  value,
  onSelect,
  placeholder = 'Search for a place...',
  countryCode,
  testID = 'places-search',
}: PlacesAutocompleteProps) {
  const [query, setQuery] = useState(value?.name ?? '');
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [manualName, setManualName] = useState('');
  const [manualAddress, setManualAddress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isFocused, setIsFocused] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const inputRef = useRef<TextInput>(null);
  // Track when a selection was just made to prevent dropdown from reopening on focus
  const hasSelectedRef = useRef(false);

  // Clear selection
  const handleClear = useCallback(() => {
    setQuery('');
    setPredictions([]);
    setShowDropdown(false);
    setShowManualEntry(false);
    setError(null);
    hasSelectedRef.current = false;
    onSelect(null);
  }, [onSelect]);

  // Handle text input change with debouncing
  const handleTextChange = useCallback(
    (text: string) => {
      setQuery(text);
      setError(null);
      // User is typing, so clear the selection state to allow dropdown to show
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
        // Cancel any in-flight request before starting a new one
        abortControllerRef.current?.abort();
        abortControllerRef.current = new AbortController();

        setIsLoading(true);
        try {
          const results = await searchPlaces(text, countryCode, abortControllerRef.current.signal);
          // Only update if this request wasn't aborted and user hasn't selected a place
          if (!abortControllerRef.current.signal.aborted && !hasSelectedRef.current) {
            setPredictions(results);
            setShowDropdown(true);
          }
        } catch (err) {
          // Ignore aborted requests
          if ((err as Error).name === 'AbortError') return;

          const errorMessage = (err as Error).message;
          if (errorMessage === 'QUOTA_EXCEEDED') {
            setError('Places search unavailable. Enter details manually.');
            setShowManualEntry(true);
            setShowDropdown(false);
          } else if (errorMessage === 'NETWORK_ERROR') {
            setError('Connection error. Check your network or enter manually.');
            setShowDropdown(false);
          }
        } finally {
          setIsLoading(false);
        }
      }, DEBOUNCE_MS);
    },
    [countryCode]
  );

  // Handle prediction selection
  const handleSelectPrediction = useCallback(
    async (prediction: Prediction) => {
      // Mark that we've selected to prevent dropdown from reopening
      hasSelectedRef.current = true;
      // Immediately hide dropdown and clear predictions BEFORE any async work
      setShowDropdown(false);
      setPredictions([]);
      Keyboard.dismiss();

      // Cancel any pending search requests
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      abortControllerRef.current?.abort();

      setIsLoading(true);

      try {
        const details = await getPlaceDetails(prediction.place_id);

        if (details) {
          const selectedPlace: SelectedPlace = {
            google_place_id: details.place_id,
            name: details.name,
            address: details.formatted_address ?? null,
            latitude: details.geometry?.location.lat ?? null,
            longitude: details.geometry?.location.lng ?? null,
          };

          setQuery(details.name);
          onSelect(selectedPlace);
        } else {
          // Fallback: use prediction data without coordinates
          const selectedPlace: SelectedPlace = {
            google_place_id: prediction.place_id,
            name: prediction.structured_formatting.main_text,
            address: prediction.structured_formatting.secondary_text ?? null,
            latitude: null,
            longitude: null,
          };

          setQuery(prediction.structured_formatting.main_text);
          onSelect(selectedPlace);
        }
      } catch (err) {
        console.error('Error fetching place details:', err);
        // Fallback: use prediction data
        const selectedPlace: SelectedPlace = {
          google_place_id: prediction.place_id,
          name: prediction.structured_formatting.main_text,
          address: prediction.structured_formatting.secondary_text ?? null,
          latitude: null,
          longitude: null,
        };

        setQuery(prediction.structured_formatting.main_text);
        onSelect(selectedPlace);
      } finally {
        setIsLoading(false);
      }
    },
    [onSelect]
  );

  // Handle manual entry submission
  const handleManualSubmit = useCallback(() => {
    if (!manualName.trim()) return;

    const selectedPlace: SelectedPlace = {
      google_place_id: `manual_${Date.now()}`,
      name: manualName.trim(),
      address: manualAddress.trim() || null,
      latitude: null,
      longitude: null,
    };

    hasSelectedRef.current = true;
    setQuery(manualName.trim());
    setShowManualEntry(false);
    onSelect(selectedPlace);
    Keyboard.dismiss();
  }, [manualName, manualAddress, onSelect]);

  // Cleanup debounce and abort pending requests on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      abortControllerRef.current?.abort();
    };
  }, []);

  // Sync value prop changes
  useEffect(() => {
    if (value?.name !== query) {
      setQuery(value?.name ?? '');
    }
    // Sync hasSelectedRef with value prop
    hasSelectedRef.current = !!value;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value?.name]);

  // Manual entry form
  if (showManualEntry) {
    return (
      <View style={styles.manualContainer}>
        <View style={styles.manualHeader}>
          <Text style={styles.manualTitle}>Enter Place Details</Text>
          <Pressable onPress={() => setShowManualEntry(false)}>
            <Ionicons name="close" size={24} color={colors.textSecondary} />
          </Pressable>
        </View>

        <View style={styles.manualInputWrapper}>
          <BlurView intensity={40} tint="light" style={styles.manualInputBlur}>
            <TextInput
              style={styles.manualInput}
              placeholder="Place name *"
              placeholderTextColor={colors.textTertiary}
              value={manualName}
              onChangeText={setManualName}
              returnKeyType="next"
              testID={`${testID}-manual-name`}
            />
          </BlurView>
        </View>

        <View style={styles.manualInputWrapper}>
          <BlurView intensity={40} tint="light" style={styles.manualInputBlur}>
            <TextInput
              style={styles.manualInput}
              placeholder="Address (optional)"
              placeholderTextColor={colors.textTertiary}
              value={manualAddress}
              onChangeText={setManualAddress}
              returnKeyType="done"
              onSubmitEditing={handleManualSubmit}
              testID={`${testID}-manual-address`}
            />
          </BlurView>
        </View>

        <Pressable
          style={[styles.manualButton, !manualName.trim() && styles.manualButtonDisabled]}
          onPress={handleManualSubmit}
          disabled={!manualName.trim()}
          testID={`${testID}-manual-submit`}
        >
          <Text style={styles.manualButtonText}>Add Place</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Input Field with Glass Effect */}
      <View style={[styles.inputWrapper, isFocused && styles.inputWrapperFocused]}>
        <BlurView
          intensity={40}
          tint="light"
          style={[styles.inputBlur, isFocused && styles.inputBlurFocused]}
        >
          <View style={styles.inputContainer}>
            <Ionicons name="search" size={18} color={colors.stormGray} style={styles.searchIcon} />
            <TextInput
              ref={inputRef}
              style={styles.textInput}
              placeholder={placeholder}
              placeholderTextColor={colors.textTertiary}
              value={query}
              onChangeText={handleTextChange}
              onFocus={() => {
                setIsFocused(true);
                // Only show dropdown if we have predictions AND no place is currently selected
                // Also check hasSelectedRef to prevent reopening immediately after selection
                if (
                  query.length > 0 &&
                  predictions.length > 0 &&
                  !value &&
                  !hasSelectedRef.current
                ) {
                  setShowDropdown(true);
                }
              }}
              onBlur={() => setIsFocused(false)}
              returnKeyType="search"
              testID={`${testID}-input`}
            />
            {isLoading && (
              <ActivityIndicator size="small" color={colors.sunsetGold} style={styles.loader} />
            )}
            {!isLoading && query.length > 0 && (
              <Pressable onPress={handleClear} hitSlop={8}>
                <Ionicons name="close-circle" size={20} color={colors.stormGray} />
              </Pressable>
            )}
          </View>
        </BlurView>
      </View>

      {/* Error Message */}
      {error && <Text style={styles.errorText}>{error}</Text>}

      {/* Manual Entry Link */}
      {!showDropdown && !value && !GOOGLE_PLACES_API_KEY && (
        <Pressable onPress={() => setShowManualEntry(true)}>
          <Text style={styles.manualLink}>Enter place manually</Text>
        </Pressable>
      )}

      {/* Selected Place Display */}
      {value && !showDropdown && (
        <View style={styles.selectedPlace}>
          <Ionicons name="location" size={16} color={colors.adobeBrick} />
          <Text style={styles.selectedPlaceName} numberOfLines={1}>
            {value.name}
          </Text>
          {value.address && (
            <Text style={styles.selectedPlaceAddress} numberOfLines={1}>
              {value.address}
            </Text>
          )}
        </View>
      )}

      {/* Dropdown */}
      {showDropdown && predictions.length > 0 && (
        <View style={styles.dropdown} testID={`${testID}-dropdown`}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
            style={styles.predictionsList}
          >
            {predictions.map((item) => (
              <Pressable
                key={item.place_id}
                style={styles.predictionItem}
                onPress={() => handleSelectPrediction(item)}
              >
                <Ionicons
                  name="location-outline"
                  size={20}
                  color={colors.adobeBrick}
                  style={styles.predictionIcon}
                />
                <View style={styles.predictionText}>
                  <Text style={styles.predictionMain} numberOfLines={1}>
                    {item.structured_formatting.main_text}
                  </Text>
                  <Text style={styles.predictionSecondary} numberOfLines={1}>
                    {item.structured_formatting.secondary_text}
                  </Text>
                </View>
              </Pressable>
            ))}
          </ScrollView>
          <Pressable
            style={styles.manualEntryButton}
            testID="manual-entry-button"
            onPress={() => {
              setShowDropdown(false);
              setManualName(query);
              setShowManualEntry(true);
            }}
          >
            <Ionicons name="create-outline" size={18} color={colors.adobeBrick} />
            <Text style={styles.manualEntryText}>Enter manually instead</Text>
          </Pressable>
        </View>
      )}

      {/* No Results */}
      {showDropdown && predictions.length === 0 && query.length > 2 && !isLoading && (
        <View style={styles.dropdown}>
          <View style={styles.noResults}>
            <Text style={styles.noResultsText}>No places found</Text>
          </View>
          <Pressable
            style={styles.manualEntryButton}
            testID="manual-entry-button"
            onPress={() => {
              setShowDropdown(false);
              setManualName(query);
              setShowManualEntry(true);
            }}
          >
            <Ionicons name="create-outline" size={18} color={colors.adobeBrick} />
            <Text style={styles.manualEntryText}>Enter manually</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    zIndex: 100,
  },
  inputWrapper: {
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.6)',
    shadowColor: colors.midnightNavy,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  inputWrapperFocused: {
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  inputBlur: {
    minHeight: 48,
    backgroundColor: 'rgba(255, 255, 255, 0.7)',
  },
  inputBlurFocused: {
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    minHeight: 48,
  },
  searchIcon: {
    marginRight: 10,
    opacity: 0.7,
  },
  textInput: {
    flex: 1,
    fontSize: 16,
    fontFamily: fonts.openSans.regular,
    color: colors.textPrimary,
    paddingVertical: 12,
  },
  loader: {
    marginLeft: 8,
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
  selectedPlace: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    paddingHorizontal: 4,
  },
  selectedPlaceName: {
    fontSize: 14,
    fontFamily: fonts.openSans.semiBold,
    color: colors.midnightNavy,
    marginLeft: 6,
  },
  selectedPlaceAddress: {
    fontSize: 13,
    fontFamily: fonts.openSans.regular,
    color: colors.textSecondary,
    marginLeft: 8,
    flex: 1,
  },
  dropdown: {
    position: 'absolute',
    top: 56,
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    borderRadius: 12,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
    maxHeight: 300,
    zIndex: 1000,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.05)',
  },
  predictionsList: {
    maxHeight: 250,
  },
  predictionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.05)',
  },
  predictionIcon: {
    marginRight: 12,
  },
  predictionText: {
    flex: 1,
  },
  predictionMain: {
    fontSize: 15,
    fontFamily: fonts.openSans.semiBold,
    color: colors.midnightNavy,
  },
  predictionSecondary: {
    fontSize: 13,
    fontFamily: fonts.openSans.regular,
    color: colors.textSecondary,
    marginTop: 2,
  },
  manualEntryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.05)',
    gap: 6,
  },
  manualEntryText: {
    fontSize: 14,
    color: colors.adobeBrick,
    fontFamily: fonts.openSans.semiBold,
  },
  noResults: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  noResultsText: {
    fontSize: 14,
    fontFamily: fonts.openSans.regular,
    color: colors.textSecondary,
  },
  manualContainer: {
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    borderRadius: 12,
    padding: 16,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  manualHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  manualTitle: {
    fontSize: 16,
    fontFamily: fonts.playfair.bold,
    color: colors.midnightNavy,
  },
  manualInputWrapper: {
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.6)',
  },
  manualInputBlur: {
    minHeight: 48,
    backgroundColor: 'rgba(255, 255, 255, 0.7)',
  },
  manualInput: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    fontFamily: fonts.openSans.regular,
    color: colors.textPrimary,
  },
  manualButton: {
    backgroundColor: colors.sunsetGold,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  manualButtonDisabled: {
    backgroundColor: colors.backgroundMuted,
  },
  manualButtonText: {
    fontSize: 16,
    fontFamily: fonts.openSans.semiBold,
    color: colors.midnightNavy,
  },
});
