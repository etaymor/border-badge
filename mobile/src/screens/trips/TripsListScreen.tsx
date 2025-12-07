import { useCallback, memo, useMemo } from 'react';
import {
  ActivityIndicator,
  SectionList,
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
import { useUserCountries } from '@hooks/useUserCountries';

type Props = TripsStackScreenProps<'TripsList'>;

// Parse PostgreSQL daterange format
function formatDateRange(dateRange: string | null | undefined): string {
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
  onPress: () => void;
}

const TripCard = memo(function TripCard({ trip, countryName, onPress }: TripCardProps) {
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
        {countryName && (
          <View style={styles.countryRow}>
            <Text style={styles.countryName} numberOfLines={1}>
              {countryName}
            </Text>
          </View>
        )}
        {dateStr && <Text style={styles.tripDate}>{dateStr}</Text>}
      </View>
      <Ionicons name="chevron-forward" size={20} color="#ccc" />
    </Pressable>
  );
});

// Memoized components and helpers for SectionList performance
const ItemSeparator = memo(function ItemSeparator() {
  return <View style={styles.separator} />;
});
const keyExtractor = (item: Trip) => item.id;

interface TripSection {
  title: string;
  data: Trip[];
}

const SectionHeader = memo(function SectionHeader({ title }: { title: string }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionHeaderText}>{title}</Text>
    </View>
  );
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
  const { data: userCountries } = useUserCountries();

  // Create a set of visited country codes for quick lookup
  const visitedCountryCodes = useMemo(() => {
    if (!userCountries) return new Set<string>();
    return new Set(
      userCountries.filter((uc) => uc.status === 'visited').map((uc) => uc.country_code)
    );
  }, [userCountries]);

  // Separate trips into sections based on whether the country has been visited
  const sections = useMemo((): TripSection[] => {
    if (!trips?.length) return [];

    const visitedTrips: Trip[] = [];
    const plannedTrips: Trip[] = [];

    trips.forEach((trip) => {
      // Use country_code if available, otherwise fall back to country_id
      const countryCode = trip.country_code || trip.country_id;
      if (visitedCountryCodes.has(countryCode)) {
        visitedTrips.push(trip);
      } else {
        plannedTrips.push(trip);
      }
    });

    const result: TripSection[] = [];
    if (visitedTrips.length > 0) {
      result.push({ title: 'My Trips', data: visitedTrips });
    }
    if (plannedTrips.length > 0) {
      result.push({ title: 'Planned Trips', data: plannedTrips });
    }
    return result;
  }, [trips, visitedCountryCodes]);

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
      // Country ID is stored as the country code
      const country = countries?.find((c) => c.code === countryId);
      return {
        name: country?.name,
      };
    },
    [countries]
  );

  const renderItem = useCallback(
    ({ item }: { item: Trip }) => {
      const { name } = getCountryInfo(item.country_id);
      return <TripCard trip={item} countryName={name} onPress={() => handleTripPress(item.id)} />;
    },
    [getCountryInfo, handleTripPress]
  );

  const renderSectionHeader = useCallback(
    ({ section }: { section: TripSection }) => <SectionHeader title={section.title} />,
    []
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
      <SectionList
        sections={sections}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        renderSectionHeader={renderSectionHeader}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor="#007AFF" />
        }
        ItemSeparatorComponent={ItemSeparator}
        stickySectionHeadersEnabled={false}
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
  sectionHeader: {
    paddingTop: 8,
    paddingBottom: 12,
  },
  sectionHeaderText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1a1a1a',
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
