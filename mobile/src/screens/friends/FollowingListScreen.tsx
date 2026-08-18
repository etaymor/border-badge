import { Ionicons } from '@expo/vector-icons';
import { useCallback, useMemo } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { UserAvatar, UserListSkeleton, UserSearchBar } from '@components/friends';
import { ErrorState } from '@components/ui';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { FlashList } from '@shopify/flash-list';
import { useFollowing, getFollowListUsers, type UserSummary } from '@hooks/useFollows';
import { usePendingInvites, useCancelInvite, type PendingInvite } from '@hooks/useInvites';
import { useLoadMoreOnEnd } from '@hooks/useLoadMoreOnEnd';
import type { FriendsStackScreenProps } from '@navigation/types';

type Props = FriendsStackScreenProps<'FollowingList'>;

/** Flat row model for the FlashList (section headers are rows too). */
type Row =
  | { kind: 'header'; key: string; title: string }
  | { kind: 'pending'; invite: PendingInvite }
  | { kind: 'user'; user: UserSummary };

function rowKey(row: Row): string {
  switch (row.kind) {
    case 'header':
      return row.key;
    case 'pending':
      return `pending-${row.invite.id}`;
    case 'user':
      return row.user.id;
  }
}

export function FollowingListScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const {
    data: followingData,
    isLoading: isLoadingFollowing,
    isError,
    refetch,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useFollowing();
  const { data: pendingInvites, isLoading: isLoadingInvites } = usePendingInvites();
  const cancelInviteMutation = useCancelInvite();

  const isLoading = isLoadingFollowing || isLoadingInvites;
  const following = useMemo(() => getFollowListUsers(followingData), [followingData]);

  const followInvites = useMemo(
    () => pendingInvites?.filter((inv) => inv.invite_type === 'follow') ?? [],
    [pendingInvites]
  );

  const rows: Row[] = useMemo(() => {
    const result: Row[] = [];

    if (followInvites.length > 0) {
      result.push({ kind: 'header', key: 'header-pending', title: 'Pending Invites' });
      for (const invite of followInvites) {
        result.push({ kind: 'pending', invite });
      }
    }

    if (following.length > 0) {
      result.push({ kind: 'header', key: 'header-following', title: 'Following' });
      for (const user of following) {
        result.push({ kind: 'user', user });
      }
    }

    return result;
  }, [followInvites, following]);

  const handleBack = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  const handleLoadMore = useLoadMoreOnEnd(hasNextPage, isFetchingNextPage, fetchNextPage);

  const handleUserPress = useCallback(
    (userId: string, username: string) => {
      navigation.navigate('UserProfile', { userId, username });
    },
    [navigation]
  );

  const handleCancelInvite = useCallback(
    (invite: PendingInvite) => {
      Alert.alert('Cancel Invite', `Cancel the pending invite to ${invite.email}?`, [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Cancel Invite',
          style: 'destructive',
          onPress: () => cancelInviteMutation.mutate(invite.id),
        },
      ]);
    },
    [cancelInviteMutation]
  );

  const renderPendingItem = useCallback(
    (invite: PendingInvite) => (
      <View style={styles.pendingRow} key={invite.id}>
        <View style={styles.pendingIcon}>
          <Ionicons name="mail-outline" size={22} color={colors.sunsetGold} />
        </View>
        <View style={styles.userInfo}>
          <Text style={styles.pendingEmail}>{invite.email}</Text>
          <View style={styles.pendingBadge}>
            <Text style={styles.pendingStatus}>Invite sent</Text>
          </View>
        </View>
        <TouchableOpacity
          style={styles.cancelButton}
          onPress={() => handleCancelInvite(invite)}
          disabled={cancelInviteMutation.isPending}
        >
          <Ionicons name="close-circle" size={24} color={colors.dustyCoral} />
        </TouchableOpacity>
      </View>
    ),
    [handleCancelInvite, cancelInviteMutation.isPending]
  );

  const renderFollowingItem = useCallback(
    (item: UserSummary) => (
      <TouchableOpacity
        style={styles.userRow}
        onPress={() => handleUserPress(item.user_id, item.username)}
        activeOpacity={0.7}
        key={item.id}
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
    [handleUserPress]
  );

  const renderItem = useCallback(
    ({ item }: { item: Row }) => {
      switch (item.kind) {
        case 'header':
          return (
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{item.title}</Text>
              <View style={styles.sectionLine} />
            </View>
          );
        case 'pending':
          return renderPendingItem(item.invite);
        case 'user':
          return renderFollowingItem(item.user);
      }
    },
    [renderPendingItem, renderFollowingItem]
  );

  const handleUserSelect = useCallback(
    (userId: string, username: string) => {
      navigation.navigate('UserProfile', { userId, username });
    },
    [navigation]
  );

  const ListEmpty = (
    <View style={styles.emptyState}>
      <View style={styles.emptyIconContainer}>
        <Ionicons name="trail-sign-outline" size={48} color={colors.dustyCoral} />
      </View>
      <Text style={styles.emptyTitle}>Not following anyone</Text>
      <Text style={styles.emptySubtitle}>
        Find fellow travelers to follow{'\n'}and share the journey together
      </Text>
    </View>
  );

  const renderBody = () => {
    if (isLoading) {
      return <UserListSkeleton />;
    }
    if (isError) {
      return (
        <ErrorState
          title="Couldn't load following"
          message="Something went wrong loading this list."
          onRetry={() => refetch()}
        />
      );
    }
    if (rows.length === 0) {
      return <View style={styles.emptyWrapper}>{ListEmpty}</View>;
    }
    return (
      <FlashList
        data={rows}
        renderItem={renderItem}
        keyExtractor={rowKey}
        getItemType={(item) => item.kind}
        ListFooterComponent={
          isFetchingNextPage ? (
            <View style={styles.footerLoader}>
              <ActivityIndicator size="small" color={colors.adobeBrick} />
            </View>
          ) : null
        }
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.5}
        style={styles.sectionList}
      />
    );
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <TouchableOpacity style={styles.backButton} onPress={handleBack}>
          <Ionicons name="arrow-back" size={24} color={colors.midnightNavy} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Following</Text>
        <View style={styles.headerRight} />
      </View>

      {/* Search bar outside list so dropdown can overlay content */}
      <View style={styles.searchContainer}>
        <UserSearchBar onUserSelect={handleUserSelect} placeholder="Find fellow travelers..." />
      </View>

      {renderBody()}
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
    backgroundColor: colors.warmCream,
    paddingBottom: 12,
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
  footerLoader: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  searchContainer: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
    zIndex: 10,
    elevation: 10,
  },
  sectionList: {
    zIndex: 1,
  },
  emptyWrapper: {
    flex: 1,
    zIndex: 1,
  },
  listContent: {
    paddingBottom: 100,
    flexGrow: 1,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
    gap: 12,
  },
  sectionTitle: {
    fontFamily: fonts.dawning.regular,
    fontSize: 24,
    color: colors.adobeBrick,
  },
  sectionLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.adobeBrick,
    opacity: 0.3,
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
  pendingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: colors.cloudWhite,
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: colors.sunsetGold,
    borderStyle: 'dashed',
  },
  pendingIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.paperBeige,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pendingEmail: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 15,
    color: colors.midnightNavy,
  },
  pendingBadge: {
    backgroundColor: colors.sunsetGold,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    marginTop: 4,
    alignSelf: 'flex-start',
  },
  pendingStatus: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 11,
    color: colors.midnightNavy,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  cancelButton: {
    padding: 8,
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
});
