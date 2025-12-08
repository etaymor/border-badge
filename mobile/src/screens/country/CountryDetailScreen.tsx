import { useCallback, useMemo } from 'react';
import {
  Dimensions,
  FlatList,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@components/ui';
import { useCountryByCode } from '@hooks/useCountries';
import { useTripsByCountry, Trip } from '@hooks/useTrips';
import type { PassportStackScreenProps } from '@navigation/types';
import { getFlagEmoji } from '@utils/flags';
import { getCountryImage } from '../../assets/countryImages';

type Props = PassportStackScreenProps<'CountryDetail'>;

// Helper to format date range from PostgreSQL format
function formatDateRange(dateRange?: string): string {
  if (!dateRange) return '';

  // Parse PostgreSQL daterange format: "[2024-01-01,2024-01-15]"
  const match = dateRange.match(/\[([^,]+),([^\]]+)\]/);
  if (!match) return '';

  const [, startStr, endStr] = match;

  // Handle infinity bounds
  if (startStr === '-infinity' || endStr === 'infinity') {
    return '';
  }

  const start = new Date(startStr);
  const end = new Date(endStr);

  const formatDate = (date: Date) =>
    date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

  if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
    return formatDate(start);
  }

  return `${formatDate(start)} - ${formatDate(end)}`;
}

const { width: screenWidth } = Dimensions.get('window');
// Image aspect ratio is 1856:2464 (width:height) = 0.753
const IMAGE_ASPECT_RATIO = 1856 / 2464;
const heroImageHeight = screenWidth / IMAGE_ASPECT_RATIO;

const ItemSeparator = () => <View style={styles.separator} />;

export function CountryDetailScreen({ navigation, route }: Props) {
  const { countryId, countryName, countryCode } = route.params;
  const insets = useSafeAreaInsets();

  // Use countryCode if available, otherwise use countryId (they should be the same)
  const code = countryCode || countryId;
  const { data: country } = useCountryByCode(code);
  const { data: trips, isLoading: loadingTrips, refetch } = useTripsByCountry(countryId);

  const flagEmoji = getFlagEmoji(code);
  const countryImage = getCountryImage(code);
  const displayName = country?.name || countryName || code;
  const region = country?.region || '';

  const handleAddTrip = useCallback(() => {
    // Navigate to trips stack and then to TripForm
    navigation.getParent()?.navigate('Trips', {
      screen: 'TripForm',
      params: {
        countryId,
        countryName: displayName,
      },
    });
  }, [countryId, displayName, navigation]);

  const handleTripPress = useCallback(
    (trip: Trip) => {
      // Navigate to trips stack and then to TripDetail
      navigation.getParent()?.navigate('Trips', {
        screen: 'TripDetail',
        params: { tripId: trip.id },
      });
    },
    [navigation]
  );

  const renderTripItem = useCallback(
    ({ item }: { item: Trip }) => {
      const dateStr = formatDateRange(item.date_range);

      return (
        <TouchableOpacity
          style={styles.tripCard}
          onPress={() => handleTripPress(item)}
          activeOpacity={0.7}
        >
          {item.cover_image_url ? (
            <Image source={{ uri: item.cover_image_url }} style={styles.tripImage} />
          ) : (
            <View style={styles.tripImagePlaceholder}>
              <Text style={styles.tripImagePlaceholderText}>{flagEmoji}</Text>
            </View>
          )}
          <View style={styles.tripInfo}>
            <Text style={styles.tripName} numberOfLines={1}>
              {item.name}
            </Text>
            {dateStr ? <Text style={styles.tripDate}>{dateStr}</Text> : null}
          </View>
          <Text style={styles.chevron}>{'>'}</Text>
        </TouchableOpacity>
      );
    },
    [flagEmoji, handleTripPress]
  );

  const ListHeader = useMemo(
    () => (
      <View style={styles.header}>
        {/* Hero Image */}
        {countryImage ? (
          <View style={[styles.heroContainer, { height: heroImageHeight }]}>
            <Image source={countryImage} style={styles.heroImage} resizeMode="cover" />
            <View style={[styles.heroContent, { top: insets.top + 44 }]}>
              <Text style={styles.heroFlag}>{flagEmoji}</Text>
              <Text style={styles.heroName}>{displayName}</Text>
              {region ? <Text style={styles.heroRegion}>{region}</Text> : null}
            </View>
          </View>
        ) : (
          <View style={[styles.countryHeader, { paddingTop: insets.top + 60 }]}>
            <Text style={styles.flagEmoji}>{flagEmoji}</Text>
            <Text style={styles.countryName}>{displayName}</Text>
            {region ? <Text style={styles.countryRegion}>{region}</Text> : null}
          </View>
        )}

        {/* Add Trip / Plan Trip Button */}
        <Button
          title={(trips?.length ?? 0) > 0 ? 'Add New Trip' : 'Plan a Trip'}
          onPress={handleAddTrip}
          style={styles.addTripButton}
        />

        {/* Trips Section Header */}
        {(trips?.length ?? 0) > 0 && (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>
              {trips?.length} {trips?.length === 1 ? 'Trip' : 'Trips'}
            </Text>
          </View>
        )}
      </View>
    ),
    [countryImage, insets.top, flagEmoji, displayName, region, trips?.length, handleAddTrip]
  );

  const ListEmpty = useMemo(
    () =>
      !loadingTrips ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>✈️</Text>
          <Text style={styles.emptyTitle}>No trips yet</Text>
          <Text style={styles.emptySubtitle}>Add your first trip to {displayName}</Text>
        </View>
      ) : null,
    [loadingTrips, displayName]
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={trips || []}
        renderItem={renderTripItem}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={ListHeader}
        ListEmptyComponent={ListEmpty}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={ItemSeparator}
        refreshing={loadingTrips}
        onRefresh={refetch}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  listContent: {
    flexGrow: 1,
  },
  header: {
    paddingTop: 0,
  },
  heroContainer: {
    position: 'relative',
    marginBottom: 20,
    backgroundColor: '#f5f5f5',
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  heroContent: {
    position: 'absolute',
    left: 20,
    right: 20,
  },
  heroFlag: {
    fontSize: 40,
    marginBottom: 8,
  },
  heroName: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#1a1a1a',
  },
  heroRegion: {
    fontSize: 16,
    color: '#666',
    marginTop: 4,
  },
  countryHeader: {
    alignItems: 'center',
    marginBottom: 24,
    paddingHorizontal: 20,
  },
  flagEmoji: {
    fontSize: 64,
    marginBottom: 12,
  },
  countryName: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#1a1a1a',
    textAlign: 'center',
  },
  countryRegion: {
    fontSize: 16,
    color: '#666',
    marginTop: 4,
  },
  addTripButton: {
    marginBottom: 24,
    marginHorizontal: 20,
  },
  sectionHeader: {
    marginBottom: 12,
    marginHorizontal: 20,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F2F2F7',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  tripCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  tripImage: {
    width: 56,
    height: 56,
    borderRadius: 8,
    marginRight: 12,
  },
  tripImagePlaceholder: {
    width: 56,
    height: 56,
    borderRadius: 8,
    backgroundColor: '#F2F2F7',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  tripImagePlaceholderText: {
    fontSize: 24,
  },
  tripInfo: {
    flex: 1,
  },
  tripName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  tripDate: {
    fontSize: 14,
    color: '#666',
    marginTop: 2,
  },
  chevron: {
    fontSize: 18,
    color: '#C7C7CC',
    fontWeight: '600',
  },
  separator: {
    height: 1,
    backgroundColor: '#F2F2F7',
    marginLeft: 88,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
    paddingVertical: 60,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
  },
});
