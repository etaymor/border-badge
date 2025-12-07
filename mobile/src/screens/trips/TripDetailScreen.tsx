import { useState, useCallback } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { TripsStackScreenProps } from '@navigation/types';
import { useTrip, useDeleteTrip, useRestoreTrip } from '@hooks/useTrips';
import { useEntries, EntryWithPlace } from '@hooks/useEntries';
import { useCountryByCode } from '@hooks/useCountries';
import { ConfirmDialog, Snackbar } from '@components/ui';
import { EntryGridCard } from '@components/entries';

type Props = TripsStackScreenProps<'TripDetail'>;

function EmptyState({ onAddEntry }: { onAddEntry: () => void }) {
  return (
    <View style={styles.emptyContainer}>
      <Ionicons name="bookmark-outline" size={64} color="#ccc" />
      <Text style={styles.emptyTitle}>No entries yet</Text>
      <Text style={styles.emptySubtitle}>
        Start documenting your trip by adding places, food, stays, or experiences
      </Text>
      <Pressable style={styles.emptyButton} onPress={onAddEntry} testID="empty-add-entry-button">
        <Ionicons name="add" size={20} color="#fff" />
        <Text style={styles.emptyButtonText}>Add Your First Entry</Text>
      </Pressable>
    </View>
  );
}

export function TripDetailScreen({ route, navigation }: Props) {
  const { tripId } = route.params;
  const insets = useSafeAreaInsets();
  const [_isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showUndoSnackbar, setShowUndoSnackbar] = useState(false);
  const [deletedTripId, setDeletedTripId] = useState<string | null>(null);

  const { data: trip, isLoading: tripLoading, error: tripError } = useTrip(tripId);
  const { data: entries, isLoading: entriesLoading } = useEntries(tripId);
  const { data: country } = useCountryByCode(trip?.country_id ?? '');
  const deleteTrip = useDeleteTrip();
  const restoreTrip = useRestoreTrip();

  const hasCoverPhoto = !!trip?.cover_image_url;

  const handleAddEntry = useCallback(() => {
    navigation.navigate('EntryForm', { tripId });
  }, [navigation, tripId]);

  const handleEditTrip = useCallback(() => {
    navigation.navigate('TripForm', { tripId });
  }, [navigation, tripId]);

  const handleSharePress = useCallback(() => {
    // Always navigate to TripLists - it handles empty state internally
    navigation.navigate('TripLists', { tripId, tripName: trip?.name });
  }, [tripId, trip?.name, navigation]);

  const handleEntryPress = useCallback(
    (entryId: string) => {
      navigation.navigate('EntryForm', { tripId, entryId });
    },
    [navigation, tripId]
  );

  const handleConfirmDelete = useCallback(async () => {
    setShowDeleteConfirm(false);
    setIsDeleting(true);
    try {
      await deleteTrip.mutateAsync(tripId);
      setDeletedTripId(tripId);
      setShowUndoSnackbar(true);
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
    navigation.goBack();
  }, [navigation]);

  const renderEntry = useCallback(
    ({ item }: { item: EntryWithPlace }) => (
      <EntryGridCard entry={item} onPress={() => handleEntryPress(item.id)} />
    ),
    [handleEntryPress]
  );

  if (tripLoading) {
    return (
      <View style={styles.centered}>
        <StatusBar barStyle="dark-content" />
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  if (tripError || !trip) {
    return (
      <View style={styles.centered}>
        <StatusBar barStyle="dark-content" />
        <Ionicons name="alert-circle-outline" size={48} color="#FF3B30" />
        <Text style={styles.errorText}>Failed to load trip</Text>
        <Pressable style={styles.retryButton} onPress={() => navigation.goBack()}>
          <Text style={styles.retryButtonText}>Go Back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle={hasCoverPhoto ? 'light-content' : 'dark-content'} />

      {hasCoverPhoto ? (
        // WITH COVER PHOTO - Hero Section
        <View style={styles.heroContainer}>
          <Image source={{ uri: trip.cover_image_url! }} style={styles.coverImage} />

          {/* Gradient overlay */}
          <LinearGradient colors={['transparent', 'rgba(0,0,0,0.6)']} style={styles.gradient} />

          {/* Trip name at bottom of hero */}
          <Text style={styles.tripNameOverlay}>{trip.name}</Text>

          {/* Header row - white icons with dark circle backgrounds */}
          <View style={[styles.headerRow, { top: insets.top + 8 }]}>
            <Pressable style={styles.iconButton} onPress={() => navigation.goBack()} hitSlop={8}>
              <Ionicons name="chevron-back" size={24} color="#fff" />
            </Pressable>
            <View style={styles.headerRightIcons}>
              <Pressable style={styles.iconButton} onPress={handleEditTrip} hitSlop={8}>
                <Ionicons name="pencil" size={20} color="#fff" />
              </Pressable>
              <Pressable style={styles.iconButton} onPress={handleSharePress} hitSlop={8}>
                <Ionicons name="share-outline" size={22} color="#fff" />
              </Pressable>
            </View>
          </View>
        </View>
      ) : (
        // NO COVER PHOTO - Simple header
        <View style={[styles.noCoverHeader, { paddingTop: insets.top }]}>
          {/* Header row - dark icons */}
          <View style={styles.noCoverHeaderRow}>
            <Pressable onPress={() => navigation.goBack()} hitSlop={8}>
              <Ionicons name="chevron-back" size={28} color="#1a1a1a" />
            </Pressable>
            <View style={styles.headerRightIcons}>
              <Pressable onPress={handleEditTrip} hitSlop={8}>
                <Ionicons name="pencil" size={22} color="#1a1a1a" />
              </Pressable>
              <Pressable onPress={handleSharePress} hitSlop={8}>
                <Ionicons name="share-outline" size={24} color="#1a1a1a" />
              </Pressable>
            </View>
          </View>
          {/* Trip name */}
          <Text style={styles.tripNameNoCover}>{trip.name}</Text>
        </View>
      )}

      {/* Country badge */}
      {country && (
        <View style={styles.countryBadgeContainer}>
          <View style={styles.countryBadge}>
            <Text style={styles.countryName}>{country.name}</Text>
          </View>
        </View>
      )}

      {/* Entries grid */}
      {entriesLoading ? (
        <View style={styles.entriesLoading}>
          <ActivityIndicator size="small" color="#007AFF" />
        </View>
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(item) => item.id}
          renderItem={renderEntry}
          numColumns={2}
          columnWrapperStyle={styles.gridRow}
          contentContainerStyle={styles.entriesListContent}
          ListEmptyComponent={<EmptyState onAddEntry={handleAddEntry} />}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Floating Add Entry Button */}
      <Pressable style={styles.fab} onPress={handleAddEntry} testID="fab-add-entry">
        <Ionicons name="add" size={24} color="#fff" />
        <Text style={styles.fabText}>Add Entry</Text>
      </Pressable>

      {/* Delete Confirmation Dialog (kept for potential future use from Edit screen) */}
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
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

  // Hero section (with cover photo)
  heroContainer: {
    position: 'relative',
  },
  coverImage: {
    width: '100%',
    height: 250,
    backgroundColor: '#e0e0e0',
  },
  gradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 120,
  },
  tripNameOverlay: {
    position: 'absolute',
    bottom: 16,
    left: 16,
    right: 16,
    color: '#fff',
    fontSize: 28,
    fontWeight: 'bold',
    textShadowColor: 'rgba(0, 0, 0, 0.3)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  headerRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  headerRightIcons: {
    flexDirection: 'row',
    gap: 12,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },

  // No cover header
  noCoverHeader: {
    backgroundColor: '#fff',
  },
  noCoverHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  tripNameNoCover: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#1a1a1a',
    paddingHorizontal: 16,
    paddingBottom: 16,
  },

  // Country badge
  countryBadgeContainer: {
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  countryBadge: {
    alignSelf: 'flex-start',
  },
  countryName: {
    fontSize: 15,
    color: '#666',
  },

  // Entries grid
  entriesLoading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  entriesListContent: {
    padding: 16,
    paddingBottom: 100, // Space for FAB
    flexGrow: 1,
    gap: 12,
  },
  gridRow: {
    justifyContent: 'space-between',
  },

  // Empty state
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 48,
    paddingHorizontal: 24,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#1a1a1a',
    marginTop: 16,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 15,
    color: '#666',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 22,
  },
  emptyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#007AFF',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
    gap: 8,
  },
  emptyButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },

  // FAB
  fab: {
    position: 'absolute',
    bottom: 24,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#007AFF',
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 28,
    gap: 8,
    shadowColor: '#007AFF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  fabText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
