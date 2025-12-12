import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { TripsStackScreenProps } from '@navigation/types';
import type { EntryType } from '@navigation/types';
import {
  useCreateEntry,
  useUpdateEntry,
  useEntry,
  CreateEntryInput,
  PlaceInput,
} from '@hooks/useEntries';
import { useTrip } from '@hooks/useTrips';
import { EntryMediaGallery } from '@components/media';
import { PlacesAutocomplete, SelectedPlace } from '@components/places';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';

type Props = TripsStackScreenProps<'EntryForm'>;

// Entry type configuration
const ENTRY_TYPES: {
  type: EntryType;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  color: string;
}[] = [
  { type: 'place', icon: 'location', label: 'Place', color: '#007AFF' },
  { type: 'food', icon: 'restaurant', label: 'Food', color: '#FF9500' },
  { type: 'stay', icon: 'bed', label: 'Stay', color: '#5856D6' },
  { type: 'experience', icon: 'star', label: 'Experience', color: '#34C759' },
];

export function EntryFormScreen({ route, navigation }: Props) {
  const { tripId, entryId, entryType: initialEntryType } = route.params;
  const isEditing = !!entryId;
  const insets = useSafeAreaInsets();

  // Fetch existing entry data for editing
  const { data: existingEntry, isLoading: isLoadingEntry } = useEntry(entryId ?? '');
  // Fetch trip to get country code for scoping place search
  const { data: trip } = useTrip(tripId);
  const createEntry = useCreateEntry();
  const updateEntry = useUpdateEntry();

  // Form state
  const [entryType, setEntryType] = useState<EntryType | null>(initialEntryType ?? null);
  const [hasSelectedType, setHasSelectedType] = useState(!!initialEntryType || isEditing);
  const [title, setTitle] = useState('');
  const [link, setLink] = useState('');
  const [notes, setNotes] = useState('');
  const [selectedPlace, setSelectedPlace] = useState<SelectedPlace | null>(null);
  const [pendingMediaIds, setPendingMediaIds] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Reset form when navigating to a new entry (different trip or creating new)
  useEffect(() => {
    if (!isEditing) {
      setTitle('');
      setEntryType(initialEntryType ?? null);
      setHasSelectedType(!!initialEntryType);
      setLink('');
      setNotes('');
      setSelectedPlace(null);
      setPendingMediaIds([]);
      setErrors({});
    }
  }, [tripId, entryId, isEditing, initialEntryType]);

  // Populate form when editing
  useEffect(() => {
    if (existingEntry && isEditing) {
      setTitle(existingEntry.title);
      setEntryType(existingEntry.entry_type as EntryType);
      setHasSelectedType(true);
      setNotes(existingEntry.notes ?? '');
      setLink(existingEntry.link ?? '');
      if (existingEntry.place) {
        setSelectedPlace({
          google_place_id:
            existingEntry.place.google_place_id ?? `existing_${existingEntry.place.id}`,
          name: existingEntry.place.name,
          address: existingEntry.place.address,
          latitude: existingEntry.place.latitude,
          longitude: existingEntry.place.longitude,
        });
      }
    }
  }, [existingEntry, isEditing]);

  // Set header title
  useEffect(() => {
    // We are handling the title in the body now for better styling control
    navigation.setOptions({
      title: '', // Clear default title
      headerShadowVisible: false,
      headerStyle: { backgroundColor: colors.warmCream },
    });
  }, [navigation, isEditing]);

  // Simple URL validation
  const isValidUrl = useCallback((url: string): boolean => {
    if (!url.trim()) return true; // Empty is valid (optional field)
    try {
      const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }, []);

  const validateForm = useCallback((): boolean => {
    const newErrors: Record<string, string> = {};

    if (!entryType) {
      newErrors.type = 'Please select an entry type';
    }

    // Place is required for place, food, and stay types
    const requiresPlace = entryType && ['place', 'food', 'stay'].includes(entryType);
    if (requiresPlace && !selectedPlace) {
      newErrors.place = 'Please select or enter a location';
    }

    // Title is only required when no place is selected (for "experience" type)
    if (!selectedPlace && !title.trim()) {
      newErrors.title = 'Name is required';
    }

    // Validate URL if provided
    if (link.trim() && !isValidUrl(link)) {
      newErrors.link = 'Please enter a valid URL';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [title, entryType, selectedPlace, link, isValidUrl]);

  const handleSubmit = useCallback(async () => {
    if (!validateForm() || !entryType) return;

    setIsSubmitting(true);
    try {
      const place: PlaceInput | undefined = selectedPlace
        ? {
            google_place_id: selectedPlace.google_place_id,
            name: selectedPlace.name,
            address: selectedPlace.address,
            latitude: selectedPlace.latitude,
            longitude: selectedPlace.longitude,
          }
        : undefined;

      // Use place name as title when a place is selected, otherwise use the title field
      const entryTitle = selectedPlace ? selectedPlace.name : title.trim();

      if (isEditing && entryId) {
        await updateEntry.mutateAsync({
          entryId,
          data: {
            title: entryTitle,
            entry_type: entryType,
            notes: notes.trim() || undefined,
            link: link.trim() || undefined,
            place,
          },
        });
      } else {
        const entryData: CreateEntryInput = {
          trip_id: tripId,
          title: entryTitle,
          entry_type: entryType,
          notes: notes.trim() || undefined,
          link: link.trim() || undefined,
          place,
          pending_media_ids: pendingMediaIds.length > 0 ? pendingMediaIds : undefined,
        };

        await createEntry.mutateAsync(entryData);
      }

      navigation.goBack();
    } catch {
      Alert.alert(
        'Error',
        isEditing
          ? 'Failed to update entry. Please try again.'
          : 'Failed to create entry. Please try again.'
      );
    } finally {
      setIsSubmitting(false);
    }
  }, [
    validateForm,
    isEditing,
    entryId,
    tripId,
    title,
    entryType,
    link,
    notes,
    selectedPlace,
    pendingMediaIds,
    createEntry,
    updateEntry,
    navigation,
  ]);

  if (isEditing && isLoadingEntry) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  const showPlaceInput = entryType && ['place', 'food', 'stay'].includes(entryType);

  // Handle type selection
  const handleTypeSelect = (type: EntryType) => {
    setEntryType(type);
    setHasSelectedType(true);
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
    >
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 100 + insets.bottom }]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.headerTitle}>{isEditing ? 'Edit Entry' : 'Log a Memory'}</Text>
        <Text style={styles.headerSubtitle}>
          {isEditing ? 'Update your trip details' : 'Add a new spot to your trip'}
        </Text>

        {/* Entry Type Selector */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>CATEGORY</Text>
          <View style={styles.typeGrid}>
            {ENTRY_TYPES.map((item) => {
              const isSelected = entryType === item.type;
              return (
                <Pressable
                  key={item.type}
                  style={[
                    styles.typeButton,
                    isSelected && { backgroundColor: item.color + '15', borderColor: item.color },
                  ]}
                  onPress={() => handleTypeSelect(item.type)}
                  testID={`entry-type-${item.type}`}
                >
                  <Ionicons name={item.icon} size={24} color={isSelected ? item.color : '#666'} />
                  <Text
                    style={[
                      styles.typeLabel,
                      isSelected && { color: item.color, fontWeight: '600' },
                    ]}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Show remaining fields only after type is selected */}
        {hasSelectedType && (
          <>
            {/* Location (conditional - for place, food, stay) */}
            {showPlaceInput && (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>LOCATION *</Text>
                <PlacesAutocomplete
                  value={selectedPlace}
                  onSelect={(place) => {
                    setSelectedPlace(place);
                    if (errors.place) setErrors((prev) => ({ ...prev, place: '' }));
                  }}
                  placeholder="Search for a place..."
                  countryCode={trip?.country_code}
                />
                {errors.place && (
                  <Text style={styles.errorText} testID="error-location-required">
                    {errors.place}
                  </Text>
                )}
              </View>
            )}

            {/* Name - only shown when no place is selected */}
            {!selectedPlace && (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>NAME *</Text>
                <TextInput
                  style={[styles.input, errors.title && styles.inputError]}
                  placeholder="Give this entry a name"
                  value={title}
                  onChangeText={(text) => {
                    setTitle(text);
                    if (errors.title) setErrors((prev) => ({ ...prev, title: '' }));
                  }}
                  returnKeyType="next"
                  testID="entry-title-input"
                />
                {errors.title && (
                  <Text style={styles.errorText} testID="error-title-required">
                    {errors.title}
                  </Text>
                )}
              </View>
            )}

            {/* Link (optional) */}
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>LINK</Text>
              <TextInput
                style={[styles.input, errors.link && styles.inputError]}
                placeholder="Add website URL"
                value={link}
                onChangeText={(text) => {
                  setLink(text);
                  if (errors.link) setErrors((prev) => ({ ...prev, link: '' }));
                }}
                keyboardType="url"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
                testID="entry-link-input"
              />
              {errors.link && (
                <Text style={styles.errorText} testID="error-link-invalid">
                  {errors.link}
                </Text>
              )}
            </View>

            {/* Photos Section */}
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>PHOTOS</Text>
              <EntryMediaGallery
                entryId={isEditing ? entryId : undefined}
                tripId={!isEditing ? tripId : undefined}
                editable={true}
                onPendingMediaChange={!isEditing ? setPendingMediaIds : undefined}
              />
            </View>

            {/* Notes */}
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>NOTES</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                placeholder="What made this memorable?"
                value={notes}
                onChangeText={setNotes}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
                testID="entry-notes-input"
              />
            </View>
          </>
        )}
      </ScrollView>

      {/* Submit Button - only show after type is selected */}
      {hasSelectedType && (
        <View style={[styles.footer, { paddingBottom: insets.bottom + 20 }]}>
          <Pressable
            style={[styles.submitButton, isSubmitting && styles.submitButtonDisabled]}
            onPress={handleSubmit}
            disabled={isSubmitting}
            testID="entry-save-button"
          >
            {isSubmitting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Text style={styles.submitButtonText}>
                  {isEditing ? 'Save Changes' : 'Log Memory'}
                </Text>
              </>
            )}
          </Pressable>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.warmCream,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.warmCream,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 24,
  },
  headerTitle: {
    fontFamily: fonts.playfair.bold,
    fontSize: 34,
    color: colors.midnightNavy,
    marginBottom: 8,
    marginTop: 12,
    letterSpacing: -0.5,
  },
  headerSubtitle: {
    fontFamily: fonts.openSans.regular,
    fontSize: 16,
    color: colors.textSecondary,
    marginBottom: 32,
    lineHeight: 24,
  },
  section: {
    marginBottom: 28,
  },
  sectionLabel: {
    fontFamily: fonts.oswald.medium,
    fontSize: 12,
    color: colors.midnightNavy,
    marginBottom: 10,
    letterSpacing: 1.5,
    opacity: 0.7,
    textTransform: 'uppercase',
  },
  typeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  typeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.05)',
    backgroundColor: '#fff',
    gap: 8,
    minWidth: '47%',
    flex: 1,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  typeLabel: {
    fontSize: 14,
    color: colors.textSecondary,
    fontFamily: fonts.openSans.semiBold,
  },
  input: {
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 16,
    color: colors.midnightNavy,
    fontFamily: fonts.openSans.regular,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.05)',
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.02,
    shadowRadius: 4,
  },
  inputError: {
    borderWidth: 1,
    borderColor: '#FF3B30',
  },
  textArea: {
    minHeight: 120,
    paddingTop: 14,
  },
  errorText: {
    fontSize: 13,
    color: colors.adobeBrick,
    marginTop: 6,
    marginLeft: 4,
    fontFamily: fonts.openSans.regular,
  },
  hint: {
    fontSize: 12,
    color: '#999',
    marginTop: 6,
    marginLeft: 4,
  },
  footer: {
    padding: 24,
    backgroundColor: colors.warmCream,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.05)',
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.sunsetGold,
    paddingVertical: 16,
    borderRadius: 12,
    gap: 8,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 4,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    fontSize: 16,
    fontFamily: fonts.openSans.semiBold,
    color: colors.midnightNavy,
  },
});
