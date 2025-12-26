import React from 'react';
import { View, Text, Image, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { FollowButton } from './FollowButton';

export interface UserSearchResult {
  id: string;
  username: string;
  avatar_url: string | null;
  country_count: number;
  is_following: boolean;
}

interface UserSearchResultCardProps {
  user: UserSearchResult;
  onPress: () => void;
}

export function UserSearchResultCard({ user, onPress }: UserSearchResultCardProps) {
  return (
    <Pressable style={styles.container} onPress={onPress}>
      <View style={styles.leftSection}>
        {user.avatar_url ? (
          <Image source={{ uri: user.avatar_url }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarPlaceholder]}>
            <Ionicons name="person" size={24} color={colors.textSecondary} />
          </View>
        )}

        <View style={styles.userInfo}>
          <Text style={styles.username}>@{user.username}</Text>
          <Text style={styles.countryCount}>
            {user.country_count} {user.country_count === 1 ? 'country' : 'countries'}
          </Text>
        </View>
      </View>

      <FollowButton userId={user.id} isFollowing={user.is_following} compact />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: colors.cardBackground,
    borderRadius: 12,
    marginBottom: 8,
  },
  leftSection: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    marginRight: 12,
  },
  avatarPlaceholder: {
    backgroundColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  userInfo: {
    flex: 1,
  },
  username: {
    fontSize: 16,
    fontFamily: fonts.medium,
    color: colors.text,
    marginBottom: 2,
  },
  countryCount: {
    fontSize: 14,
    fontFamily: fonts.regular,
    color: colors.textSecondary,
  },
});
