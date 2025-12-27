import { Ionicons } from '@expo/vector-icons';
import { useCallback, useMemo } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FriendsStatsGrid, UserAvatar, UserSearchBar } from '@components/friends';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { useFollowing, useFollowStats } from '@hooks/useFollows';
import { useFriendsRanking } from '@hooks/useFriendsRanking';
import type { FriendsStackScreenProps } from '@navigation/types';

type Props = FriendsStackScreenProps<'FriendsHome'>;

export function FriendsScreen({ navigation }: Props) {
  const { data: stats, isLoading: statsLoading } = useFollowStats();
  const { data: following, isLoading: followingLoading } = useFollowing();
  const { data: ranking, isLoading: rankingLoading } = useFriendsRanking();

  const isLoading = statsLoading || followingLoading;

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

  const renderUserItem = useCallback(
    ({ item }: { item: (typeof following)[0] }) => (
      <TouchableOpacity
        style={styles.userRow}
        onPress={() => handleUserSelect(item.user_id, item.username)}
        activeOpacity={0.7}
      >
        <UserAvatar avatarUrl={item.avatar_url} username={item.username} size={52} />
        <View style={styles.userInfo}>
          <Text style={styles.displayName}>{item.display_name}</Text>
          <Text style={styles.username}>@{item.username}</Text>
        </View>
        <View style={styles.countryBadge}>
          <Ionicons name="compass" size={14} color={colors.adobeBrick} />
          <Text style={styles.countryCount}>{item.country_count}</Text>
        </View>
      </TouchableOpacity>
    ),
    [handleUserSelect]
  );

  const ListHeader = useMemo(
    () => (
      <>
        {/* Header Title */}
        <View style={styles.headerContainer}>
          <Text style={styles.headerTitle}>My Friends</Text>
        </View>

        {/* Stats Grid */}
        <FriendsStatsGrid
          followerCount={stats?.follower_count ?? 0}
          followingCount={stats?.following_count ?? 0}
          rank={ranking?.rank ?? null}
          isLoading={statsLoading || rankingLoading}
          onFollowersPress={handleViewFollowers}
          onFollowingPress={handleViewFollowing}
        />

        {/* User search for finding new travelers */}
        <View style={styles.userSearchContainer}>
          <UserSearchBar onUserSelect={handleUserSelect} placeholder="Find fellow travelers..." />
        </View>
      </>
    ),
    [
      stats,
      ranking,
      statsLoading,
      rankingLoading,
      handleUserSelect,
      handleViewFollowers,
      handleViewFollowing,
    ]
  );

  const ListEmpty = useMemo(
    () => (
      <View style={styles.emptyState}>
        <View style={styles.emptyIconContainer}>
          <Ionicons name="trail-sign-outline" size={48} color={colors.dustyCoral} />
        </View>
        <Text style={styles.emptyTitle}>Not following anyone yet</Text>
        <Text style={styles.emptySubtitle}>
          Every great journey is better with friends.{'\n'}Find fellow travelers to follow their
          adventures.
        </Text>
        <View style={styles.emptyHint}>
          <Ionicons name="search" size={14} color={colors.stormGray} />
          <Text style={styles.emptyHintText}>Use the search above to find travelers</Text>
        </View>
      </View>
    ),
    []
  );

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <View style={styles.headerContainer}>
          <Text style={styles.headerTitle}>My Friends</Text>
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.adobeBrick} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <FlatList
        data={following ?? []}
        renderItem={renderUserItem}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={ListHeader}
        ListEmptyComponent={ListEmpty}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
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
    alignItems: 'center',
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
  userSearchContainer: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  listContent: {
    paddingBottom: 100,
    flexGrow: 1,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: colors.cloudWhite,
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.paperBeige,
    shadowColor: colors.midnightNavy,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 2,
  },
  userInfo: {
    flex: 1,
    marginLeft: 14,
  },
  displayName: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 16,
    color: colors.midnightNavy,
  },
  username: {
    fontFamily: fonts.openSans.regular,
    fontSize: 14,
    color: colors.stormGray,
    marginTop: 2,
  },
  countryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.paperBeige,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
  },
  countryCount: {
    fontFamily: fonts.openSans.bold,
    fontSize: 14,
    color: colors.adobeBrick,
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
});
