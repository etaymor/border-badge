import { Ionicons } from '@expo/vector-icons';
import { useCallback, useMemo } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FeedCard } from '@components/friends';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { useFeed, getFeedItems, type FeedItem } from '@hooks/useFeed';
import type { FriendsStackScreenProps } from '@navigation/types';

type Props = FriendsStackScreenProps<'FeedHome'>;

export function FeedScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const {
    data,
    isLoading,
    isRefetching,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch,
  } = useFeed();

  const feedItems = useMemo(() => getFeedItems(data), [data]);

  const handleUserPress = useCallback(
    (userId: string, username: string) => {
      navigation.navigate('UserProfile', { userId, username });
    },
    [navigation]
  );

  const handleCountryPress = useCallback(
    (countryCode: string, countryName: string) => {
      // Navigate to Passport tab's CountryDetail screen
      // Using getParent() to access the tab navigator, then navigate to Passport stack
      const tabNavigator = navigation.getParent();
      if (tabNavigator) {
        tabNavigator.navigate('Passport', {
          screen: 'CountryDetail',
          params: {
            countryId: countryCode, // Using countryCode as ID since that's what CountryDetail expects
            countryName,
            countryCode,
          },
        });
      }
    },
    [navigation]
  );

  const handleEntryPress = useCallback(
    (entryId: string) => {
      // Navigate to Trips tab's EntryDetail screen
      const tabNavigator = navigation.getParent();
      if (tabNavigator) {
        tabNavigator.navigate('Trips', {
          screen: 'EntryDetail',
          params: { entryId },
        });
      }
    },
    [navigation]
  );

  const handleLoadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const renderItem = useCallback(
    ({ item }: { item: FeedItem }) => (
      <FeedCard
        item={item}
        onUserPress={handleUserPress}
        onCountryPress={handleCountryPress}
        onEntryPress={handleEntryPress}
      />
    ),
    [handleUserPress, handleCountryPress, handleEntryPress]
  );

  const ListHeader = useMemo(
    () => (
      <View style={[styles.headerContainer, { paddingTop: insets.top + 16 }]}>
        <Text style={styles.headerTitle}>Activity Feed</Text>
      </View>
    ),
    [insets.top]
  );

  const ListEmpty = useMemo(
    () => (
      <View style={styles.emptyState}>
        <Ionicons name="newspaper-outline" size={64} color={colors.textTertiary} />
        <Text style={styles.emptyTitle}>No activity yet</Text>
        <Text style={styles.emptySubtitle}>
          Follow some friends to see their travel activity here
        </Text>
      </View>
    ),
    []
  );

  const ListFooter = useMemo(
    () =>
      isFetchingNextPage ? (
        <View style={styles.footerLoader}>
          <ActivityIndicator size="small" color={colors.primary} />
        </View>
      ) : null,
    [isFetchingNextPage]
  );

  if (isLoading) {
    return (
      <View style={styles.container}>
        <View style={[styles.headerContainer, { paddingTop: insets.top + 16 }]}>
          <Text style={styles.headerTitle}>Activity Feed</Text>
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={feedItems}
        renderItem={renderItem}
        keyExtractor={(item, index) => `${item.activity_type}-${item.created_at}-${index}`}
        ListHeaderComponent={ListHeader}
        ListEmptyComponent={ListEmpty}
        ListFooterComponent={ListFooter}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.5}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor={colors.primary}
          />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.warmCream,
  },
  headerContainer: {
    backgroundColor: colors.lakeBlue,
    paddingBottom: 24,
    alignItems: 'center',
    marginBottom: 12,
  },
  headerTitle: {
    fontFamily: fonts.playfair.bold,
    fontSize: 28,
    color: colors.midnightNavy,
    fontStyle: 'italic',
    letterSpacing: -0.5,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  listContent: {
    paddingBottom: 100,
    flexGrow: 1,
  },
  emptyState: {
    flex: 1,
    paddingVertical: 60,
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  emptyTitle: {
    fontFamily: fonts.playfair.bold,
    fontSize: 20,
    color: colors.midnightNavy,
    marginTop: 16,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontFamily: fonts.openSans.regular,
    fontSize: 16,
    color: colors.stormGray,
    textAlign: 'center',
    lineHeight: 24,
  },
  footerLoader: {
    paddingVertical: 20,
    alignItems: 'center',
  },
});
