import React from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { FollowButton } from '@components/friends/FollowButton';
import type { RootStackParamList } from '@navigation/types';
import { api } from '@services/api';
import { useQuery } from '@tanstack/react-query';

type UserProfileScreenRouteProp = RouteProp<RootStackParamList, 'UserProfile'>;
type UserProfileScreenNavigationProp = NativeStackNavigationProp<RootStackParamList>;

interface UserProfile {
  id: string;
  username: string;
  avatar_url: string | null;
  country_count: number;
  is_following: boolean;
  follower_count: number;
  following_count: number;
}

function useUserProfile(userId: string) {
  return useQuery({
    queryKey: ['user', userId],
    queryFn: async (): Promise<UserProfile> => {
      const response = await api.get(`/users/${userId}`);
      return response.data;
    },
  });
}

export default function UserProfileScreen() {
  const route = useRoute<UserProfileScreenRouteProp>();
  const navigation = useNavigation<UserProfileScreenNavigationProp>();
  const { userId } = route.params;

  const { data: profile, isLoading, error } = useUserProfile(userId);

  const handleFollowingPress = () => {
    navigation.navigate('FollowersList', { mode: 'following', userId });
  };

  const handleFollowersPress = () => {
    navigation.navigate('FollowersList', { mode: 'followers', userId });
  };

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.sunsetGold} />
      </View>
    );
  }

  if (error || !profile) {
    return (
      <View style={styles.errorContainer}>
        <Ionicons name="alert-circle-outline" size={64} color={colors.textSecondary} />
        <Text style={styles.errorTitle}>User Not Found</Text>
        <Text style={styles.errorText}>
          This user profile could not be loaded. They may have deleted their account.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Profile Header */}
      <View style={styles.header}>
        {profile.avatar_url ? (
          <Image source={{ uri: profile.avatar_url }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarPlaceholder]}>
            <Ionicons name="person" size={48} color={colors.textSecondary} />
          </View>
        )}

        <Text style={styles.username}>@{profile.username}</Text>

        {/* Stats Row */}
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={styles.statNumber}>{profile.country_count}</Text>
            <Text style={styles.statLabel}>
              {profile.country_count === 1 ? 'Country' : 'Countries'}
            </Text>
          </View>

          <Pressable style={styles.statItem} onPress={handleFollowersPress}>
            <Text style={styles.statNumber}>{profile.follower_count}</Text>
            <Text style={styles.statLabel}>
              {profile.follower_count === 1 ? 'Follower' : 'Followers'}
            </Text>
          </Pressable>

          <Pressable style={styles.statItem} onPress={handleFollowingPress}>
            <Text style={styles.statNumber}>{profile.following_count}</Text>
            <Text style={styles.statLabel}>Following</Text>
          </Pressable>
        </View>

        {/* Follow Button */}
        <FollowButton
          userId={profile.id}
          isFollowing={profile.is_following}
          style={styles.followButton}
        />
      </View>

      {/* Travel Summary Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Travel Summary</Text>
        <View style={styles.travelCard}>
          <Ionicons name="earth" size={24} color={colors.sunsetGold} />
          <Text style={styles.travelText}>
            {profile.username} has visited {profile.country_count}{' '}
            {profile.country_count === 1 ? 'country' : 'countries'}
          </Text>
        </View>
      </View>

      {/* Placeholder for Future Features */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Recent Activity</Text>
        <View style={styles.placeholderCard}>
          <Text style={styles.placeholderText}>
            Activity feed coming soon! You&apos;ll see recent trips and updates here.
          </Text>
        </View>
      </View>
    </ScrollView>
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
  header: {
    alignItems: 'center',
    paddingVertical: 32,
    paddingHorizontal: 16,
    backgroundColor: colors.cardBackground,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
    marginBottom: 16,
  },
  avatarPlaceholder: {
    backgroundColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  username: {
    fontSize: 24,
    fontFamily: fonts.bold,
    color: colors.text,
    marginBottom: 24,
  },
  statsRow: {
    flexDirection: 'row',
    width: '100%',
    justifyContent: 'space-around',
    marginBottom: 24,
  },
  statItem: {
    alignItems: 'center',
  },
  statNumber: {
    fontSize: 20,
    fontFamily: fonts.bold,
    color: colors.text,
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 14,
    fontFamily: fonts.regular,
    color: colors.textSecondary,
  },
  followButton: {
    width: '100%',
    maxWidth: 300,
  },
  section: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontFamily: fonts.bold,
    color: colors.text,
    marginBottom: 12,
  },
  travelCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.cardBackground,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  travelText: {
    flex: 1,
    fontSize: 16,
    fontFamily: fonts.regular,
    color: colors.text,
    marginLeft: 12,
    lineHeight: 22,
  },
  placeholderCard: {
    backgroundColor: colors.cardBackground,
    padding: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  placeholderText: {
    fontSize: 14,
    fontFamily: fonts.regular,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
});
