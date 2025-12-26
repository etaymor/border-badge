import { Ionicons } from '@expo/vector-icons';
import { useCallback } from 'react';
import {
  ActivityIndicator,
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

  const ListEmpty = (
    <View style={styles.emptyState}>
      <Ionicons name="people-outline" size={64} color={colors.textTertiary} />
      <Text style={styles.emptyTitle}>No followers yet</Text>
      <Text style={styles.emptySubtitle}>
        Share your profile to get more followers
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
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={followers ?? []}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
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
