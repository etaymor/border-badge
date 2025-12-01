import { useCallback, useMemo } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useCountries } from '@hooks/useCountries';
import { useUserCountries } from '@hooks/useUserCountries';
import type { PassportStackScreenProps } from '@navigation/types';
import { getFlagEmoji } from '@utils/flags';

type Props = PassportStackScreenProps<'PassportHome'>;

interface CountryDisplayItem {
  code: string;
  name: string;
  region: string;
  status: 'visited' | 'wishlist';
}

export function PassportScreen({ navigation }: Props) {
  const { data: userCountries, isLoading: loadingUserCountries } = useUserCountries();
  const { data: countries, isLoading: loadingCountries } = useCountries();

  // Combine user countries with country metadata
  const displayItems = useMemo((): CountryDisplayItem[] => {
    if (!userCountries || !countries) return [];

    // Filter to only visited countries for the passport
    const visitedCodes = userCountries
      .filter((uc) => uc.status === 'visited')
      .map((uc) => uc.country_code);

    return countries
      .filter((c) => visitedCodes.includes(c.code))
      .map((c) => ({
        code: c.code,
        name: c.name,
        region: c.region,
        status: 'visited' as const,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [userCountries, countries]);

  // Stats
  const visitedCount = displayItems.length;
  const totalCountries = countries?.length || 197;
  const percentage = Math.round((visitedCount / totalCountries) * 100);

  const handleCountryPress = useCallback(
    (item: CountryDisplayItem) => {
      navigation.navigate('CountryDetail', {
        countryId: item.code,
        countryName: item.name,
        countryCode: item.code,
      });
    },
    [navigation]
  );

  const renderCountryItem = useCallback(
    ({ item }: { item: CountryDisplayItem }) => {
      const flagEmoji = getFlagEmoji(item.code);

      return (
        <TouchableOpacity
          style={styles.countryCard}
          onPress={() => handleCountryPress(item)}
          activeOpacity={0.7}
        >
          <View style={styles.flagContainer}>
            <Text style={styles.flagEmoji}>{flagEmoji}</Text>
          </View>
          <View style={styles.countryInfo}>
            <Text style={styles.countryName} numberOfLines={1}>
              {item.name}
            </Text>
            <Text style={styles.countryRegion}>{item.region}</Text>
          </View>
          <Text style={styles.chevron}>{'>'}</Text>
        </TouchableOpacity>
      );
    },
    [handleCountryPress]
  );

  const isLoading = loadingUserCountries || loadingCountries;

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right']}>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Loading passport...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      {/* Stats Header */}
      <View style={styles.statsHeader}>
        <View style={styles.statsMain}>
          <Text style={styles.statsNumber}>{visitedCount}</Text>
          <Text style={styles.statsLabel}>countries visited</Text>
        </View>
        <View style={styles.statsProgress}>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: `${percentage}%` }]} />
          </View>
          <Text style={styles.progressText}>
            {percentage}% of {totalCountries} countries
          </Text>
        </View>
      </View>

      {/* Country List */}
      {displayItems.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>🌍</Text>
          <Text style={styles.emptyTitle}>No countries yet</Text>
          <Text style={styles.emptySubtitle}>Create a trip to start building your passport!</Text>
        </View>
      ) : (
        <FlatList
          data={displayItems}
          renderItem={renderCountryItem}
          keyExtractor={(item) => item.code}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      )}
    </SafeAreaView>
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
  },
  loadingText: {
    fontSize: 16,
    color: '#666',
  },
  statsHeader: {
    paddingHorizontal: 20,
    paddingVertical: 24,
    backgroundColor: '#F8F9FA',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5EA',
  },
  statsMain: {
    alignItems: 'center',
    marginBottom: 16,
  },
  statsNumber: {
    fontSize: 48,
    fontWeight: 'bold',
    color: '#007AFF',
  },
  statsLabel: {
    fontSize: 16,
    color: '#666',
    marginTop: 4,
  },
  statsProgress: {
    alignItems: 'center',
  },
  progressBar: {
    width: '100%',
    height: 8,
    backgroundColor: '#E5E5EA',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#007AFF',
    borderRadius: 4,
  },
  progressText: {
    fontSize: 14,
    color: '#666',
    marginTop: 8,
  },
  listContent: {
    padding: 16,
  },
  countryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  flagContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#F2F2F7',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  flagEmoji: {
    fontSize: 24,
  },
  countryInfo: {
    flex: 1,
  },
  countryName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  countryRegion: {
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
    marginLeft: 64,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  emptyIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
  },
});
