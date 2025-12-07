import { useState, useCallback } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { TripsStackScreenProps } from '@navigation/types';
import { useTrip, useDeleteTrip, useRestoreTrip } from '@hooks/useTrips';
import { useEntries } from '@hooks/useEntries';
import { useCountryByCode } from '@hooks/useCountries';
import { useTripLists } from '@hooks/useLists';
import { ConfirmDialog, Snackbar } from '@components/ui';

type Props = TripsStackScreenProps<'TripDetail'>;

// Parse PostgreSQL daterange format [start,end] or [start,end)
function parseDateRange(dateRange: string | null | undefined): {
  start: Date | null;
  end: Date | null;
} {
  if (!dateRange) return { start: null, end: null };

  // Handle various daterange formats: [2024-01-01,2024-01-15], (2024-01-01,2024-01-15], etc.
  const match = dateRange.match(/[[(]([^,]*),([^\])]*)[\])]/);
  if (!match) {
    if (__DEV__) {
      console.warn('Failed to parse date range:', dateRange);
    }
    return { start: null, end: null };
  }

  const startStr = match[1].trim();
  const endStr = match[2].trim();

  const start =
    startStr && startStr !== '-infinity' && startStr !== 'infinity' ? new Date(startStr) : null;
  const end = endStr && endStr !== 'infinity' && endStr !== '-infinity' ? new Date(endStr) : null;

  return { start, end };
}

function formatDateRange(dateRange: string | null | undefined): string {
  const { start, end } = parseDateRange(dateRange);

  if (!start && !end) return 'No dates set';

  const formatDate = (d: Date) =>
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  if (start && end) {
    return `${formatDate(start)} - ${formatDate(end)}`;
  }
  if (start) {
    return `From ${formatDate(start)}`;
  }
  if (end) {
    return `Until ${formatDate(end)}`;
  }
  return 'No dates set';
}

export function TripDetailScreen({ route, navigation }: Props) {
  const { tripId } = route.params;
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showUndoSnackbar, setShowUndoSnackbar] = useState(false);
  const [deletedTripId, setDeletedTripId] = useState<string | null>(null);

  const { data: trip, isLoading: tripLoading, error: tripError } = useTrip(tripId);
  const { data: entries, isLoading: entriesLoading } = useEntries(tripId);
  const { data: country } = useCountryByCode(trip?.country_id ?? '');
  const { data: lists } = useTripLists(tripId);
  const deleteTrip = useDeleteTrip();
  const restoreTrip = useRestoreTrip();

  const handleDelete = useCallback(() => {
    setShowDeleteConfirm(true);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    setShowDeleteConfirm(false);
    setIsDeleting(true);
    try {
      await deleteTrip.mutateAsync(tripId);
      setDeletedTripId(tripId);
      setShowUndoSnackbar(true);
      // Don't navigate immediately - wait for snackbar to dismiss
      // This allows user to see and use the "Undo" button
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to delete trip. Please try again.';
      Alert.alert('Error', message);
      setIsDeleting(false);
    }
  }, [deleteTrip, tripId]);

  const handleUndo = useCallback(async () => {
    setShowUndoSnackbar(false);
    if (deletedTripId) {
      try {
        await restoreTrip.mutateAsync(deletedTripId);
        setDeletedTripId(null);
        setIsDeleting(false);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to restore trip. Please try again.';
        Alert.alert('Error', message);
      }
    }
  }, [deletedTripId, restoreTrip]);

  const handleDismissSnackbar = useCallback(() => {
    setShowUndoSnackbar(false);
    setDeletedTripId(null);
    // Navigate back after snackbar dismisses (either by timeout or user action)
    navigation.goBack();
  }, [navigation]);

  const handleSharePress = useCallback(() => {
    if (lists && lists.length > 0) {
      navigation.navigate('TripLists', { tripId, tripName: trip?.name });
    } else {
      navigation.navigate('ListCreate', { tripId, tripName: trip?.name });
    }
  }, [lists, tripId, trip?.name, navigation]);

  if (tripLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  if (tripError || !trip) {
    return (
      <View style={styles.centered}>
        <Ionicons name="alert-circle-outline" size={48} color="#FF3B30" />
        <Text style={styles.errorText}>Failed to load trip</Text>
        <Pressable style={styles.retryButton} onPress={() => navigation.goBack()}>
          <Text style={styles.retryButtonText}>Go Back</Text>
        </Pressable>
      </View>
    );
  }

  const entryCount = entries?.length ?? 0;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      {/* Cover Image */}
      {trip.cover_image_url ? (
        <Image source={{ uri: trip.cover_image_url }} style={styles.coverImage} />
      ) : (
        <View style={styles.coverPlaceholder}>
          <Ionicons name="image-outline" size={48} color="#ccc" />
          <Text style={styles.coverPlaceholderText}>No cover image</Text>
        </View>
      )}

      {/* Trip Info */}
      <View style={styles.infoSection}>
        <Text style={styles.tripName}>{trip.name}</Text>

        {/* Country Badge */}
        {country && (
          <View style={styles.countryBadge}>
            <Text style={styles.countryName}>{country.name}</Text>
          </View>
        )}

        {/* Date Range */}
        <View style={styles.dateRow}>
          <Ionicons name="calendar-outline" size={18} color="#666" />
          <Text style={styles.dateText}>{formatDateRange(trip.date_range)}</Text>
        </View>

        {/* Entry Count */}
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Ionicons name="bookmark-outline" size={20} color="#007AFF" />
            <Text style={styles.statNumber}>{entryCount}</Text>
            <Text style={styles.statLabel}>{entryCount === 1 ? 'Entry' : 'Entries'}</Text>
          </View>
        </View>
      </View>

      {/* First Entry Prompt - shown when trip has no entries */}
      {!entriesLoading && entryCount === 0 && (
        <Pressable
          style={styles.firstEntryPrompt}
          onPress={() => navigation.navigate('EntryForm', { tripId })}
          testID="first-entry-prompt"
        >
          <View style={styles.firstEntryIcon}>
            <Ionicons name="add-circle" size={48} color="#34C759" />
          </View>
          <Text style={styles.firstEntryTitle}>Add your first entry!</Text>
          <Text style={styles.firstEntrySubtitle}>
            Start documenting your trip by adding places you visited, food you tried, where you
            stayed, or memorable experiences.
          </Text>
          <View style={styles.firstEntryButton}>
            <Ionicons name="add" size={20} color="#fff" />
            <Text style={styles.firstEntryButtonText}>Add Entry</Text>
          </View>
        </Pressable>
      )}

      {/* Action Buttons */}
      <View style={styles.actionsSection}>
        <Text style={styles.sectionTitle}>Actions</Text>

        {/* View Entries - only show if there are entries */}
        {entryCount > 0 && (
          <Pressable
            style={styles.actionButton}
            onPress={() => navigation.navigate('EntryList', { tripId, tripName: trip.name })}
            testID="view-entries-button"
          >
            <View style={styles.actionButtonContent}>
              <Ionicons name="list-outline" size={24} color="#007AFF" />
              <View style={styles.actionButtonText}>
                <Text style={styles.actionButtonTitle}>View Entries</Text>
                <Text style={styles.actionButtonSubtitle}>
                  {entriesLoading
                    ? 'Loading...'
                    : `${entryCount} ${entryCount === 1 ? 'entry' : 'entries'} logged`}
                </Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#ccc" />
          </Pressable>
        )}

        {/* Add Entry */}
        <Pressable
          style={styles.actionButton}
          onPress={() => navigation.navigate('EntryForm', { tripId })}
          testID="add-entry-button"
        >
          <View style={styles.actionButtonContent}>
            <Ionicons name="add-circle-outline" size={24} color="#34C759" />
            <View style={styles.actionButtonText}>
              <Text style={styles.actionButtonTitle}>Add Entry</Text>
              <Text style={styles.actionButtonSubtitle}>
                Log a place, food, stay, or experience
              </Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={20} color="#ccc" />
        </Pressable>

        {/* Create Shareable List */}
        <Pressable
          style={styles.actionButton}
          onPress={handleSharePress}
          testID="create-list-button"
        >
          <View style={styles.actionButtonContent}>
            <Ionicons name="share-outline" size={24} color="#FF9500" />
            <View style={styles.actionButtonText}>
              <Text style={styles.actionButtonTitle}>Create Shareable List</Text>
              <Text style={styles.actionButtonSubtitle}>
                Share your favorite spots from this trip
              </Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={20} color="#ccc" />
        </Pressable>

        {/* Edit Trip */}
        <Pressable
          style={styles.actionButton}
          onPress={() => navigation.navigate('TripForm', { tripId })}
          testID="edit-trip-button"
        >
          <View style={styles.actionButtonContent}>
            <Ionicons name="pencil-outline" size={24} color="#5856D6" />
            <View style={styles.actionButtonText}>
              <Text style={styles.actionButtonTitle}>Edit Trip</Text>
              <Text style={styles.actionButtonSubtitle}>Update name, dates, or cover image</Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={20} color="#ccc" />
        </Pressable>
      </View>

      {/* Danger Zone */}
      <View style={styles.dangerSection}>
        <Pressable
          style={[styles.deleteButton, isDeleting && styles.deleteButtonDisabled]}
          onPress={handleDelete}
          disabled={isDeleting}
          testID="delete-trip-button"
        >
          {isDeleting ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <Ionicons name="trash-outline" size={20} color="#fff" />
              <Text style={styles.deleteButtonText}>Delete Trip</Text>
            </>
          )}
        </Pressable>
      </View>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        visible={showDeleteConfirm}
        title="Delete Trip"
        message={`Are you sure you want to delete "${trip?.name}"? This will also delete all entries and media associated with this trip.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        destructive
        onConfirm={handleConfirmDelete}
        onCancel={() => setShowDeleteConfirm(false)}
        testID="delete-trip-dialog"
      />

      {/* Undo Snackbar */}
      <Snackbar
        visible={showUndoSnackbar}
        message="Trip deleted"
        actionLabel="Undo"
        onAction={handleUndo}
        onDismiss={handleDismissSnackbar}
        duration={5000}
        testID="trip-deleted-snackbar"
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  contentContainer: {
    paddingBottom: 40,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 24,
  },
  errorText: {
    fontSize: 16,
    color: '#666',
    marginTop: 12,
    marginBottom: 24,
  },
  retryButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  coverImage: {
    width: '100%',
    height: 200,
    backgroundColor: '#e0e0e0',
  },
  coverPlaceholder: {
    width: '100%',
    height: 200,
    backgroundColor: '#f0f0f0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  coverPlaceholderText: {
    marginTop: 8,
    fontSize: 14,
    color: '#999',
  },
  infoSection: {
    backgroundColor: '#fff',
    padding: 20,
    marginBottom: 12,
  },
  tripName: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1a1a1a',
    marginBottom: 12,
  },
  countryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  countryName: {
    fontSize: 16,
    color: '#666',
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  dateText: {
    fontSize: 14,
    color: '#666',
    marginLeft: 8,
  },
  statsRow: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
    paddingTop: 16,
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statNumber: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1a1a1a',
    marginLeft: 8,
    marginRight: 4,
  },
  statLabel: {
    fontSize: 14,
    color: '#666',
  },
  actionsSection: {
    backgroundColor: '#fff',
    padding: 20,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#999',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  actionButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  actionButtonText: {
    marginLeft: 14,
    flex: 1,
  },
  actionButtonTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: '#1a1a1a',
  },
  actionButtonSubtitle: {
    fontSize: 13,
    color: '#999',
    marginTop: 2,
  },
  dangerSection: {
    padding: 20,
  },
  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FF3B30',
    paddingVertical: 14,
    borderRadius: 10,
    gap: 8,
  },
  deleteButtonDisabled: {
    opacity: 0.6,
  },
  deleteButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  firstEntryPrompt: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#34C759',
    borderStyle: 'dashed',
  },
  firstEntryIcon: {
    marginBottom: 12,
  },
  firstEntryTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1a1a1a',
    marginBottom: 8,
  },
  firstEntrySubtitle: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 16,
  },
  firstEntryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#34C759',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
    gap: 6,
  },
  firstEntryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
