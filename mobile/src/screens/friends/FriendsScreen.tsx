import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { useUserSearch } from '@hooks/useUserSearch';
import { useFollowStats } from '@hooks/useFollows';
import { UserSearchResultCard } from '@components/friends/UserSearchResultCard';
import { FeedList } from '@components/friends/FeedList';
import type { RootStackParamList } from '@navigation/types';

type FriendsScreenNavigationProp = NativeStackNavigationProp<RootStackParamList>;
type TabMode = 'feed' | 'search';

export default function FriendsScreen() {
  const navigation = useNavigation<FriendsScreenNavigationProp>();
  const [tabMode, setTabMode] = useState<TabMode>('feed');
  const [searchQuery, setSearchQuery] = useState('');

  const { data: searchResults = [], isLoading: isSearching } = useUserSearch(searchQuery);
  const { data: stats } = useFollowStats();

  const handleUserPress = (userId: string) => {
    navigation.navigate('UserProfile', { userId });
  };

  const handleFollowingPress = () => {
    navigation.navigate('FollowersList', { mode: 'following' });
  };

  const handleFollowersPress = () => {
    navigation.navigate('FollowersList', { mode: 'followers' });
  };

  return (
    <View style={styles.container}>
      {/* Header Stats */}
      <View style={styles.statsContainer}>
        <Pressable style={styles.statBox} onPress={handleFollowingPress}>
          <Text style={styles.statNumber}>{stats?.following_count || 0}</Text>
          <Text style={styles.statLabel}>Following</Text>
        </Pressable>

        <View style={styles.statDivider} />

        <Pressable style={styles.statBox} onPress={handleFollowersPress}>
          <Text style={styles.statNumber}>{stats?.follower_count || 0}</Text>
          <Text style={styles.statLabel}>Followers</Text>
        </Pressable>
      </View>

      {/* Tab Switcher */}
      <View style={styles.tabSwitcher}>
        <Pressable
          style={[styles.tab, tabMode === 'feed' && styles.activeTab]}
          onPress={() => setTabMode('feed')}
        >
          <Text style={[styles.tabText, tabMode === 'feed' && styles.activeTabText]}>Feed</Text>
        </Pressable>
        <Pressable
          style={[styles.tab, tabMode === 'search' && styles.activeTab]}
          onPress={() => setTabMode('search')}
        >
          <Text style={[styles.tabText, tabMode === 'search' && styles.activeTabText]}>Search</Text>
        </Pressable>
      </View>

      {/* Search Bar - Only show in search mode */}
      {tabMode === 'search' && (
        <View style={styles.searchContainer}>
          <Ionicons
            name="search"
            size={20}
            color={colors.textSecondary}
            style={styles.searchIcon}
          />
          <TextInput
            style={styles.searchInput}
            placeholder="Search users by username..."
            placeholderTextColor={colors.textSecondary}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {searchQuery.length > 0 && (
            <Pressable onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={20} color={colors.textSecondary} />
            </Pressable>
          )}
        </View>
      )}

      {/* Content - Feed or Search Results */}
      <View style={styles.resultsContainer}>
        {tabMode === 'feed' ? (
          <FeedList />
        ) : searchQuery.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="people-outline" size={64} color={colors.textSecondary} />
            <Text style={styles.emptyStateTitle}>Find Friends</Text>
            <Text style={styles.emptyStateText}>
              Search for users by username to follow and see their travel journey
            </Text>
          </View>
        ) : searchQuery.length < 2 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyStateText}>Type at least 2 characters to search</Text>
          </View>
        ) : isSearching ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.sunsetGold} />
          </View>
        ) : searchResults.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="search-outline" size={64} color={colors.textSecondary} />
            <Text style={styles.emptyStateTitle}>No Results</Text>
            <Text style={styles.emptyStateText}>
              No users found matching &ldquo;{searchQuery}&rdquo;
            </Text>
          </View>
        ) : (
          <FlatList
            data={searchResults}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <UserSearchResultCard user={item} onPress={() => handleUserPress(item.id)} />
            )}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  statsContainer: {
    flexDirection: 'row',
    backgroundColor: colors.cardBackground,
    paddingVertical: 20,
    paddingHorizontal: 16,
    marginBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  statBox: {
    flex: 1,
    alignItems: 'center',
  },
  statDivider: {
    width: 1,
    backgroundColor: colors.border,
    marginHorizontal: 16,
  },
  statNumber: {
    fontSize: 28,
    fontFamily: fonts.bold,
    color: colors.text,
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 14,
    fontFamily: fonts.regular,
    color: colors.textSecondary,
  },
  tabSwitcher: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginBottom: 16,
    backgroundColor: colors.border,
    borderRadius: 12,
    padding: 4,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
  },
  activeTab: {
    backgroundColor: colors.cardBackground,
  },
  tabText: {
    fontSize: 14,
    fontFamily: fonts.medium,
    color: colors.textSecondary,
  },
  activeTabText: {
    color: colors.text,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.cardBackground,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginHorizontal: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    fontFamily: fonts.regular,
    color: colors.text,
  },
  resultsContainer: {
    flex: 1,
    paddingHorizontal: 16,
  },
  listContent: {
    paddingBottom: 20,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
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
