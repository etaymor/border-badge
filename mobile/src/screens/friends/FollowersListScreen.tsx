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

import { UserAvatar, UserSearchBar } from '@components/friends';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { useFollowers, type UserSummary } from '@hooks/useFollows';
import type { FriendsStackScreenProps } from '@navigation/types';

type Props = FriendsStackScreenProps<'FollowersList'>;

export function FollowersListScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { data: followers, isLoading } = useFollowers();

  const handleBack = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  const handleUserPress = useCallback(
    (userId: string, username: string) => {
      navigation.navigate('UserProfile', { userId, username });
    },
    [navigation]
  );

  const renderItem = useCallback(
    ({ item }: { item: UserSummary }) => (
      <TouchableOpacity
        style={styles.userRow}
        onPress={() => handleUserPress(item.user_id, item.username)}
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
    [handleUserPress]
  );

  const ListHeader = useMemo(
    () => (
      <>
        {/* User search for finding new travelers */}
        <View style={styles.searchRow}>
          <UserSearchBar onUserSelect={handleUserPress} placeholder="Find fellow travelers..." />
        </View>

        {followers && followers.length > 0 && (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Followers</Text>
            <View style={styles.sectionLine} />
          </View>
        )}
      </>
    ),
    [handleUserPress, followers]
  );

  const ListEmpty = (
    <View style={styles.emptyState}>
      <View style={styles.emptyIconContainer}>
        <Ionicons name="people-outline" size={48} color={colors.dustyCoral} />
      </View>
      <Text style={styles.emptyTitle}>No followers yet</Text>
      <Text style={styles.emptySubtitle}>
        Share your travel stories and{'\n'}attract fellow adventurers
      </Text>
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <TouchableOpacity style={styles.backButton} onPress={handleBack}>
          <Ionicons name="arrow-back" size={24} color={colors.midnightNavy} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Followers</Text>
        <View style={styles.headerRight} />
      </View>

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.adobeBrick} />
        </View>
      ) : (
        <FlatList
          data={followers ?? []}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={ListHeader}
          ListEmptyComponent={ListEmpty}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchRow: {
    paddingTop: 8,
    paddingBottom: 16,
    paddingHorizontal: 16,
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
});
