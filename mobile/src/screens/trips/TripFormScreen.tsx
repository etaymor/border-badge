import { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Button, Input } from '@components/ui';
import { useCreateTrip, useTrip, useUpdateTrip } from '@hooks/useTrips';
import type { TripsStackScreenProps } from '@navigation/types';

type Props = TripsStackScreenProps<'TripForm'>;

export function TripFormScreen({ navigation, route }: Props) {
  const tripId = route.params?.tripId;
  const countryId = route.params?.countryId;
  const countryName = route.params?.countryName;
  const isEditing = !!tripId;

  // Form state
  const [name, setName] = useState('');
  const [dateStart, setDateStart] = useState('');
  const [dateEnd, setDateEnd] = useState('');
  const [coverImageUrl, setCoverImageUrl] = useState('');

  // Validation state
  const [nameError, setNameError] = useState('');
  const [dateError, setDateError] = useState('');

  // Fetch existing trip if editing
  const { data: existingTrip, isLoading: loadingTrip } = useTrip(tripId || '');

  // Mutations
  const createTrip = useCreateTrip();
  const updateTrip = useUpdateTrip();

  // Populate form when editing
  useEffect(() => {
    if (existingTrip && isEditing) {
      setName(existingTrip.name);
      setCoverImageUrl(existingTrip.cover_image_url || '');

      // Parse date range if present
      if (existingTrip.date_range) {
        const match = existingTrip.date_range.match(/\[([^,]+),([^\]]+)\]/);
        if (match) {
          const [, startStr, endStr] = match;
          if (startStr !== '-infinity') setDateStart(startStr);
          if (endStr !== 'infinity') setDateEnd(endStr);
        }
      }
    }
  }, [existingTrip, isEditing]);

  // Validate date format (YYYY-MM-DD)
  const isValidDate = (dateStr: string): boolean => {
    if (!dateStr) return true; // Empty is valid (optional)
    const regex = /^\d{4}-\d{2}-\d{2}$/;
    if (!regex.test(dateStr)) return false;
    const date = new Date(dateStr);
    return !isNaN(date.getTime());
  };

  const validate = (): boolean => {
    let isValid = true;

    // Name is required
    if (!name.trim()) {
      setNameError('Trip name is required');
      isValid = false;
    } else {
      setNameError('');
    }

    // Validate dates if provided
    if (dateStart && !isValidDate(dateStart)) {
      setDateError('Start date must be in YYYY-MM-DD format');
      isValid = false;
    } else if (dateEnd && !isValidDate(dateEnd)) {
      setDateError('End date must be in YYYY-MM-DD format');
      isValid = false;
    } else if (dateStart && dateEnd && new Date(dateStart) > new Date(dateEnd)) {
      setDateError('Start date must be before end date');
      isValid = false;
    } else {
      setDateError('');
    }

    return isValid;
  };

  const handleSave = async () => {
    if (!validate()) return;

    // Need countryId for new trips
    if (!isEditing && !countryId) {
      Alert.alert('Error', 'Country is required to create a trip');
      return;
    }

    try {
      if (isEditing && tripId) {
        // Update existing trip
        await updateTrip.mutateAsync({
          id: tripId,
          name: name.trim(),
          cover_image_url: coverImageUrl.trim() || undefined,
          date_start: dateStart || undefined,
          date_end: dateEnd || undefined,
        });
      } else {
        // Create new trip
        await createTrip.mutateAsync({
          name: name.trim(),
          country_id: countryId!,
          cover_image_url: coverImageUrl.trim() || undefined,
          date_start: dateStart || undefined,
          date_end: dateEnd || undefined,
        });
      }

      navigation.goBack();
    } catch {
      // Error is handled by the mutation's onError
    }
  };

  const isLoading = createTrip.isPending || updateTrip.isPending;
  const isFetching = loadingTrip && isEditing;

  if (isFetching) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>Loading trip...</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {/* Country Context */}
        {countryName && !isEditing && (
          <View style={styles.contextBanner}>
            <Text style={styles.contextText}>Adding trip to {countryName}</Text>
          </View>
        )}

        {/* Trip Name */}
        <Input
          label="Trip Name *"
          value={name}
          onChangeText={setName}
          placeholder="e.g., Spring in Kyoto"
          error={nameError}
          autoCapitalize="words"
          autoFocus={!isEditing}
        />

        {/* Date Range */}
        <View style={styles.dateRow}>
          <View style={styles.dateInput}>
            <Input
              label="Start Date"
              value={dateStart}
              onChangeText={setDateStart}
              placeholder="YYYY-MM-DD"
              keyboardType="numbers-and-punctuation"
            />
          </View>
          <View style={styles.dateSeparator}>
            <Text style={styles.dateSeparatorText}>to</Text>
          </View>
          <View style={styles.dateInput}>
            <Input
              label="End Date"
              value={dateEnd}
              onChangeText={setDateEnd}
              placeholder="YYYY-MM-DD"
              keyboardType="numbers-and-punctuation"
            />
          </View>
        </View>
        {dateError ? <Text style={styles.errorText}>{dateError}</Text> : null}

        {/* Cover Image URL */}
        <Input
          label="Cover Image URL"
          value={coverImageUrl}
          onChangeText={setCoverImageUrl}
          placeholder="https://..."
          autoCapitalize="none"
          keyboardType="url"
        />
        <Text style={styles.hint}>Optional: Add a cover image for your trip</Text>

        {/* Future Feature Hint */}
        <View style={styles.comingSoon}>
          <Text style={styles.comingSoonTitle}>Tag Friends (Coming Soon)</Text>
          <Text style={styles.comingSoonText}>
            Soon you&apos;ll be able to tag friends on your trips and share memories together.
          </Text>
        </View>
      </ScrollView>

      {/* Save Button */}
      <View style={styles.footer}>
        <Button
          title={isEditing ? 'Save Changes' : 'Create Trip'}
          onPress={handleSave}
          loading={isLoading}
          disabled={isLoading}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  loadingText: {
    fontSize: 16,
    color: '#666',
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 20,
    paddingBottom: 100,
  },
  contextBanner: {
    backgroundColor: '#E8F4FF',
    padding: 12,
    borderRadius: 8,
    marginBottom: 20,
  },
  contextText: {
    fontSize: 14,
    color: '#007AFF',
    fontWeight: '500',
    textAlign: 'center',
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: 4,
  },
  dateInput: {
    flex: 1,
  },
  dateSeparator: {
    paddingHorizontal: 12,
    paddingBottom: 16,
  },
  dateSeparatorText: {
    fontSize: 14,
    color: '#666',
  },
  errorText: {
    fontSize: 12,
    color: '#FF3B30',
    marginTop: -8,
    marginBottom: 16,
    marginLeft: 4,
  },
  hint: {
    fontSize: 12,
    color: '#666',
    marginTop: -8,
    marginBottom: 16,
    marginLeft: 4,
  },
  comingSoon: {
    backgroundColor: '#F8F9FA',
    padding: 16,
    borderRadius: 8,
    marginTop: 24,
    borderWidth: 1,
    borderColor: '#E5E5EA',
    borderStyle: 'dashed',
  },
  comingSoonTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
    marginBottom: 4,
  },
  comingSoonText: {
    fontSize: 13,
    color: '#999',
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 20,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#F2F2F7',
  },
});
