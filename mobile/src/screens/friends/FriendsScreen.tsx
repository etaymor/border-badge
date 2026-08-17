import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useCallback, useEffect, useMemo } from 'react';
import { ActivityIndicator, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  FeedCard,
  feedKeyExtractor,
  FeedSkeleton,
  FriendsStatsGrid,
  FriendsStatsSkeleton,
  InviteFollowBackPrompt,
  UserSearchBar,
} from '@components/friends';
import { ErrorState, NotificationBell } from '@components/ui';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { FlashList } from '@shopify/flash-list';
import { usePendingInviteRedemption } from '@hooks/useInvites';
import { useResponsive } from '@hooks/useResponsive';
import {
  useSocialHome,
  getSocialFeedItems,
  getSocialHomeStats,
  getSocialHomeRanking,
  getSocialPendingTagCount,
  type FeedItem,
} from '@hooks/useSocialHome';
import type { FriendsStackScreenProps } from '@navigation/types';
import { isSocialUnavailableError } from '@utils/socialErrors';

/** How many upcoming feed images to warm into the disk cache. */
const PREFETCH_IMAGE_COUNT = 10;

type Props = FriendsStackScreenProps<'FriendsHome'>;

export function FriendsScreen({ navigation }: Props) {
  const { isTablet, screenWidth } = useResponsive();
  const {
    data: socialData,
    isLoading,
    isError,
    error,
    isRefetching,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch,
  } = useSocialHome();

  // On iPad, constrain feed cards to 75% width centered
  const feedCardPaddingHorizontal = isTablet ? (screenWidth * 0.25) / 2 : 0;

  // Redeem any invite code stored by the deep-link handler (U7) and offer
  // the "follow back" prompt for the inviter.
  const { inviter: inviteFollowBackInviter, dismiss: dismissInviteFollowBack } =
    usePendingInviteRedemption();

  const feedItems = useMemo(() => getSocialFeedItems(socialData), [socialData]);

  // Warm the image cache for the next few feed cards so scrolling and
  // opening details shows images instantly (expo-image memory-disk cache).
  useEffect(() => {
    const urls = feedItems
      .slice(0, PREFETCH_IMAGE_COUNT)
      .map((item) => item.entry?.image_url)
      .filter((url): url is string => !!url);
    if (urls.length > 0 && typeof Image.prefetch === 'function') {
      Image.prefetch(urls, { cachePolicy: 'memory-disk' });
    }
  }, [feedItems]);
  const followStats = useMemo(() => getSocialHomeStats(socialData), [socialData]);
  const friendsRanking = useMemo(() => getSocialHomeRanking(socialData), [socialData]);
  const pendingTagCount = getSocialPendingTagCount(socialData);

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
      <View style={isTablet && { paddingHorizontal: feedCardPaddingHorizontal }}>
        <FeedCard
          item={item}
          onUserPress={handleUserSelect}
          onCountryPress={handleCountryPress}
          onEntryPress={handleEntryPress}
        />
      </View>
    ),
    [handleUserSelect, handleCountryPress, handleEntryPress, isTablet, feedCardPaddingHorizontal]
  );

  const ListHeader = useMemo(
    () => (
      <FriendsStatsGrid
        followerCount={followStats?.follower_count ?? 0}
        followingCount={followStats?.following_count ?? 0}
        rank={friendsRanking?.rank ?? null}
        isLoading={isLoading}
        onFollowersPress={handleViewFollowers}
        onFollowingPress={handleViewFollowing}
      />
    ),
    [followStats, friendsRanking, isLoading, handleViewFollowers, handleViewFollowing]
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

  const renderHeader = () => (
    <View style={styles.headerContainer}>
      <View style={styles.headerRow}>
        <View style={styles.headerSpacer} />
        <Text style={styles.headerTitle}>My Friends</Text>
        <View style={styles.headerRight}>
          <NotificationBell count={pendingTagCount} onPress={handleNotificationsPress} />
        </View>
      </View>
    </View>
  );

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        {renderHeader()}
        <FriendsStatsSkeleton />
        <FeedSkeleton />
      </SafeAreaView>
    );
  }

  if (isError && !socialData) {
    if (isSocialUnavailableError(error)) {
      return (
        <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
          {renderHeader()}
          <View style={styles.unavailableContainer}>
            <View style={styles.unavailableIconContainer}>
              <Ionicons name="cloud-offline-outline" size={48} color={colors.dustyCoral} />
            </View>
            <Text style={styles.unavailableTitle}>Social is taking a break</Text>
            <Text style={styles.unavailableSubtitle}>
              Friend features aren&apos;t available right now.{'\n'}Check back soon.
            </Text>
          </View>
        </SafeAreaView>
      );
    }
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        {renderHeader()}
        <ErrorState
          title="Couldn't load your feed"
          message="Something went wrong loading your friends' adventures."
          onRetry={() => refetch()}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {/* Header Title */}
      {renderHeader()}

      {/* Follow-back prompt after redeeming an invite deep link (U7) */}
      {inviteFollowBackInviter && (
        <View style={styles.invitePromptContainer}>
          <InviteFollowBackPrompt
            inviter={inviteFollowBackInviter}
            onDismiss={dismissInviteFollowBack}
          />
        </View>
      )}

      {/* User search - outside FlatList so dropdown can overlay empty state */}
      <View style={styles.userSearchContainer}>
        <UserSearchBar onUserSelect={handleUserSelect} placeholder="Find fellow travelers..." />
      </View>

      <FlashList
        data={feedItems}
        renderItem={renderFeedItem}
        keyExtractor={feedKeyExtractor}
        ListHeaderComponent={ListHeader}
        ListEmptyComponent={ListEmpty}
        ListFooterComponent={ListFooter}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
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
  unavailableContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  unavailableIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.paperBeige,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  unavailableTitle: {
    fontFamily: fonts.playfair.bold,
    fontSize: 22,
    color: colors.midnightNavy,
    marginBottom: 8,
  },
  unavailableSubtitle: {
    fontFamily: fonts.openSans.regular,
    fontSize: 15,
    color: colors.stormGray,
    textAlign: 'center',
    lineHeight: 22,
  },
  invitePromptContainer: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  userSearchContainer: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
    zIndex: 10,
    elevation: 10,
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
