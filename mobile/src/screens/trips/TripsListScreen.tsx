import { useCallback, memo } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { TripsStackScreenProps } from '@navigation/types';
import { useTrips, Trip } from '@hooks/useTrips';
import { useCountries } from '@hooks/useCountries';

type Props = TripsStackScreenProps<'TripsList'>;

// Parse PostgreSQL daterange format
function formatDateRange(dateRange: string | null): string {
  if (!dateRange) return '';

  const match = dateRange.match(/[[(]([^,]*),([^\])]*)[\])]/);
  if (!match) return '';

  const startStr = match[1].trim();
  const endStr = match[2].trim();

  const formatDate = (str: string) => {
    if (!str || str === '-infinity' || str === 'infinity') return null;
    const d = new Date(str);
    return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  };

  const start = formatDate(startStr);
  const end = formatDate(endStr);

  if (start && end && start !== end) {
    return `${start} - ${end}`;
  }
  if (start) return start;
  if (end) return end;
  return '';
}

interface TripCardProps {
  trip: Trip;
  countryName?: string;
  countryFlag?: string;
  onPress: () => void;
}

const TripCard = memo(function TripCard({
  trip,
  countryName,
  countryFlag,
  onPress,
}: TripCardProps) {
  const dateStr = formatDateRange(trip.date_range);

  return (
    <Pressable style={styles.tripCard} onPress={onPress} testID={`trip-card-${trip.id}`}>
      {trip.cover_image_url ? (
        <Image source={{ uri: trip.cover_image_url }} style={styles.tripImage} />
      ) : (
        <View style={styles.tripImagePlaceholder}>
          <Ionicons name="airplane" size={24} color="#ccc" />
        </View>
      )}
      <View style={styles.tripContent}>
        <Text style={styles.tripName} numberOfLines={1}>
          {trip.name}
        </Text>
        {(countryFlag || countryName) && (
          <View style={styles.countryRow}>
            {countryFlag && <Text style={styles.countryFlag}>{countryFlag}</Text>}
            {countryName && (
              <Text style={styles.countryName} numberOfLines={1}>
                {countryName}
              </Text>
            )}
          </View>
        )}
        {dateStr && <Text style={styles.tripDate}>{dateStr}</Text>}
      </View>
      <Ionicons name="chevron-forward" size={20} color="#ccc" />
    </Pressable>
  );
});

// Memoized components and helpers for FlatList performance
const ItemSeparator = memo(function ItemSeparator() {
  return <View style={styles.separator} />;
});
const keyExtractor = (item: Trip) => item.id;

// Item height = card padding (12*2) + content height (~60px) + separator (12) = ~96px
const ITEM_HEIGHT = 96;
const getItemLayout = (_: unknown, index: number) => ({
  length: ITEM_HEIGHT,
  offset: ITEM_HEIGHT * index,
  index,
});

function EmptyState({ onAddTrip }: { onAddTrip: () => void }) {
  return (
    <View style={styles.emptyContainer}>
      <Ionicons name="airplane-outline" size={64} color="#ccc" />
      <Text style={styles.emptyTitle}>No trips yet</Text>
      <Text style={styles.emptySubtitle}>
        Start documenting your travels by adding your first trip
      </Text>
      <Pressable style={styles.emptyButton} onPress={onAddTrip} testID="empty-add-trip-button">
        <Ionicons name="add" size={20} color="#fff" />
        <Text style={styles.emptyButtonText}>Add Your First Trip</Text>
      </Pressable>
    </View>
  );
}

export function TripsListScreen({ navigation }: Props) {
  const { data: trips, isLoading, isRefetching, refetch, error } = useTrips();
  const { data: countries } = useCountries();

  const handleAddTrip = useCallback(() => {
    navigation.navigate('TripForm', {});
  }, [navigation]);

  const handleTripPress = useCallback(
    (tripId: string) => {
      navigation.navigate('TripDetail', { tripId });
    },
    [navigation]
  );

  const getCountryInfo = useCallback(
    (countryId: string) => {
      const country = countries?.find((c) => c.cca3 === countryId || c.cca2 === countryId);
      return {
        name: country?.name,
        flag: country?.flag,
      };
    },
    [countries]
  );

  const renderItem = useCallback(
    ({ item }: { item: Trip }) => {
      const { name, flag } = getCountryInfo(item.country_id);
      return (
        <TripCard
          trip={item}
          countryName={name}
          countryFlag={flag}
          onPress={() => handleTripPress(item.id)}
        />
      );
    },
    [getCountryInfo, handleTripPress]
  );

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Ionicons name="alert-circle-outline" size={48} color="#FF3B30" />
        <Text style={styles.errorText}>Failed to load trips</Text>
        <Pressable style={styles.retryButton} onPress={() => refetch()}>
          <Text style={styles.retryButtonText}>Try Again</Text>
        </Pressable>
      </View>
    );
  }

  if (!trips?.length) {
    return <EmptyState onAddTrip={handleAddTrip} />;
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={trips}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor="#007AFF" />
        }
        ItemSeparatorComponent={ItemSeparator}
        removeClippedSubviews
        maxToRenderPerBatch={10}
        windowSize={5}
        initialNumToRender={10}
        getItemLayout={getItemLayout}
        testID="trips-list"
      />

      {/* FAB for adding new trip */}
      <Pressable style={styles.fab} onPress={handleAddTrip} testID="fab-add-trip">
        <Ionicons name="add" size={28} color="#fff" />
      </Pressable>
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
  listContent: {
    padding: 16,
    paddingBottom: 100, // Space for FAB
  },
  tripCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  tripImage: {
    width: 60,
    height: 60,
    borderRadius: 8,
    backgroundColor: '#e0e0e0',
  },
  tripImagePlaceholder: {
    width: 60,
    height: 60,
    borderRadius: 8,
    backgroundColor: '#f0f0f0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  tripContent: {
    flex: 1,
    marginLeft: 12,
    marginRight: 8,
  },
  tripName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 4,
  },
  countryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  countryFlag: {
    fontSize: 14,
    marginRight: 6,
  },
  countryName: {
    fontSize: 13,
    color: '#666',
    flex: 1,
  },
  tripDate: {
    fontSize: 12,
    color: '#999',
  },
  separator: {
    height: 12,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 32,
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
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#007AFF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
});
