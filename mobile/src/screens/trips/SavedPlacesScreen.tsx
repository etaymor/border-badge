/**
 * SavedPlacesScreen - Displays entries saved to the uncategorized "Saved Places" trip.
 * Allows users to view, select, and move entries to other trips.
 */

import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import type { TripsStackScreenProps } from '@navigation/types';
import { useUncategorizedTrip } from '@hooks/useTrips';
import { useInfiniteEntries, EntryWithPlace } from '@hooks/useEntries';
import { EntryCard } from '@components/entries';
import { GlassBackButton } from '@components/ui';
import { MoveToTripSheet } from '@components/trips/MoveToTripSheet';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';

type Props = TripsStackScreenProps<'SavedPlaces'>;

function EmptyState() {
  return (
    <View style={styles.emptyContainer}>
      <View style={styles.emptyIconCircle}>
        <Text style={styles.emptyIcon}>✨</Text>
      </View>
      <Text style={styles.emptyTitle}>All Organized!</Text>
      <Text style={styles.emptySubtitle}>
        You&apos;ve sorted all your saved places.{'\n'}Share more places to see them here.
      </Text>
    </View>
  );
}

export function SavedPlacesScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { data: uncategorizedTrip, isLoading: isLoadingTrip } = useUncategorizedTrip();
  const {
    data,
    isLoading: isLoadingEntries,
    isRefetching,
    refetch,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteEntries(uncategorizedTrip?.id ?? '', { sort: 'created_at_desc' });

  const [selectedEntryIds, setSelectedEntryIds] = useState<Set<string>>(new Set());
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [showMoveSheet, setShowMoveSheet] = useState(false);
  const [singleEntryToMove, setSingleEntryToMove] = useState<string | null>(null);

  const isLoading = isLoadingTrip || isLoadingEntries;

  // Flatten pages into a single array of entries
  // Server already sorts by created_at_desc, so no client-side sorting needed
  const entries = useMemo(() => {
    if (!data?.pages) return [];
    return data.pages.flatMap((page) => page.entries);
  }, [data?.pages]);

  // Handle loading more entries when scrolling near end
  const handleLoadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Footer component for loading indicator during pagination
  const ListFooterComponent = useCallback(() => {
    if (!isFetchingNextPage) return null;
    return (
      <View style={styles.loadingFooter}>
        <ActivityIndicator size="small" color={colors.sunsetGold} />
      </View>
    );
  }, [isFetchingNextPage]);

  // Compute country code to filter trips in the move sheet.
  // For single entry: use that entry's country_code.
  // For bulk move: only filter if ALL selected entries have the same country_code.
  const moveSheetCountryCode = useMemo(() => {
    const entryIdsToMove = singleEntryToMove ? [singleEntryToMove] : Array.from(selectedEntryIds);
    if (entryIdsToMove.length === 0) return null;

    const entriesToMove = entries.filter((e) => entryIdsToMove.includes(e.id));
    if (entriesToMove.length === 0) return null;

    // Get unique country codes from selected entries
    const countryCodes = new Set(
      entriesToMove.map((e) => e.place?.country_code?.toUpperCase()).filter(Boolean)
    );

    // Only filter if all entries have the same country code
    if (countryCodes.size === 1) {
      return Array.from(countryCodes)[0] ?? null;
    }

    // Multiple countries or no country codes - don't filter
    return null;
  }, [singleEntryToMove, selectedEntryIds, entries]);

  const handleEntryPress = useCallback(
    (entry: EntryWithPlace) => {
      if (isSelectMode) {
        setSelectedEntryIds((prev) => {
          const next = new Set(prev);
          if (next.has(entry.id)) {
            next.delete(entry.id);
          } else {
            next.add(entry.id);
          }
          return next;
        });
      } else {
        // Single tap - open move sheet for this entry directly
        setSingleEntryToMove(entry.id);
        setShowMoveSheet(true);
      }
    },
    [isSelectMode]
  );

  const handleEntryLongPress = useCallback((entry: EntryWithPlace) => {
    setIsSelectMode(true);
    setSelectedEntryIds(new Set([entry.id]));
  }, []);

  const toggleSelectMode = useCallback(() => {
    if (isSelectMode) {
      setIsSelectMode(false);
      setSelectedEntryIds(new Set());
    } else {
      setIsSelectMode(true);
    }
  }, [isSelectMode]);

  const handleMoveSelected = useCallback(() => {
    if (selectedEntryIds.size > 0) {
      setShowMoveSheet(true);
    }
  }, [selectedEntryIds]);

  const handleMoveComplete = useCallback(() => {
    setShowMoveSheet(false);
    setSelectedEntryIds(new Set());
    setSingleEntryToMove(null);
    setIsSelectMode(false);
    refetch();
  }, [refetch]);

  const handleMoveCancel = useCallback(() => {
    setShowMoveSheet(false);
    setSingleEntryToMove(null);
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: EntryWithPlace }) => {
      const isSelected = selectedEntryIds.has(item.id);
      return (
        <View style={styles.entryItemContainer}>
          {isSelectMode && (
            <Pressable style={styles.checkbox} onPress={() => handleEntryPress(item)} hitSlop={8}>
              <Ionicons
                name={isSelected ? 'checkmark-circle' : 'ellipse-outline'}
                size={24}
                color={isSelected ? colors.mossGreen : colors.stormGray}
              />
            </Pressable>
          )}
          <View style={styles.entryCardWrapper}>
            <EntryCard
              entry={item}
              onPress={() => handleEntryPress(item)}
              onLongPress={() => handleEntryLongPress(item)}
            />
          </View>
        </View>
      );
    },
    [isSelectMode, selectedEntryIds, handleEntryPress, handleEntryLongPress]
  );

  const keyExtractor = useCallback((item: EntryWithPlace) => item.id, []);

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.sunsetGold} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Ionicons name="alert-circle-outline" size={48} color={colors.adobeBrick} />
        <Text style={styles.errorText}>Failed to load saved places</Text>
        <Pressable style={styles.retryButton} onPress={() => refetch()}>
          <Text style={styles.retryButtonText}>Try Again</Text>
        </Pressable>
      </View>
    );
  }

  const hasEntries = entries.length > 0;
  // Use entry_count from trip for accurate total (includes entries not yet loaded)
  const totalEntryCount = uncategorizedTrip?.entry_count ?? entries.length;

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <GlassBackButton onPress={() => navigation.goBack()} />
        <View style={styles.headerContent}>
          <Text style={styles.headerTitle}>Saved Places</Text>
          <Text style={styles.headerSubtitle}>
            {hasEntries
              ? `${totalEntryCount} ${totalEntryCount === 1 ? 'place' : 'places'} waiting to be organized`
              : 'No places to organize'}
          </Text>
        </View>
        {hasEntries && (
          <Pressable style={styles.selectButton} onPress={toggleSelectMode}>
            <Text style={styles.selectButtonText}>{isSelectMode ? 'Cancel' : 'Select'}</Text>
          </Pressable>
        )}
      </View>

      {/* Entry List */}
      {hasEntries ? (
        <FlatList
          data={entries}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching && !isFetchingNextPage}
              onRefresh={refetch}
              tintColor={colors.sunsetGold}
            />
          }
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListFooterComponent={ListFooterComponent}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.5}
          testID="saved-places-list"
        />
      ) : (
        <EmptyState />
      )}

      {/* Move Selected Button */}
      {isSelectMode && selectedEntryIds.size > 0 && (
        <View style={styles.moveButtonContainer}>
          <Pressable style={styles.moveButton} onPress={handleMoveSelected}>
            <Ionicons name="folder-outline" size={20} color={colors.midnightNavy} />
            <Text style={styles.moveButtonText}>
              Move Selected ({selectedEntryIds.size}) to Trip
            </Text>
          </Pressable>
        </View>
      )}

      {/* Move to Trip Sheet */}
      <MoveToTripSheet
        visible={showMoveSheet}
        entryIds={singleEntryToMove ? [singleEntryToMove] : Array.from(selectedEntryIds)}
        onComplete={handleMoveComplete}
        onCancel={handleMoveCancel}
        countryCode={moveSheetCountryCode}
      />
    </SafeAreaView>
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
    borderRadius: 12,
  },
  retryButtonText: {
    color: colors.midnightNavy,
    fontSize: 16,
    fontFamily: fonts.openSans.semiBold,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 16,
    backgroundColor: colors.warmCream,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0, 0, 0, 0.05)',
    gap: 12,
  },
  headerContent: {
    flex: 1,
  },
  headerTitle: {
    fontFamily: fonts.playfair.bold,
    fontSize: 24,
    color: colors.midnightNavy,
  },
  headerSubtitle: {
    fontFamily: fonts.openSans.regular,
    fontSize: 14,
    color: colors.stormGray,
    marginTop: 4,
  },
  selectButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.05)',
  },
  selectButtonText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 14,
    color: colors.midnightNavy,
  },
  listContent: {
    padding: 16,
    paddingBottom: 100,
  },
  separator: {
    height: 12,
  },
  loadingFooter: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  entryItemContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  checkbox: {
    paddingRight: 12,
    paddingTop: 16,
  },
  entryCardWrapper: {
    flex: 1,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  emptyIconCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(84, 122, 95, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
    borderWidth: 1,
    borderColor: 'rgba(84, 122, 95, 0.3)',
    borderStyle: 'dashed',
  },
  emptyIcon: {
    fontSize: 48,
  },
  emptyTitle: {
    fontFamily: fonts.playfair.bold,
    fontSize: 24,
    color: colors.midnightNavy,
    marginBottom: 12,
  },
  emptySubtitle: {
    fontFamily: fonts.openSans.regular,
    fontSize: 16,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 24,
  },
  moveButtonContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
    backgroundColor: colors.warmCream,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0, 0, 0, 0.05)',
  },
  moveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.sunsetGold,
    paddingVertical: 16,
    borderRadius: 12,
    gap: 8,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  moveButtonText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 16,
    color: colors.midnightNavy,
  },
});
