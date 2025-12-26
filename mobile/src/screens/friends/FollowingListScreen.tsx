import { Ionicons } from '@expo/vector-icons';
import { useCallback, useMemo } from 'react';
import {
  ActivityIndicator,
  Alert,
  SectionList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { UserAvatar } from '@components/friends';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { useFollowing, type UserSummary } from '@hooks/useFollows';
import { usePendingInvites, useCancelInvite, type PendingInvite } from '@hooks/useInvites';
import type { FriendsStackScreenProps } from '@navigation/types';

type Props = FriendsStackScreenProps<'FollowingList'>;

type SectionItem = UserSummary | PendingInvite;
type Section = { title: string; data: SectionItem[]; type: 'pending' | 'following' };

export function FollowingListScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { data: following, isLoading: isLoadingFollowing } = useFollowing();
  const { data: pendingInvites, isLoading: isLoadingInvites } = usePendingInvites();
  const cancelInviteMutation = useCancelInvite();

  const isLoading = isLoadingFollowing || isLoadingInvites;

  // Filter to only follow-type invites
  const followInvites = useMemo(
    () => pendingInvites?.filter((inv) => inv.invite_type === 'follow') ?? [],
    [pendingInvites]
  );

  const sections: Section[] = useMemo(() => {
    const result: Section[] = [];

    if (followInvites.length > 0) {
      result.push({
        title: 'Pending Invites',
        data: followInvites,
        type: 'pending',
      });
    }

    if (following && following.length > 0) {
      result.push({
        title: 'Following',
        data: following,
        type: 'following',
      });
    }

    return result;
  }, [followInvites, following]);

  const handleBack = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  const handleUserPress = useCallback(
    (userId: string, username: string) => {
      navigation.navigate('UserProfile', { userId, username });
    },
    [navigation]
  );

  const handleCancelInvite = useCallback(
    (invite: PendingInvite) => {
      Alert.alert(
        'Cancel Invite',
        `Cancel the pending invite to ${invite.email}?`,
        [
          { text: 'Keep', style: 'cancel' },
          {
            text: 'Cancel Invite',
            style: 'destructive',
            onPress: () => cancelInviteMutation.mutate(invite.id),
          },
        ]
      );
    },
    [cancelInviteMutation]
  );

  const renderPendingItem = useCallback(
    (invite: PendingInvite) => (
      <View style={styles.pendingRow} key={invite.id}>
        <View style={styles.pendingIcon}>
          <Ionicons name="mail-outline" size={24} color={colors.primary} />
        </View>
        <View style={styles.userInfo}>
          <Text style={styles.pendingEmail}>{invite.email}</Text>
          <Text style={styles.pendingStatus}>Invite sent</Text>
        </View>
        <TouchableOpacity
          style={styles.cancelButton}
          onPress={() => handleCancelInvite(invite)}
          disabled={cancelInviteMutation.isPending}
        >
          <Ionicons name="close-circle-outline" size={24} color={colors.error} />
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
        key={item.id}
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
    [handleUserPress]
  );

  const renderItem = useCallback(
    ({ item, section }: { item: SectionItem; section: Section }) => {
      if (section.type === 'pending') {
        return renderPendingItem(item as PendingInvite);
      }
      return renderFollowingItem(item as UserSummary);
    },
    [renderPendingItem, renderFollowingItem]
  );

  const renderSectionHeader = useCallback(
    ({ section }: { section: Section }) => (
      <Text style={styles.sectionHeader}>{section.title}</Text>
    ),
    []
  );

  const ListEmpty = (
    <View style={styles.emptyState}>
      <Ionicons name="people-outline" size={64} color={colors.textTertiary} />
      <Text style={styles.emptyTitle}>Not following anyone yet</Text>
      <Text style={styles.emptySubtitle}>
        Search for friends by username to start following them
      </Text>
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <TouchableOpacity style={styles.backButton} onPress={handleBack}>
          <Ionicons name="arrow-back" size={24} color={colors.midnightNavy} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Following</Text>
        <View style={styles.headerRight} />
      </View>

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : sections.length > 0 ? (
        <SectionList
          sections={sections}
          renderItem={renderItem}
          renderSectionHeader={renderSectionHeader}
          keyExtractor={(item) => ('id' in item ? item.id : item.email)}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          stickySectionHeadersEnabled={false}
        />
      ) : (
        ListEmpty
      )}
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  listContent: {
    paddingBottom: 100,
    flexGrow: 1,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: colors.surface,
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
    color: colors.text,
  },
  username: {
    fontFamily: fonts.openSans.regular,
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 2,
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
  sectionHeader: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 14,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginHorizontal: 16,
    marginTop: 20,
    marginBottom: 4,
  },
  pendingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: colors.surface,
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
  },
  pendingIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.lakeBlue,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pendingEmail: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 16,
    color: colors.text,
  },
  pendingStatus: {
    fontFamily: fonts.openSans.regular,
    fontSize: 14,
    color: colors.stormGray,
    marginTop: 2,
  },
  cancelButton: {
    padding: 8,
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
});
