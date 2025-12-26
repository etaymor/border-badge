import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { UserAvatar } from '@components/friends';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { useBlockedUsers, useUnblockUser, type BlockedUser } from '@hooks/useBlocks';
import type { FriendsStackScreenProps } from '@navigation/types';

type Props = FriendsStackScreenProps<'BlockedUsers'>;

function BlockedUserRow({ user, onRefetch }: { user: BlockedUser; onRefetch: () => void }) {
  const unblockMutation = useUnblockUser(user.user_id);

  const handleUnblock = useCallback(() => {
    Alert.alert(
      `Unblock @${user.username}?`,
      'They will be able to see your profile and follow you again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unblock',
          onPress: async () => {
            try {
              await unblockMutation.mutateAsync();
              onRefetch();
            } catch {
              // Error handled by mutation
            }
          },
        },
      ]
    );
  }, [user.username, unblockMutation, onRefetch]);

  return (
    <View style={styles.userRow}>
      <UserAvatar avatarUrl={user.avatar_url} username={user.username} size={48} />
      <View style={styles.userInfo}>
        <Text style={styles.username}>@{user.username}</Text>
      </View>
      <TouchableOpacity
        style={styles.unblockButton}
        onPress={handleUnblock}
        disabled={unblockMutation.isPending}
      >
        <Text style={styles.unblockText}>
          {unblockMutation.isPending ? 'Unblocking...' : 'Unblock'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

export function BlockedUsersScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { data: blockedUsers, isLoading, refetch } = useBlockedUsers();

  const handleBack = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  const handleRefetch = useCallback(() => {
    refetch();
    queryClient.invalidateQueries({ queryKey: ['blocks'] });
  }, [refetch, queryClient]);

  const renderItem = useCallback(
    ({ item }: { item: BlockedUser }) => <BlockedUserRow user={item} onRefetch={handleRefetch} />,
    [handleRefetch]
  );

  const keyExtractor = useCallback((item: BlockedUser) => item.id, []);

  const ListEmpty = useCallback(
    () => (
      <View style={styles.emptyState}>
        <Ionicons name="shield-checkmark-outline" size={64} color={colors.textTertiary} />
        <Text style={styles.emptyTitle}>No blocked users</Text>
        <Text style={styles.emptySubtitle}>
          Users you block will appear here. They won&apos;t be able to see your profile or follow
          you.
        </Text>
      </View>
    ),
    []
  );

  if (isLoading) {
    return (
      <View style={styles.container}>
        <View style={[styles.header, { paddingTop: insets.top }]}>
          <TouchableOpacity style={styles.backButton} onPress={handleBack}>
            <Ionicons name="arrow-back" size={24} color={colors.midnightNavy} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Blocked Users</Text>
          <View style={styles.headerRight} />
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
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
        <Text style={styles.headerTitle}>Blocked Users</Text>
        <View style={styles.headerRight} />
      </View>

      <FlatList
        data={blockedUsers ?? []}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
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
  username: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 16,
    color: colors.text,
  },
  unblockButton: {
    backgroundColor: colors.background,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
  },
  unblockText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 14,
    color: colors.text,
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
