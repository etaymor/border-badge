import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/* eslint-disable @typescript-eslint/no-require-imports */
const backpackIllustration = require('../../../assets/illustations/backpack-illustration-compressed.png');
const journalIllustration = require('../../../assets/illustations/journal-illustration-compressed.png');
/* eslint-enable @typescript-eslint/no-require-imports */

import { EntryGridCard } from '@components/entries';
import { ShareExtensionCallout } from '@components/share/ShareExtensionCallout';
import { ShareExtensionTutorialSheet } from '@components/share/ShareExtensionTutorialSheet';
import { SharedTripImage } from '@components/transitions/SharedTripImage';
import { ConfirmDialog, GlassBackButton, Snackbar } from '@components/ui';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { useCountryPhotoInfo } from '@hooks/useCountryPhotoInfo';
import { EntryWithPlace, useInfiniteEntries } from '@hooks/useEntries';
import { useTripLists } from '@hooks/useLists';
import { useStableCallback } from '@hooks/useStableCallback';
import { useDeleteTrip, useRestoreTrip, useTrip } from '@hooks/useTrips';
import { useUserCountries } from '@hooks/useUserCountries';
import type { TripsStackScreenProps } from '@navigation/types';
import { useSettingsStore } from '@stores/settingsStore';

type Props = TripsStackScreenProps<'TripDetail'>;

function EmptyState({ onAddEntry, isVisited }: { onAddEntry: () => void; isVisited: boolean }) {
  return (
    <View style={styles.emptyContainer}>
      <Image
        source={isVisited ? backpackIllustration : journalIllustration}
        style={styles.emptyIllustration}
        resizeMode="contain"
      />
      <Text style={styles.emptyTitle}>{isVisited ? 'Unwritten Memories' : 'Planning Mode'}</Text>
      <Text style={styles.emptySubtitle}>
        {isVisited
          ? 'This chapter is waiting to be written. Document your first memory.'
          : 'Add the places you want to visit and experiences you want to have.'}
      </Text>
      <Pressable style={styles.emptyButton} onPress={onAddEntry} testID="empty-add-entry-button">
        <Ionicons name="add" size={20} color={colors.midnightNavy} />
        <Text style={styles.emptyButtonText}>{isVisited ? 'Add Entry' : 'Add Place'}</Text>
      </Pressable>
    </View>
  );
}

export function TripDetailScreen({ route, navigation }: Props) {
  const { tripId, prefillPlace, prefillPhotos } = route.params;
  const insets = useSafeAreaInsets();
  const hasNavigatedToPrefill = useRef(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showUndoSnackbar, setShowUndoSnackbar] = useState(false);
  const [deletedTripId, setDeletedTripId] = useState<string | null>(null);
  const [coverImageError, setCoverImageError] = useState(false);
  const [showTutorialSheet, setShowTutorialSheet] = useState(false);

  const { data: trip, isLoading: tripLoading, error: tripError } = useTrip(tripId);
  const {
    data: entriesData,
    isLoading: entriesLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteEntries(tripId);
  const { data: lists } = useTripLists(tripId);

  // Flatten paginated entries for FlatList (memoized to prevent rebuilding on every render)
  const entries = useMemo(
    () => entriesData?.pages.flatMap((page) => page.entries) ?? [],
    [entriesData]
  );
  const { data: userCountries } = useUserCountries();
  const deleteTrip = useDeleteTrip();
  const restoreTrip = useRestoreTrip();
  const dismissShareExtensionTutorial = useSettingsStore((s) => s.dismissShareExtensionTutorial);

  // Check if user has visited this country
  const isVisited =
    userCountries?.some(
      (uc) => uc.country_code === trip?.country_code && uc.status === 'visited'
    ) ?? false;

  // Photo import state - show button only if no import has happened yet OR this country has photos
  const { hasPhotos, hasInitialImport } = useCountryPhotoInfo(trip?.country_code);
  const showPhotoImportButton = !hasInitialImport || hasPhotos;

  // Auto-navigate to EntryForm when coming from photo import with prefill data
  useEffect(() => {
    if (prefillPlace && prefillPhotos?.length && !hasNavigatedToPrefill.current) {
      hasNavigatedToPrefill.current = true;
      navigation.navigate('EntryForm', {
        tripId,
        entryType: prefillPlace.category,
        prefillPlace,
        prefillPhotos,
      });
    }
  }, [prefillPlace, prefillPhotos, tripId, navigation]);

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

  const handleImportPhotos = useCallback(() => {
    // PhotoImport is now in TripsNavigator, so navigate directly
    navigation.navigate('PhotoImport', {
      countryCode: trip?.country_code,
      tripId,
      autoStart: true,
      skipToSuggestions: hasPhotos && hasInitialImport,
    });
  }, [navigation, trip?.country_code, tripId, hasPhotos, hasInitialImport]);

  const handleEntryPress = useCallback(
    (entryId: string) => {
      navigation.navigate('EntryForm', { tripId, entryId });
    },
    [navigation, tripId]
  );

  // Identity-stable wrapper that always dispatches to the latest handler, so the
  // per-id callbacks below can be created once and cached.
  const stableEntryPress = useStableCallback(handleEntryPress);

  // Per-id, stable onPress callbacks so EntryGridCard's React.memo holds across
  // parent re-renders instead of being defeated by a fresh inline closure.
  const entryPressCallbacksRef = useRef<Map<string, () => void>>(new Map());
  const getEntryPressHandler = useCallback(
    (entryId: string) => {
      const existing = entryPressCallbacksRef.current.get(entryId);
      if (existing) return existing;
      const handler = () => stableEntryPress(entryId);
      entryPressCallbacksRef.current.set(entryId, handler);
      return handler;
    },
    [stableEntryPress]
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
      <EntryGridCard entry={item} onPress={getEntryPressHandler(item.id)} />
    ),
    [getEntryPressHandler]
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

  const handleOpenTutorial = useCallback(() => {
    setShowTutorialSheet(true);
  }, []);

  const handleCloseTutorial = useCallback(() => {
    setShowTutorialSheet(false);
    dismissShareExtensionTutorial();
  }, [dismissShareExtensionTutorial]);

  const renderFooter = useCallback(
    () => (
      <View>
        {isFetchingNextPage && (
          <View style={styles.paginationLoader}>
            <ActivityIndicator size="small" color={colors.sunsetGold} />
          </View>
        )}
        <ShareExtensionCallout onLearnMore={handleOpenTutorial} />
      </View>
    ),
    [handleOpenTutorial, isFetchingNextPage]
  );

  // Handle reaching end of list for infinite scroll
  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

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
          <SharedTripImage tripId={tripId} style={styles.sharedImageContainer}>
            <ExpoImage
              testID="trip-detail-cover-image"
              source={{ uri: trip.cover_image_url! }}
              style={styles.coverImage}
              contentFit="cover"
              recyclingKey={tripId}
              cachePolicy="memory-disk"
              onError={() => setCoverImageError(true)}
            />
          </SharedTripImage>

          {/* Gradient overlay */}
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.2)', 'rgba(0,0,0,0.6)', 'rgba(0,0,0,0.9)']}
            locations={[0, 0.3, 0.6, 1]}
            style={styles.gradient}
          />

          {/* Trip name at bottom of hero */}
          <Text style={styles.tripNameOverlay}>{trip.name}</Text>

          {/* Header row - glass buttons */}
          <View style={[styles.headerRow, { top: insets.top + 8 }]}>
            <GlassBackButton onPress={() => navigation.goBack()} variant="dark" />
            <View style={styles.headerRightIcons}>
              {showPhotoImportButton && (
                <Pressable
                  style={styles.glassButtonWrapper}
                  onPress={handleImportPhotos}
                  hitSlop={8}
                >
                  <BlurView intensity={20} tint="dark" style={styles.glassButton}>
                    <Ionicons name="images-outline" size={20} color="#fff" />
                  </BlurView>
                </Pressable>
              )}
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
              {showPhotoImportButton && (
                <Pressable onPress={handleImportPhotos} hitSlop={8} style={styles.actionButton}>
                  <Ionicons name="images-outline" size={22} color={colors.midnightNavy} />
                </Pressable>
              )}
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
          ListHeaderComponent={entries.length > 0 ? renderHeader : null}
          ListFooterComponent={renderFooter}
          ListEmptyComponent={<EmptyState onAddEntry={handleAddEntry} isVisited={isVisited} />}
          showsVerticalScrollIndicator={false}
          removeClippedSubviews={true}
          maxToRenderPerBatch={10}
          windowSize={5}
          initialNumToRender={6}
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.5}
        />
      )}

      {/* Floating Add Entry Button - only show when there are entries */}
      {entries.length > 0 && (
        <Pressable
          style={styles.fab}
          onPress={handleAddEntry}
          testID="fab-add-entry"
          accessibilityLabel="Add new entry"
          accessibilityRole="button"
        >
          <Ionicons name="add" size={32} color={colors.midnightNavy} />
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

      {/* Share Extension Tutorial Sheet */}
      <ShareExtensionTutorialSheet visible={showTutorialSheet} onClose={handleCloseTutorial} />
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
  sharedImageContainer: {
    width: '100%',
    height: 320,
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
    height: 240, // Taller gradient
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
  paginationLoader: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  entriesListContent: {
    padding: 16,
    paddingBottom: 130, // Space for FAB + Tab Bar
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
  emptyIllustration: {
    width: 120,
    height: 120,
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
    right: 20,
    bottom: 120,
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.sunsetGold,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 8,
  },
  fabText: {
    display: 'none',
  },
});
