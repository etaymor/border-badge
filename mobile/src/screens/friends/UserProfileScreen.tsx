import { Ionicons } from '@expo/vector-icons';
import { useCallback, useMemo, useState } from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FeedCard, FollowButton, UserAvatar } from '@components/friends';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { useBlockUser } from '@hooks/useBlocks';
import type { FeedItem } from '@hooks/useFeed';
import { useUserFeed, getUserFeedItems } from '@hooks/useUserFeed';
import { useUserProfile } from '@hooks/useUserProfile';
import type { FriendsStackScreenProps } from '@navigation/types';

type Props = FriendsStackScreenProps<'UserProfile'>;

export function UserProfileScreen({ navigation, route }: Props) {
  const { userId, username } = route.params;
  const insets = useSafeAreaInsets();
  const [isBlocking, setIsBlocking] = useState(false);

  const { data: profile, isLoading, error } = useUserProfile(username);
  const blockMutation = useBlockUser(profile?.user_id ?? '');

  // Fetch user's activity feed
  const {
    data: feedData,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useUserFeed(userId);

  const feedItems = useMemo(() => getUserFeedItems(feedData), [feedData]);

  const handleBack = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  const confirmBlock = useCallback(async () => {
    if (!profile || isBlocking) return;

    setIsBlocking(true);
    try {
      await blockMutation.mutateAsync();
      Alert.alert(
        'User Blocked',
        `@${profile.username} has been blocked. They will no longer be able to see your profile or follow you.`,
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
    } catch {
      setIsBlocking(false);
    }
  }, [profile, isBlocking, blockMutation, navigation]);

  const handleBlock = useCallback(() => {
    if (!profile) return;

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Cancel', 'Block User', 'Report User'],
          destructiveButtonIndex: 1,
          cancelButtonIndex: 0,
          title: `@${profile.username}`,
          message: 'Blocking will remove them from your followers and prevent them from seeing your profile.',
        },
        (buttonIndex) => {
          if (buttonIndex === 1) {
            confirmBlock();
          } else if (buttonIndex === 2) {
            Alert.alert('Coming Soon', 'Reporting will be available in a future update.');
          }
        }
      );
    } else {
      Alert.alert(
        `Block @${profile.username}?`,
        'Blocking will remove them from your followers and prevent them from seeing your profile.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Block', style: 'destructive', onPress: confirmBlock },
        ]
      );
    }
  }, [profile, confirmBlock]);

  const handleCountryPress = useCallback(
    (countryCode: string, countryName: string) => {
      const tabNavigator = navigation.getParent();
      if (tabNavigator) {
        tabNavigator.navigate('Passport', {
          screen: 'CountryDetail',
          params: { countryId: countryCode, countryName, countryCode },
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
        onCountryPress={handleCountryPress}
        onEntryPress={handleEntryPress}
      />
    ),
    [handleCountryPress, handleEntryPress]
  );

  if (isLoading) {
    return (
      <View style={styles.container}>
        <View style={[styles.header, { paddingTop: insets.top }]}>
          <TouchableOpacity style={styles.backButton} onPress={handleBack}>
            <Ionicons name="arrow-back" size={24} color={colors.midnightNavy} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Profile</Text>
          <View style={styles.headerRight} />
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </View>
    );
  }

  if (error || !profile) {
    return (
      <View style={styles.container}>
        <View style={[styles.header, { paddingTop: insets.top }]}>
          <TouchableOpacity style={styles.backButton} onPress={handleBack}>
            <Ionicons name="arrow-back" size={24} color={colors.midnightNavy} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Profile</Text>
          <View style={styles.headerRight} />
        </View>
        <View style={styles.errorContainer}>
          <Ionicons name="person-outline" size={64} color={colors.textTertiary} />
          <Text style={styles.errorTitle}>User not found</Text>
          <Text style={styles.errorSubtitle}>
            This profile may not exist or you may be blocked
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <TouchableOpacity style={styles.backButton} onPress={handleBack}>
          <Ionicons name="arrow-back" size={24} color={colors.midnightNavy} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>@{profile.username}</Text>
        <TouchableOpacity style={styles.moreButton} onPress={handleBlock}>
          <Ionicons name="ellipsis-horizontal" size={24} color={colors.midnightNavy} />
        </TouchableOpacity>
      </View>

      <FlatList
        data={feedItems}
        renderItem={renderFeedItem}
        keyExtractor={(item, index) => `${item.activity_type}-${item.created_at}-${index}`}
        ListHeaderComponent={
          <View style={styles.profileCard}>
            <UserAvatar
              avatarUrl={profile.avatar_url}
              username={profile.username}
              size={96}
            />

            <Text style={styles.displayName}>{profile.display_name}</Text>
            <Text style={styles.username}>@{profile.username}</Text>

            <View style={styles.statsRow}>
              <View style={styles.statItem}>
                <Text style={styles.statNumber}>{profile.country_count}</Text>
                <Text style={styles.statLabel}>Countries</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <Text style={styles.statNumber}>{profile.follower_count}</Text>
                <Text style={styles.statLabel}>Followers</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <Text style={styles.statNumber}>{profile.following_count}</Text>
                <Text style={styles.statLabel}>Following</Text>
              </View>
            </View>

            <View style={styles.actionRow}>
              <FollowButton
                userId={profile.user_id}
                isFollowing={profile.is_following}
              />
            </View>

            {feedItems.length > 0 && (
              <Text style={styles.activityTitle}>Recent Activity</Text>
            )}
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Ionicons name="newspaper-outline" size={48} color={colors.textTertiary} />
            <Text style={styles.emptyText}>No activity yet</Text>
          </View>
        }
        ListFooterComponent={
          isFetchingNextPage ? (
            <View style={styles.footerLoader}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : null
        }
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.5}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.warmCream,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.lakeBlue,
    paddingBottom: 16,
    paddingHorizontal: 16,
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontFamily: fonts.playfair.bold,
    fontSize: 20,
    color: colors.midnightNavy,
    fontStyle: 'italic',
  },
  headerRight: {
    width: 40,
  },
  moreButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  errorTitle: {
    fontFamily: fonts.playfair.bold,
    fontSize: 20,
    color: colors.midnightNavy,
    marginTop: 16,
    marginBottom: 8,
  },
  errorSubtitle: {
    fontFamily: fonts.openSans.regular,
    fontSize: 16,
    color: colors.stormGray,
    textAlign: 'center',
  },
  contentContainer: {
    paddingBottom: 100,
  },
  profileCard: {
    alignItems: 'center',
    paddingVertical: 32,
    paddingHorizontal: 16,
    backgroundColor: colors.surface,
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 16,
  },
  displayName: {
    fontFamily: fonts.playfair.bold,
    fontSize: 24,
    color: colors.midnightNavy,
    marginTop: 16,
  },
  username: {
    fontFamily: fonts.openSans.regular,
    fontSize: 16,
    color: colors.stormGray,
    marginTop: 4,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 24,
    paddingHorizontal: 16,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statNumber: {
    fontFamily: fonts.playfair.bold,
    fontSize: 24,
    color: colors.midnightNavy,
  },
  statLabel: {
    fontFamily: fonts.openSans.regular,
    fontSize: 12,
    color: colors.stormGray,
    marginTop: 4,
  },
  statDivider: {
    width: 1,
    height: 32,
    backgroundColor: colors.border,
    marginHorizontal: 16,
  },
  actionRow: {
    flexDirection: 'row',
    marginTop: 24,
    gap: 12,
  },
  activityTitle: {
    fontFamily: fonts.playfair.bold,
    fontSize: 18,
    color: colors.midnightNavy,
    marginTop: 24,
    alignSelf: 'flex-start',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
    marginHorizontal: 16,
    marginTop: 16,
    backgroundColor: colors.surface,
    borderRadius: 16,
  },
  emptyText: {
    fontFamily: fonts.openSans.regular,
    fontSize: 16,
    color: colors.textTertiary,
    marginTop: 12,
  },
  footerLoader: {
    paddingVertical: 20,
    alignItems: 'center',
  },
});
