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
import { SafeAreaView } from 'react-native-safe-area-context';

import { FeedCard, FriendsStatsGrid, UserSearchBar } from '@components/friends';
import { NotificationBell } from '@components/ui';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { useFeed, getFeedItems, type FeedItem } from '@hooks/useFeed';
import { useFollowStats } from '@hooks/useFollows';
import { useFriendsRanking } from '@hooks/useFriendsRanking';
import { usePendingTripTags } from '@hooks/useTripTags';
import type { FriendsStackScreenProps } from '@navigation/types';

type Props = FriendsStackScreenProps<'FriendsHome'>;

export function FriendsScreen({ navigation }: Props) {
  const { data: stats, isLoading: statsLoading } = useFollowStats();
  const { data: ranking, isLoading: rankingLoading } = useFriendsRanking();
  const { data: pendingTags } = usePendingTripTags();
  const {
    data: feedData,
    isLoading: feedLoading,
    isRefetching,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch,
  } = useFeed();

  const feedItems = useMemo(() => getFeedItems(feedData), [feedData]);
  const isLoading = statsLoading || feedLoading;

  const handleNotificationsPress = useCallback(() => {
    navigation.navigate('PendingTripTags');
  }, [navigation]);

  const handleUserSelect = useCallback(
    (userId: string, username: string) => {
      navigation.navigate('UserProfile', { userId, username });
    },
    [navigation]
  );

  const handleViewFollowers = useCallback(() => {
    navigation.navigate('FollowersList');
  }, [navigation]);

  const handleViewFollowing = useCallback(() => {
    navigation.navigate('FollowingList');
  }, [navigation]);

  const handleCountryPress = useCallback(
    (countryCode: string, countryName: string) => {
      const tabNavigator = navigation.getParent();
      if (tabNavigator) {
        tabNavigator.navigate('Passport', {
          screen: 'CountryDetail',
          params: {
            countryId: countryCode,
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

  const renderFeedItem = useCallback(
    ({ item }: { item: FeedItem }) => (
      <FeedCard
        item={item}
        onUserPress={handleUserSelect}
        onCountryPress={handleCountryPress}
        onEntryPress={handleEntryPress}
      />
    ),
    [handleUserSelect, handleCountryPress, handleEntryPress]
  );

  const ListHeader = useMemo(
    () => (
      <FriendsStatsGrid
        followerCount={stats?.follower_count ?? 0}
        followingCount={stats?.following_count ?? 0}
        rank={ranking?.rank ?? null}
        isLoading={statsLoading || rankingLoading}
        onFollowersPress={handleViewFollowers}
        onFollowingPress={handleViewFollowing}
      />
    ),
    [stats, ranking, statsLoading, rankingLoading, handleViewFollowers, handleViewFollowing]
  );

  const ListEmpty = useMemo(
    () => (
      <View style={styles.emptyState}>
        <View style={styles.emptyIconContainer}>
          <Ionicons name="trail-sign-outline" size={48} color={colors.dustyCoral} />
        </View>
        <Text style={styles.emptyTitle}>The trail is quiet</Text>
        <Text style={styles.emptySubtitle}>
          Follow fellow travelers to see their{'\n'}adventures unfold here
        </Text>
        <View style={styles.emptyHint}>
          <Ionicons name="search" size={14} color={colors.stormGray} />
          <Text style={styles.emptyHintText}>Use the search above to find travelers</Text>
        </View>
      </View>
    ),
    []
  );

  const ListFooter = useMemo(
    () =>
      isFetchingNextPage ? (
        <View style={styles.footerLoader}>
          <ActivityIndicator size="small" color={colors.adobeBrick} />
          <Text style={styles.footerText}>Loading more stories...</Text>
        </View>
      ) : null,
    [isFetchingNextPage]
  );

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <View style={styles.headerContainer}>
          <View style={styles.headerRow}>
            <View style={styles.headerSpacer} />
            <Text style={styles.headerTitle}>My Friends</Text>
            <View style={styles.headerRight}>
              <NotificationBell
                count={pendingTags?.length ?? 0}
                onPress={handleNotificationsPress}
              />
            </View>
          </View>
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.adobeBrick} />
          <Text style={styles.loadingText}>Loading feed...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {/* Header Title */}
      <View style={styles.headerContainer}>
        <View style={styles.headerRow}>
          <View style={styles.headerSpacer} />
          <Text style={styles.headerTitle}>My Friends</Text>
          <View style={styles.headerRight}>
            <NotificationBell count={pendingTags?.length ?? 0} onPress={handleNotificationsPress} />
          </View>
        </View>
      </View>

      {/* User search - outside FlatList so dropdown can overlay empty state */}
      <View style={styles.userSearchContainer}>
        <UserSearchBar onUserSelect={handleUserSelect} placeholder="Find fellow travelers..." />
      </View>

      <FlatList
        data={feedItems}
        renderItem={renderFeedItem}
        keyExtractor={(item, index) => `${item.activity_type}-${item.created_at}-${index}`}
        ListHeaderComponent={ListHeader}
        ListEmptyComponent={ListEmpty}
        ListFooterComponent={ListFooter}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        style={styles.flatList}
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.5}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor={colors.adobeBrick}
            colors={[colors.adobeBrick]}
          />
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.warmCream,
  },
  headerContainer: {
    paddingTop: 16,
    paddingBottom: 8,
    paddingHorizontal: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerSpacer: {
    width: 40,
  },
  headerRight: {
    width: 40,
    alignItems: 'flex-end',
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
    gap: 12,
  },
  loadingText: {
    fontFamily: fonts.openSans.regular,
    fontSize: 14,
    color: colors.stormGray,
  },
  userSearchContainer: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
    zIndex: 10,
    elevation: 10,
  },
  flatList: {
    zIndex: 1,
  },
  listContent: {
    paddingBottom: 100,
    flexGrow: 1,
  },
  emptyState: {
    flex: 1,
    paddingVertical: 48,
    alignItems: 'center',
    paddingHorizontal: 32,
    marginHorizontal: 16,
    marginTop: 8,
    backgroundColor: colors.cloudWhite,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.paperBeige,
    borderStyle: 'dashed',
  },
  emptyIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.paperBeige,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontFamily: fonts.playfair.bold,
    fontSize: 22,
    color: colors.midnightNavy,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontFamily: fonts.openSans.regular,
    fontSize: 15,
    color: colors.stormGray,
    textAlign: 'center',
    lineHeight: 22,
  },
  emptyHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: colors.paperBeige,
    borderRadius: 20,
  },
  emptyHintText: {
    fontFamily: fonts.openSans.regular,
    fontSize: 13,
    color: colors.stormGray,
  },
  footerLoader: {
    paddingVertical: 24,
    alignItems: 'center',
    gap: 8,
  },
  footerText: {
    fontFamily: fonts.openSans.regular,
    fontSize: 13,
    color: colors.stormGray,
    fontStyle: 'italic',
  },
});
