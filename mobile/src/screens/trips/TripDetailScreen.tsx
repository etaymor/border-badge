// TODO: Refactor - this file exceeds 500 lines (currently ~576 lines).
// Consider extracting:
// - TripHeader component for cover image and trip info
// - TripEntriesList component for entries section
// - TripActionBar component for bottom action buttons

import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EntryGridCard } from '@components/entries';
import { ConfirmDialog, GlassBackButton, Snackbar } from '@components/ui';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { useCountryByCode } from '@hooks/useCountries';
import { EntryWithPlace, useEntries } from '@hooks/useEntries';
import { useTripLists } from '@hooks/useLists';
import { useDeleteTrip, useRestoreTrip, useTrip } from '@hooks/useTrips';
import type { TripsStackScreenProps } from '@navigation/types';

type Props = TripsStackScreenProps<'TripDetail'>;

function EmptyState({ onAddEntry }: { onAddEntry: () => void }) {
  return (
    <View style={styles.emptyContainer}>
      <Text style={styles.emptyIcon}>📷</Text>
      <Text style={styles.emptyTitle}>Unwritten Memories</Text>
      <Text style={styles.emptySubtitle}>
        This chapter is waiting to be written. Document your first memory.
      </Text>
      <Pressable style={styles.emptyButton} onPress={onAddEntry} testID="empty-add-entry-button">
        <Ionicons name="add" size={20} color={colors.midnightNavy} />
        <Text style={styles.emptyButtonText}>Add Entry</Text>
      </Pressable>
    </View>
  );
}

export function TripDetailScreen({ route, navigation }: Props) {
  const { tripId } = route.params;
  const insets = useSafeAreaInsets();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showUndoSnackbar, setShowUndoSnackbar] = useState(false);
  const [deletedTripId, setDeletedTripId] = useState<string | null>(null);
  const [coverImageError, setCoverImageError] = useState(false);

  const { data: trip, isLoading: tripLoading, error: tripError } = useTrip(tripId);
  const { data: entries, isLoading: entriesLoading } = useEntries(tripId);
  const { data: lists } = useTripLists(tripId);
  const { data: country } = useCountryByCode(trip?.country_id ?? '');
  const deleteTrip = useDeleteTrip();
  const restoreTrip = useRestoreTrip();

  const hasCoverPhoto = !!trip?.cover_image_url && !coverImageError;

  const handleAddEntry = useCallback(() => {
    navigation.navigate('EntryForm', { tripId });
  }, [navigation, tripId]);

  const handleEditTrip = useCallback(() => {
    navigation.navigate('TripForm', { tripId });
  }, [navigation, tripId]);

  const handleSharePress = useCallback(() => {
    // If no lists exist, go directly to create screen
    if (!lists || lists.length === 0) {
      navigation.navigate('ListCreate', { tripId, tripName: trip?.name });
    } else {
      navigation.navigate('TripLists', { tripId, tripName: trip?.name });
    }
  }, [tripId, trip?.name, navigation, lists]);

  const handleEntryPress = useCallback(
    (entryId: string) => {
      navigation.navigate('EntryForm', { tripId, entryId });
    },
    [navigation, tripId]
  );

  const handleConfirmDelete = useCallback(async () => {
    setShowDeleteConfirm(false);
    try {
      await deleteTrip.mutateAsync(tripId);
      setDeletedTripId(tripId);
      setShowUndoSnackbar(true);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to delete trip. Please try again.';
      Alert.alert('Error', message);
    }
  }, [deleteTrip, tripId]);

  const handleUndo = useCallback(async () => {
    setShowUndoSnackbar(false);
    if (deletedTripId) {
      try {
        await restoreTrip.mutateAsync(deletedTripId);
        setDeletedTripId(null);
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

  const renderHeader = useCallback(
    () => (
      <View style={styles.gridHeader}>
        <View style={styles.journalHeaderContainer}>
          <Text style={styles.journalTitle}>Trip Log</Text>
          <View style={styles.journalLine} />
        </View>
      </View>
    ),
    []
  );

  if (tripLoading) {
    return (
      <View style={styles.centered}>
        <StatusBar barStyle="dark-content" />
        <ActivityIndicator size="large" color={colors.sunsetGold} />
      </View>
    );
  }

  if (tripError || !trip) {
    return (
      <View style={styles.centered}>
        <StatusBar barStyle="dark-content" />
        <Ionicons name="alert-circle-outline" size={48} color={colors.adobeBrick} />
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
          <Image
            source={{ uri: trip.cover_image_url! }}
            style={styles.coverImage}
            onError={() => setCoverImageError(true)}
          />

          {/* Gradient overlay */}
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.4)', 'rgba(0,0,0,0.8)']}
            style={styles.gradient}
          />

          {/* Trip name at bottom of hero */}
          <Text style={styles.tripNameOverlay}>{trip.name}</Text>

          {/* Header row - glass buttons */}
          <View style={[styles.headerRow, { top: insets.top + 8 }]}>
            <GlassBackButton onPress={() => navigation.goBack()} variant="dark" />
            <View style={styles.headerRightIcons}>
              <Pressable style={styles.glassButtonWrapper} onPress={handleEditTrip} hitSlop={8}>
                <BlurView intensity={20} tint="dark" style={styles.glassButton}>
                  <Ionicons name="pencil" size={20} color="#fff" />
                </BlurView>
              </Pressable>
              <Pressable style={styles.glassButtonWrapper} onPress={handleSharePress} hitSlop={8}>
                <BlurView intensity={20} tint="dark" style={styles.glassButton}>
                  <Ionicons name="share-outline" size={22} color="#fff" />
                </BlurView>
              </Pressable>
            </View>
          </View>
        </View>
      ) : (
        // NO COVER PHOTO - Simple header
        <View style={[styles.noCoverHeader, { paddingTop: insets.top }]}>
          {/* Header row */}
          <View style={styles.noCoverHeaderRow}>
            <GlassBackButton onPress={() => navigation.goBack()} />
            <View style={styles.headerRightIcons}>
              <Pressable onPress={handleEditTrip} hitSlop={8} style={styles.actionButton}>
                <Ionicons name="pencil" size={22} color={colors.midnightNavy} />
              </Pressable>
              <Pressable onPress={handleSharePress} hitSlop={8} style={styles.actionButton}>
                <Ionicons name="share-outline" size={24} color={colors.midnightNavy} />
              </Pressable>
            </View>
          </View>
          {/* Trip name */}
          <Text style={styles.tripNameNoCover}>{trip.name}</Text>
        </View>
      )}

      {/* Country badge (Luggage Tag Style) */}
      {country && (
        <View style={styles.countryBadgeContainer}>
          <View style={styles.luggageTag}>
            <View style={styles.luggageTagHole} />
            <Ionicons
              name="location-sharp"
              size={14}
              color={colors.adobeBrick}
              style={{ marginRight: 6 }}
            />
            <Text style={styles.countryName}>{country.name.toUpperCase()}</Text>
          </View>
        </View>
      )}

      {/* Entries grid */}
      {entriesLoading ? (
        <View style={styles.entriesLoading}>
          <ActivityIndicator size="small" color={colors.sunsetGold} />
        </View>
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(item) => item.id}
          renderItem={renderEntry}
          numColumns={2}
          columnWrapperStyle={styles.gridRow}
          contentContainerStyle={styles.entriesListContent}
          ListHeaderComponent={entries && entries.length > 0 ? renderHeader : null}
          ListEmptyComponent={<EmptyState onAddEntry={handleAddEntry} />}
          showsVerticalScrollIndicator={false}
          removeClippedSubviews={Platform.OS === 'android'}
          maxToRenderPerBatch={10}
          windowSize={5}
          initialNumToRender={6}
        />
      )}

      {/* Floating Add Entry Button - only show when there are entries */}
      {entries && entries.length > 0 && (
        <Pressable
          style={styles.fab}
          onPress={handleAddEntry}
          testID="fab-add-entry"
          accessibilityLabel="Add new entry"
          accessibilityRole="button"
        >
          <Ionicons name="add" size={24} color={colors.midnightNavy} />
          <Text style={styles.fabText}>Add Entry</Text>
        </Pressable>
      )}

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
    </View>
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
    padding: 24,
  },
  errorText: {
    fontSize: 16,
    color: colors.textSecondary,
    marginTop: 12,
    marginBottom: 24,
    fontFamily: fonts.openSans.regular,
  },
  retryButton: {
    backgroundColor: colors.sunsetGold,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryButtonText: {
    color: colors.midnightNavy,
    fontSize: 16,
    fontFamily: fonts.openSans.semiBold,
  },

  // Hero section (with cover photo)
  heroContainer: {
    position: 'relative',
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
    overflow: 'hidden',
    backgroundColor: colors.midnightNavy,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 8,
  },
  coverImage: {
    width: '100%',
    height: 320,
    backgroundColor: colors.backgroundMuted,
  },
  gradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 180,
  },
  tripNameOverlay: {
    position: 'absolute',
    bottom: 32,
    left: 24,
    right: 24,
    color: '#fff',
    fontFamily: fonts.playfair.bold,
    fontSize: 36,
    textShadowColor: 'rgba(0, 0, 0, 0.4)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
    letterSpacing: -0.5,
  },
  headerRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  headerRightIcons: {
    flexDirection: 'row',
    gap: 12,
  },
  glassButtonWrapper: {
    width: 44,
    height: 44,
    borderRadius: 22,
    overflow: 'hidden',
  },
  glassButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },

  // No cover header
  noCoverHeader: {
    backgroundColor: colors.warmCream,
    paddingBottom: 8,
  },
  noCoverHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  actionButton: {
    padding: 8,
  },
  tripNameNoCover: {
    fontFamily: fonts.playfair.bold,
    fontSize: 36,
    color: colors.midnightNavy,
    paddingHorizontal: 24,
    paddingVertical: 8,
    letterSpacing: -0.5,
  },

  // Country badge (Luggage Tag)
  countryBadgeContainer: {
    backgroundColor: colors.warmCream,
    paddingHorizontal: 24,
    paddingBottom: 20,
    marginTop: -20, // Overlap slightly if needed, or just standard spacing
    zIndex: 10,
  },
  luggageTag: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: colors.paperBeige,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
    transform: [{ rotate: '-1deg' }], // Whimsical tilt
  },
  luggageTagHole: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.warmCream,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.1)',
    marginRight: 10,
  },
  countryName: {
    fontFamily: fonts.oswald.medium,
    fontSize: 13,
    color: colors.midnightNavy,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },

  // Journal Header
  gridHeader: {
    marginBottom: 16,
    marginTop: 8,
    paddingHorizontal: 8,
  },
  journalHeaderContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  journalTitle: {
    fontFamily: fonts.dawning.regular,
    fontSize: 28,
    color: colors.adobeBrick,
    marginRight: 12,
  },
  journalLine: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(193, 84, 62, 0.1)',
    marginTop: 4,
  },

  // Entries grid
  entriesLoading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  entriesListContent: {
    padding: 16,
    paddingBottom: 130, // Space for FAB + Tab Bar
    flexGrow: 1,
    gap: 16,
  },
  gridRow: {
    justifyContent: 'space-between',
  },

  // Empty state
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
    paddingHorizontal: 32,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyTitle: {
    fontFamily: fonts.playfair.bold,
    fontSize: 22,
    color: colors.midnightNavy,
    marginTop: 8,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontFamily: fonts.openSans.regular,
    fontSize: 16,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 24,
    maxWidth: 260,
  },
  emptyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.sunsetGold,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  emptyButtonText: {
    color: colors.midnightNavy,
    fontSize: 16,
    fontFamily: fonts.openSans.semiBold,
  },

  // FAB
  fab: {
    position: 'absolute',
    bottom: 120,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.sunsetGold,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  fabText: {
    color: colors.midnightNavy,
    fontSize: 16,
    fontFamily: fonts.openSans.semiBold,
  },
});
