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
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FriendsRankingStats, UserAvatar, UserSearchBar } from '@components/friends';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { useFollowing, useFollowStats } from '@hooks/useFollows';
import type { FriendsStackScreenProps } from '@navigation/types';

type Props = FriendsStackScreenProps<'FriendsHome'>;

export function FriendsScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();

  const { data: stats, isLoading: statsLoading } = useFollowStats();
  const { data: following, isLoading: followingLoading } = useFollowing();

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
      >
        <UserAvatar
          avatarUrl={item.avatar_url}
          username={item.username}
          size={48}
        />
        <View style={styles.userInfo}>
          <Text style={styles.displayName}>{item.display_name}</Text>
          <Text style={styles.username}>@{item.username}</Text>
        </View>
        <View style={styles.countryBadge}>
          <Text style={styles.countryCount}>{item.country_count}</Text>
          <Ionicons name="globe-outline" size={14} color={colors.textSecondary} />
        </View>
      </TouchableOpacity>
    ),
    [handleUserSelect]
  );

  const ListHeader = useMemo(
    () => (
      <>
        <View style={[styles.headerContainer, { paddingTop: insets.top + 16 }]}>
          <Text style={styles.headerTitle}>Friends</Text>
        </View>

        <FriendsRankingStats />

        <View style={styles.searchContainer}>
          <UserSearchBar
            onUserSelect={handleUserSelect}
            placeholder="Find friends by username..."
          />
        </View>

        <View style={styles.statsRow}>
          <TouchableOpacity style={styles.statItem} onPress={handleViewFollowers}>
            <Text style={styles.statNumber}>{stats?.follower_count ?? 0}</Text>
            <Text style={styles.statLabel}>Followers</Text>
          </TouchableOpacity>
          <View style={styles.statDivider} />
          <TouchableOpacity style={styles.statItem} onPress={handleViewFollowing}>
            <Text style={styles.statNumber}>{stats?.following_count ?? 0}</Text>
            <Text style={styles.statLabel}>Following</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionTitle}>Following</Text>
      </>
    ),
    [insets.top, stats, handleUserSelect, handleViewFollowers, handleViewFollowing]
  );

  const ListEmpty = useMemo(
    () => (
      <View style={styles.emptyState}>
        <Ionicons name="people-outline" size={64} color={colors.textTertiary} />
        <Text style={styles.emptyTitle}>Not following anyone yet</Text>
        <Text style={styles.emptySubtitle}>
          Search for friends by username to start following them
        </Text>
      </View>
    ),
    []
  );

  if (isLoading) {
    return (
      <View style={styles.container}>
        <View style={[styles.headerContainer, { paddingTop: insets.top + 16 }]}>
          <Text style={styles.headerTitle}>Friends</Text>
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
        data={following ?? []}
        renderItem={renderUserItem}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={ListHeader}
        ListEmptyComponent={ListEmpty}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
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
  searchContainer: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 16,
    marginHorizontal: 16,
    backgroundColor: colors.backgroundCard,
    borderRadius: 12,
    marginTop: 8,
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
    fontSize: 14,
    color: colors.stormGray,
    marginTop: 4,
  },
  statDivider: {
    width: 1,
    height: 40,
    backgroundColor: colors.border,
  },
  sectionTitle: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 16,
    color: colors.textPrimary,
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 4,
  },
  listContent: {
    paddingBottom: 100,
    flexGrow: 1,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: colors.backgroundCard,
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 12,
  },
  userInfo: {
    flex: 1,
    marginLeft: 12,
  },
  displayName: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 16,
    color: colors.textPrimary,
  },
  username: {
    fontFamily: fonts.openSans.regular,
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 2,
  },
  countryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.background,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
  },
  countryCount: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 14,
    color: colors.textSecondary,
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
});
