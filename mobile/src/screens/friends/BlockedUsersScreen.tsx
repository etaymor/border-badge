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
        style={[styles.unblockButton, unblockMutation.isPending && styles.unblockButtonDisabled]}
        onPress={handleUnblock}
        disabled={unblockMutation.isPending}
      >
        {unblockMutation.isPending ? (
          <ActivityIndicator size="small" color={colors.mossGreen} />
        ) : (
          <Text style={styles.unblockText}>Unblock</Text>
        )}
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

  const ListHeader = (
    <View style={styles.listHeaderContainer}>
      <Text style={styles.sectionTitle}>Blocked Travelers</Text>
      <View style={styles.sectionLine} />
    </View>
  );

  const ListEmpty = useCallback(
    () => (
      <View style={styles.emptyState}>
        <View style={styles.emptyIconContainer}>
          <Ionicons name="shield-checkmark" size={48} color={colors.mossGreen} />
        </View>
        <Text style={styles.emptyTitle}>All clear</Text>
        <Text style={styles.emptySubtitle}>
          You haven&apos;t blocked anyone.{'\n'}Your journey remains open to all.
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
          <View style={styles.headerCenter}>
            <Ionicons
              name="shield"
              size={18}
              color={colors.midnightNavy}
              style={styles.headerIcon}
            />
            <Text style={styles.headerTitle}>Blocked</Text>
          </View>
          <View style={styles.headerRight} />
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.adobeBrick} />
          <Text style={styles.loadingText}>Checking blocked list...</Text>
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
        <View style={styles.headerCenter}>
          <Ionicons name="shield" size={18} color={colors.midnightNavy} style={styles.headerIcon} />
          <Text style={styles.headerTitle}>Blocked</Text>
        </View>
        <View style={styles.headerRight} />
      </View>

      <FlatList
        data={blockedUsers ?? []}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
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
  headerCenter: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerIcon: {
    marginRight: 8,
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
    gap: 16,
  },
  loadingText: {
    fontFamily: fonts.openSans.regular,
    fontSize: 14,
    color: colors.stormGray,
    fontStyle: 'italic',
  },
  listContent: {
    paddingBottom: 100,
    flexGrow: 1,
  },
  listHeaderContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 4,
    gap: 12,
  },
  sectionTitle: {
    fontFamily: fonts.dawning.regular,
    fontSize: 26,
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
    borderColor: colors.dustyCoral,
    borderStyle: 'dashed',
  },
  userInfo: {
    flex: 1,
    marginLeft: 14,
  },
  username: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 16,
    color: colors.midnightNavy,
  },
  unblockButton: {
    backgroundColor: colors.mossGreen,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    minWidth: 90,
    alignItems: 'center',
  },
  unblockButtonDisabled: {
    opacity: 0.7,
  },
  unblockText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 14,
    color: colors.cloudWhite,
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
});
