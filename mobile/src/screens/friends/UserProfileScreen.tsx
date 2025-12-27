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

  const { data: feedData, isFetchingNextPage, hasNextPage, fetchNextPage } = useUserFeed(userId);

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
          message:
            'Blocking will remove them from your followers and prevent them from seeing your profile.',
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
      <FeedCard item={item} onCountryPress={handleCountryPress} onEntryPress={handleEntryPress} />
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
          <Text style={styles.headerTitle}>Traveler</Text>
          <View style={styles.headerRight} />
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.adobeBrick} />
          <Text style={styles.loadingText}>Finding traveler...</Text>
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
          <Text style={styles.headerTitle}>Traveler</Text>
          <View style={styles.headerRight} />
        </View>
        <View style={styles.errorContainer}>
          <View style={styles.errorIconContainer}>
            <Ionicons name="compass-outline" size={48} color={colors.dustyCoral} />
          </View>
          <Text style={styles.errorTitle}>Trail gone cold</Text>
          <Text style={styles.errorSubtitle}>
            This traveler may have moved on,{'\n'}or perhaps they prefer solitude
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
            <View style={styles.avatarRing}>
              <UserAvatar avatarUrl={profile.avatar_url} username={profile.username} size={100} />
            </View>

            <Text style={styles.displayName}>{profile.display_name}</Text>
            <Text style={styles.username}>@{profile.username}</Text>

            <View style={styles.statsRow}>
              <View style={styles.statItem}>
                <View style={styles.statIconWrap}>
                  <Ionicons name="compass" size={16} color={colors.adobeBrick} />
                </View>
                <Text style={styles.statNumber}>{profile.country_count}</Text>
                <Text style={styles.statLabel}>Countries</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <View style={styles.statIconWrap}>
                  <Ionicons name="people" size={16} color={colors.mossGreen} />
                </View>
                <Text style={styles.statNumber}>{profile.follower_count}</Text>
                <Text style={styles.statLabel}>Followers</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <View style={styles.statIconWrap}>
                  <Ionicons name="footsteps" size={16} color={colors.sunsetGold} />
                </View>
                <Text style={styles.statNumber}>{profile.following_count}</Text>
                <Text style={styles.statLabel}>Following</Text>
              </View>
            </View>

            <View style={styles.actionRow}>
              <FollowButton userId={profile.user_id} isFollowing={profile.is_following} />
            </View>

            {feedItems.length > 0 && (
              <View style={styles.activityHeader}>
                <Text style={styles.activityTitle}>Their Journey</Text>
                <View style={styles.activityLine} />
              </View>
            )}
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <View style={styles.emptyIconContainer}>
              <Ionicons name="journal-outline" size={40} color={colors.dustyCoral} />
            </View>
            <Text style={styles.emptyTitle}>No stories yet</Text>
            <Text style={styles.emptySubtitle}>
              This traveler hasn&apos;t shared{'\n'}any adventures yet
            </Text>
          </View>
        }
        ListFooterComponent={
          isFetchingNextPage ? (
            <View style={styles.footerLoader}>
              <ActivityIndicator size="small" color={colors.adobeBrick} />
              <Text style={styles.footerText}>Loading more...</Text>
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
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.3)',
    borderRadius: 20,
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
    backgroundColor: 'rgba(255,255,255,0.3)',
    borderRadius: 20,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  loadingText: {
    fontFamily: fonts.openSans.regular,
    fontSize: 14,
    color: colors.stormGray,
    fontStyle: 'italic',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  errorIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.paperBeige,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  errorTitle: {
    fontFamily: fonts.playfair.bold,
    fontSize: 22,
    color: colors.midnightNavy,
    marginBottom: 8,
  },
  errorSubtitle: {
    fontFamily: fonts.openSans.regular,
    fontSize: 15,
    color: colors.stormGray,
    textAlign: 'center',
    lineHeight: 22,
  },
  contentContainer: {
    paddingBottom: 100,
  },
  profileCard: {
    alignItems: 'center',
    paddingVertical: 32,
    paddingHorizontal: 20,
    backgroundColor: colors.cloudWhite,
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 20,
    shadowColor: colors.midnightNavy,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  avatarRing: {
    padding: 4,
    borderRadius: 56,
    borderWidth: 2,
    borderColor: colors.sunsetGold,
    borderStyle: 'dashed',
  },
  displayName: {
    fontFamily: fonts.playfair.bold,
    fontSize: 26,
    color: colors.midnightNavy,
    marginTop: 16,
  },
  username: {
    fontFamily: fonts.openSans.regular,
    fontSize: 15,
    color: colors.stormGray,
    marginTop: 4,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 28,
    paddingHorizontal: 8,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.paperBeige,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  statNumber: {
    fontFamily: fonts.playfair.bold,
    fontSize: 26,
    color: colors.midnightNavy,
  },
  statLabel: {
    fontFamily: fonts.openSans.regular,
    fontSize: 11,
    color: colors.stormGray,
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  statDivider: {
    width: 1,
    height: 50,
    backgroundColor: colors.paperBeige,
    marginHorizontal: 12,
  },
  actionRow: {
    flexDirection: 'row',
    marginTop: 28,
    gap: 12,
  },
  activityHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    marginTop: 28,
    gap: 12,
  },
  activityTitle: {
    fontFamily: fonts.dawning.regular,
    fontSize: 26,
    color: colors.adobeBrick,
  },
  activityLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.adobeBrick,
    opacity: 0.3,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
    marginHorizontal: 16,
    marginTop: 16,
    backgroundColor: colors.cloudWhite,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.paperBeige,
    borderStyle: 'dashed',
  },
  emptyIconContainer: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.paperBeige,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  emptyTitle: {
    fontFamily: fonts.playfair.bold,
    fontSize: 20,
    color: colors.midnightNavy,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontFamily: fonts.openSans.regular,
    fontSize: 14,
    color: colors.stormGray,
    textAlign: 'center',
    lineHeight: 20,
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
