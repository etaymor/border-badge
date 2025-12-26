import React from 'react';
import { TouchableOpacity, Text, StyleSheet, ActivityIndicator, ViewStyle } from 'react-native';

import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { useFollowUser, useUnfollowUser } from '@hooks/useFollows';

interface FollowButtonProps {
  userId: string;
  isFollowing: boolean;
  style?: ViewStyle;
  compact?: boolean; // For use in lists vs profile pages
}

export function FollowButton({ userId, isFollowing, style, compact = false }: FollowButtonProps) {
  const followMutation = useFollowUser(userId);
  const unfollowMutation = useUnfollowUser(userId);

  const isLoading = followMutation.isPending || unfollowMutation.isPending;

  const handlePress = () => {
    if (isFollowing) {
      unfollowMutation.mutate();
    } else {
      followMutation.mutate();
    }
  };

  return (
    <TouchableOpacity
      style={[
        compact ? styles.compactButton : styles.button,
        isFollowing ? styles.following : styles.notFollowing,
        style,
      ]}
      onPress={handlePress}
      disabled={isLoading}
      activeOpacity={0.7}
    >
      {isLoading ? (
        <ActivityIndicator
          size="small"
          color={isFollowing ? colors.charcoalGray : colors.cloudWhite}
        />
      ) : (
        <Text
          style={[
            compact ? styles.compactText : styles.text,
            isFollowing ? styles.followingText : styles.notFollowingText,
          ]}
        >
          {isFollowing ? 'Following' : 'Follow'}
        </Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 44,
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compactButton: {
    minHeight: 32,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notFollowing: {
    backgroundColor: colors.sunsetGold,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  following: {
    backgroundColor: colors.cloudWhite,
    borderWidth: 1,
    borderColor: colors.border,
  },
  text: {
    fontSize: 16,
    fontFamily: fonts.medium,
    lineHeight: 20,
  },
  compactText: {
    fontSize: 14,
    fontFamily: fonts.medium,
    lineHeight: 16,
  },
  notFollowingText: {
    color: colors.cloudWhite,
  },
  followingText: {
    color: colors.charcoalGray,
  },
});
