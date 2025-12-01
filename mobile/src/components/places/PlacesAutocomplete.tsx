import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';

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

async function searchPlaces(query: string, countryCode?: string): Promise<Prediction[]> {
  if (!GOOGLE_PLACES_API_KEY || !query.trim()) {
    return [];
  }

  const params = new URLSearchParams({
    input: query,
    key: GOOGLE_PLACES_API_KEY,
    types: 'establishment',
  });

  if (countryCode) {
    params.append('components', `country:${countryCode.toLowerCase()}`);
  }

  const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?${params.toString()}`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (data.status === 'OK') {
      return data.predictions ?? [];
    }

    if (data.status === 'OVER_QUERY_LIMIT' || data.status === 'REQUEST_DENIED') {
      throw new Error('QUOTA_EXCEEDED');
    }

    return [];
  } catch (error) {
    if ((error as Error).message === 'QUOTA_EXCEEDED') {
      throw error;
    }
    console.error('Places autocomplete error:', error);
    return [];
  }
}

async function getPlaceDetails(placeId: string): Promise<PlaceResult | null> {
  if (!GOOGLE_PLACES_API_KEY) {
    return null;
  }

  const params = new URLSearchParams({
    place_id: placeId,
    key: GOOGLE_PLACES_API_KEY,
    fields: 'place_id,name,formatted_address,geometry',
  });

  const url = `https://maps.googleapis.com/maps/api/place/details/json?${params.toString()}`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (data.status === 'OK' && data.result) {
      return data.result;
    }

    return null;
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
}: PlacesAutocompleteProps) {
  const [query, setQuery] = useState(value?.name ?? '');
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [manualName, setManualName] = useState('');
  const [manualAddress, setManualAddress] = useState('');
  const [error, setError] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<TextInput>(null);

  // Clear selection
  const handleClear = useCallback(() => {
    setQuery('');
    setPredictions([]);
    setShowDropdown(false);
    setShowManualEntry(false);
    setError(null);
    onSelect(null);
  }, [onSelect]);

  // Handle text input change with debouncing
  const handleTextChange = useCallback(
    (text: string) => {
      setQuery(text);
      setError(null);

      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }

      if (!text.trim()) {
        setPredictions([]);
        setShowDropdown(false);
        return;
      }

      debounceRef.current = setTimeout(async () => {
        setIsLoading(true);
        try {
          const results = await searchPlaces(text, countryCode);
          setPredictions(results);
          setShowDropdown(true);
        } catch (err) {
          if ((err as Error).message === 'QUOTA_EXCEEDED') {
            setError('Places search unavailable. Enter details manually.');
            setShowManualEntry(true);
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
      Keyboard.dismiss();
      setShowDropdown(false);
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

    setQuery(manualName.trim());
    setShowManualEntry(false);
    onSelect(selectedPlace);
    Keyboard.dismiss();
  }, [manualName, manualAddress, onSelect]);

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  // Sync value prop changes
  useEffect(() => {
    if (value?.name !== query) {
      setQuery(value?.name ?? '');
    }
  }, [value?.name]);

  // Render prediction item
  const renderPrediction = useCallback(
    ({ item }: { item: Prediction }) => (
      <Pressable style={styles.predictionItem} onPress={() => handleSelectPrediction(item)}>
        <Ionicons name="location-outline" size={20} color="#666" style={styles.predictionIcon} />
        <View style={styles.predictionText}>
          <Text style={styles.predictionMain} numberOfLines={1}>
            {item.structured_formatting.main_text}
          </Text>
          <Text style={styles.predictionSecondary} numberOfLines={1}>
            {item.structured_formatting.secondary_text}
          </Text>
        </View>
      </Pressable>
    ),
    [handleSelectPrediction]
  );

  // Manual entry form
  if (showManualEntry) {
    return (
      <View style={styles.manualContainer}>
        <View style={styles.manualHeader}>
          <Text style={styles.manualTitle}>Enter Place Details</Text>
          <Pressable onPress={() => setShowManualEntry(false)}>
            <Ionicons name="close" size={24} color="#666" />
          </Pressable>
        </View>

        <TextInput
          style={styles.input}
          placeholder="Place name *"
          value={manualName}
          onChangeText={setManualName}
          returnKeyType="next"
        />

        <TextInput
          style={styles.input}
          placeholder="Address (optional)"
          value={manualAddress}
          onChangeText={setManualAddress}
          returnKeyType="done"
          onSubmitEditing={handleManualSubmit}
        />

        <Pressable
          style={[styles.manualButton, !manualName.trim() && styles.manualButtonDisabled]}
          onPress={handleManualSubmit}
          disabled={!manualName.trim()}
        >
          <Text style={styles.manualButtonText}>Add Place</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Input Field */}
      <View style={styles.inputContainer}>
        <Ionicons name="search" size={20} color="#999" style={styles.searchIcon} />
        <TextInput
          ref={inputRef}
          style={styles.textInput}
          placeholder={placeholder}
          value={query}
          onChangeText={handleTextChange}
          onFocus={() => query.length > 0 && predictions.length > 0 && setShowDropdown(true)}
          returnKeyType="search"
        />
        {isLoading && <ActivityIndicator size="small" color="#007AFF" style={styles.loader} />}
        {!isLoading && query.length > 0 && (
          <Pressable onPress={handleClear} hitSlop={8}>
            <Ionicons name="close-circle" size={20} color="#999" />
          </Pressable>
        )}
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
          <Ionicons name="location" size={16} color="#007AFF" />
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
        <View style={styles.dropdown}>
          <FlatList
            data={predictions}
            keyExtractor={(item) => item.place_id}
            renderItem={renderPrediction}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
          />
          <Pressable
            style={styles.manualEntryButton}
            onPress={() => {
              setShowDropdown(false);
              setManualName(query);
              setShowManualEntry(true);
            }}
          >
            <Ionicons name="create-outline" size={18} color="#007AFF" />
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
            onPress={() => {
              setShowDropdown(false);
              setManualName(query);
              setShowManualEntry(true);
            }}
          >
            <Ionicons name="create-outline" size={18} color="#007AFF" />
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
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 48,
  },
  searchIcon: {
    marginRight: 8,
  },
  textInput: {
    flex: 1,
    fontSize: 16,
    color: '#1a1a1a',
  },
  loader: {
    marginLeft: 8,
  },
  errorText: {
    fontSize: 13,
    color: '#FF3B30',
    marginTop: 6,
    marginLeft: 4,
  },
  manualLink: {
    fontSize: 14,
    color: '#007AFF',
    marginTop: 8,
    marginLeft: 4,
  },
  selectedPlace: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    paddingHorizontal: 4,
  },
  selectedPlaceName: {
    fontSize: 14,
    fontWeight: '500',
    color: '#1a1a1a',
    marginLeft: 6,
  },
  selectedPlaceAddress: {
    fontSize: 13,
    color: '#666',
    marginLeft: 8,
    flex: 1,
  },
  dropdown: {
    position: 'absolute',
    top: 52,
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    borderRadius: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
    maxHeight: 300,
    zIndex: 1000,
  },
  predictionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  predictionIcon: {
    marginRight: 12,
  },
  predictionText: {
    flex: 1,
  },
  predictionMain: {
    fontSize: 15,
    fontWeight: '500',
    color: '#1a1a1a',
  },
  predictionSecondary: {
    fontSize: 13,
    color: '#666',
    marginTop: 2,
  },
  manualEntryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
    gap: 6,
  },
  manualEntryText: {
    fontSize: 14,
    color: '#007AFF',
    fontWeight: '500',
  },
  noResults: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  noResultsText: {
    fontSize: 14,
    color: '#999',
  },
  manualContainer: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
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
    fontWeight: '600',
    color: '#1a1a1a',
  },
  input: {
    backgroundColor: '#f5f5f5',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    marginBottom: 12,
  },
  manualButton: {
    backgroundColor: '#007AFF',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  manualButtonDisabled: {
    backgroundColor: '#ccc',
  },
  manualButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
});
