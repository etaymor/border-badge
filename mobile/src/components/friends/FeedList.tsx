import React from 'react';
import { FlatList, View, Text, ActivityIndicator, StyleSheet, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { useFeed, type FeedItem } from '@hooks/useFeed';
import { ActivityFeedCard } from './ActivityFeedCard';
import type { RootStackParamList } from '@navigation/types';

type FeedListNavigationProp = NativeStackNavigationProp<RootStackParamList>;

export function FeedList() {
  const navigation = useNavigation<FeedListNavigationProp>();

  const { data, isLoading, error, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useFeed();

  const handleItemPress = (item: FeedItem) => {
    // Navigate to appropriate screen based on activity type
    if (item.trip_id) {
      navigation.navigate('TripDetail', { tripId: item.trip_id });
    } else if (item.country_id) {
      navigation.navigate('CountryDetail', {
        countryId: item.country_id,
        countryName: item.country_name || undefined,
        countryCode: item.country_code || undefined,
      });
    }
  };

  const handleLoadMore = () => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  };

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.sunsetGold} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.emptyState}>
        <Ionicons name="alert-circle-outline" size={64} color={colors.textSecondary} />
        <Text style={styles.emptyStateTitle}>Error Loading Feed</Text>
        <Text style={styles.emptyStateText}>Something went wrong. Pull down to try again.</Text>
      </View>
    );
  }

  // Flatten all pages into single array
  const allItems = data?.pages.flatMap((page) => page.items) || [];

  if (allItems.length === 0) {
    return (
      <View style={styles.emptyState}>
        <Ionicons name="people-outline" size={64} color={colors.textSecondary} />
        <Text style={styles.emptyStateTitle}>No Activity Yet</Text>
        <Text style={styles.emptyStateText}>
          Follow friends to see their travel activities here
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      data={allItems}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <ActivityFeedCard item={item} onPress={() => handleItemPress(item)} />
      )}
      contentContainerStyle={styles.listContent}
      showsVerticalScrollIndicator={false}
      onEndReached={handleLoadMore}
      onEndReachedThreshold={0.5}
      refreshControl={
        <RefreshControl refreshing={false} onRefresh={refetch} tintColor={colors.sunsetGold} />
      }
      ListFooterComponent={() =>
        isFetchingNextPage ? (
          <View style={styles.footerLoading}>
            <ActivityIndicator size="small" color={colors.sunsetGold} />
          </View>
        ) : null
      }
    />
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  listContent: {
    padding: 16,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  emptyStateTitle: {
    fontSize: 20,
    fontFamily: fonts.bold,
    color: colors.text,
    marginTop: 16,
    marginBottom: 8,
    textAlign: 'center',
  },
  emptyStateText: {
    fontSize: 16,
    fontFamily: fonts.regular,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 24,
  },
  footerLoading: {
    paddingVertical: 16,
    alignItems: 'center',
  },
});
