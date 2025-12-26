import React from 'react';
import { View, Text, FlatList, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { useFollowing, useFollowers } from '@hooks/useFollows';
import { UserSearchResultCard } from '@components/friends/UserSearchResultCard';
import type { RootStackParamList } from '@navigation/types';

type FollowersListScreenRouteProp = RouteProp<RootStackParamList, 'FollowersList'>;
type FollowersListScreenNavigationProp = NativeStackNavigationProp<RootStackParamList>;

export default function FollowersListScreen() {
  const route = useRoute<FollowersListScreenRouteProp>();
  const navigation = useNavigation<FollowersListScreenNavigationProp>();
  const { mode } = route.params;

  const isFollowingMode = mode === 'following';

  // For now, we only support current user's lists
  // userId parameter is reserved for future feature to view other users' followers
  const followingQuery = useFollowing();
  const followersQuery = useFollowers();

  const query = isFollowingMode ? followingQuery : followersQuery;
  const { data, isLoading, error, refetch } = query;

  const handleUserPress = (selectedUserId: string) => {
    navigation.navigate('UserProfile', { userId: selectedUserId });
  };

  const handleRefresh = () => {
    refetch();
  };

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.sunsetGold} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.errorContainer}>
        <Ionicons name="alert-circle-outline" size={64} color={colors.textSecondary} />
        <Text style={styles.errorTitle}>
          Error Loading {isFollowingMode ? 'Following' : 'Followers'}
        </Text>
        <Text style={styles.errorText}>Something went wrong. Please try again later.</Text>
      </View>
    );
  }

  const users = data?.users || [];
  const isEmpty = users.length === 0;

  return (
    <View style={styles.container}>
      {isEmpty ? (
        <View style={styles.emptyState}>
          <Ionicons
            name={isFollowingMode ? 'person-add-outline' : 'people-outline'}
            size={64}
            color={colors.textSecondary}
          />
          <Text style={styles.emptyStateTitle}>
            {isFollowingMode ? 'Not Following Anyone Yet' : 'No Followers Yet'}
          </Text>
          <Text style={styles.emptyStateText}>
            {isFollowingMode
              ? 'Find friends to follow and see their travel journeys'
              : 'Share your profile to get followers and build your travel community'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={users}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <UserSearchResultCard user={item} onPress={() => handleUserPress(item.id)} />
          )}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          onRefresh={handleRefresh}
          refreshing={isLoading}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    backgroundColor: colors.background,
  },
  errorTitle: {
    fontSize: 20,
    fontFamily: fonts.bold,
    color: colors.text,
    marginTop: 16,
    marginBottom: 8,
  },
  errorText: {
    fontSize: 16,
    fontFamily: fonts.regular,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 24,
  },
  listContent: {
    padding: 16,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  emptyStateTitle: {
    fontSize: 20,
    fontFamily: fonts.bold,
    color: colors.text,
    marginTop: 16,
    marginBottom: 8,
    textAlign: 'center',
  },
  emptyStateText: {
    fontSize: 16,
    fontFamily: fonts.regular,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 24,
  },
});
