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

import type { TripsStackScreenProps } from '@navigation/types';
import type { EntryType } from '@navigation/types';
import {
  useCreateEntry,
  useUpdateEntry,
  useEntry,
  CreateEntryInput,
  PlaceInput,
} from '@hooks/useEntries';
import { PlacesAutocomplete, SelectedPlace } from '@components/places';

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

function formatDateForInput(date: Date): string {
  return date.toISOString().split('T')[0];
}

export function EntryFormScreen({ route, navigation }: Props) {
  const { tripId, entryId, entryType: initialEntryType } = route.params;
  const isEditing = !!entryId;

  // Fetch existing entry data for editing
  const { data: existingEntry, isLoading: isLoadingEntry } = useEntry(entryId ?? '');
  const createEntry = useCreateEntry();
  const updateEntry = useUpdateEntry();

  // Form state
  const [entryType, setEntryType] = useState<EntryType>(initialEntryType ?? 'place');
  const [title, setTitle] = useState('');
  const [entryDate, setEntryDate] = useState(formatDateForInput(new Date()));
  const [notes, setNotes] = useState('');
  const [selectedPlace, setSelectedPlace] = useState<SelectedPlace | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Populate form when editing
  useEffect(() => {
    if (existingEntry && isEditing) {
      setTitle(existingEntry.title);
      setEntryType(existingEntry.entry_type as EntryType);
      setNotes(existingEntry.notes ?? '');
      if (existingEntry.entry_date) {
        setEntryDate(existingEntry.entry_date.split('T')[0]);
      }
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
    navigation.setOptions({
      title: isEditing ? 'Edit Entry' : 'New Entry',
    });
  }, [navigation, isEditing]);

  const validateForm = useCallback((): boolean => {
    const newErrors: Record<string, string> = {};

    if (!title.trim()) {
      newErrors.title = 'Title is required';
    }

    // Place is required for place, food, and stay types
    const requiresPlace = ['place', 'food', 'stay'].includes(entryType);
    if (requiresPlace && !selectedPlace) {
      newErrors.place = 'Please select or enter a location';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [title, entryType, selectedPlace]);

  const handleSubmit = useCallback(async () => {
    if (!validateForm()) return;

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

      if (isEditing && entryId) {
        await updateEntry.mutateAsync({
          entryId,
          data: {
            title: title.trim(),
            entry_type: entryType,
            entry_date: entryDate || undefined,
            notes: notes.trim() || undefined,
            place,
          },
        });
      } else {
        const entryData: CreateEntryInput = {
          trip_id: tripId,
          title: title.trim(),
          entry_type: entryType,
          entry_date: entryDate || undefined,
          notes: notes.trim() || undefined,
          place,
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
    entryDate,
    notes,
    selectedPlace,
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

  const showPlaceInput = ['place', 'food', 'stay'].includes(entryType);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Entry Type Selector */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Type</Text>
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
                  onPress={() => setEntryType(item.type)}
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

        {/* Title */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Title *</Text>
          <TextInput
            style={[styles.input, errors.title && styles.inputError]}
            placeholder="Give this entry a name"
            value={title}
            onChangeText={(text) => {
              setTitle(text);
              if (errors.title) setErrors((prev) => ({ ...prev, title: '' }));
            }}
            returnKeyType="next"
          />
          {errors.title && <Text style={styles.errorText}>{errors.title}</Text>}
        </View>

        {/* Date */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Date</Text>
          <TextInput
            style={styles.input}
            placeholder="YYYY-MM-DD"
            value={entryDate}
            onChangeText={setEntryDate}
            keyboardType="numbers-and-punctuation"
          />
          <Text style={styles.hint}>Optional - when did this happen?</Text>
        </View>

        {/* Place (conditional) */}
        {showPlaceInput && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Location {showPlaceInput ? '*' : ''}</Text>
            <PlacesAutocomplete
              value={selectedPlace}
              onSelect={(place) => {
                setSelectedPlace(place);
                if (errors.place) setErrors((prev) => ({ ...prev, place: '' }));
              }}
              placeholder="Search for a place..."
            />
            {errors.place && <Text style={styles.errorText}>{errors.place}</Text>}
          </View>
        )}

        {/* Notes */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Notes</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="What made this memorable?"
            value={notes}
            onChangeText={setNotes}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />
        </View>

        {/* Photos Section Placeholder */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Photos</Text>
          <Pressable style={styles.photosPlaceholder}>
            <Ionicons name="camera-outline" size={32} color="#ccc" />
            <Text style={styles.photosPlaceholderText}>Add photos (Coming soon)</Text>
          </Pressable>
        </View>
      </ScrollView>

      {/* Submit Button */}
      <View style={styles.footer}>
        <Pressable
          style={[styles.submitButton, isSubmitting && styles.submitButtonDisabled]}
          onPress={handleSubmit}
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <Ionicons name={isEditing ? 'checkmark' : 'add'} size={20} color="#fff" />
              <Text style={styles.submitButtonText}>
                {isEditing ? 'Save Changes' : 'Add Entry'}
              </Text>
            </>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 120, // Space for footer
  },
  section: {
    marginBottom: 24,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#666',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
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
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#e0e0e0',
    backgroundColor: '#fff',
    gap: 8,
    minWidth: '47%',
    flex: 1,
  },
  typeLabel: {
    fontSize: 14,
    color: '#666',
  },
  input: {
    backgroundColor: '#f5f5f5',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 16,
    color: '#1a1a1a',
  },
  inputError: {
    borderWidth: 1,
    borderColor: '#FF3B30',
  },
  textArea: {
    minHeight: 100,
    paddingTop: 14,
  },
  errorText: {
    fontSize: 13,
    color: '#FF3B30',
    marginTop: 6,
    marginLeft: 4,
  },
  hint: {
    fontSize: 12,
    color: '#999',
    marginTop: 6,
    marginLeft: 4,
  },
  photosPlaceholder: {
    borderWidth: 2,
    borderColor: '#e0e0e0',
    borderStyle: 'dashed',
    borderRadius: 12,
    paddingVertical: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photosPlaceholderText: {
    fontSize: 14,
    color: '#999',
    marginTop: 8,
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 20,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#007AFF',
    paddingVertical: 16,
    borderRadius: 12,
    gap: 8,
  },
  submitButtonDisabled: {
    backgroundColor: '#ccc',
  },
  submitButtonText: {
    fontSize: 17,
    fontWeight: '600',
    color: '#fff',
  },
});
