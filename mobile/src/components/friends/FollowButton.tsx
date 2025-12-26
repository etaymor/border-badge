import React, { useCallback } from 'react';
import { StyleSheet } from 'react-native';

import { Button } from '@components/ui/Button';
import { colors } from '@constants/colors';
import { useFollowUser, useUnfollowUser } from '@hooks/useFollows';

interface FollowButtonProps {
  userId: string;
  isFollowing: boolean;
  onFollowChange?: (isFollowing: boolean) => void;
  size?: 'small' | 'medium';
}

export function FollowButton({
  userId,
  isFollowing,
  onFollowChange,
  size = 'medium',
}: FollowButtonProps) {
  const followMutation = useFollowUser(userId);
  const unfollowMutation = useUnfollowUser(userId);

  const isLoading = followMutation.isPending || unfollowMutation.isPending;

  const handlePress = useCallback(() => {
    if (isFollowing) {
      unfollowMutation.mutate(undefined, {
        onSuccess: () => onFollowChange?.(false),
      });
    } else {
      followMutation.mutate(undefined, {
        onSuccess: () => onFollowChange?.(true),
      });
    }
  }, [isFollowing, followMutation, unfollowMutation, onFollowChange]);

  const buttonStyle = isFollowing ? styles.followingButton : styles.followButton;
  const textStyle = isFollowing ? styles.followingText : styles.followText;

  return (
    <Button
      title={isFollowing ? 'Following' : 'Follow'}
      onPress={handlePress}
      disabled={isLoading}
      loading={isLoading}
      style={[styles.button, buttonStyle, size === 'small' && styles.smallButton]}
      textStyle={[styles.text, textStyle, size === 'small' && styles.smallText]}
    />
  );
}

const styles = StyleSheet.create({
  button: {
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 8,
    minWidth: 100,
  },
  smallButton: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    minWidth: 80,
  },
  followButton: {
    backgroundColor: colors.primary,
  },
  followingButton: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  text: {
    fontSize: 14,
    fontWeight: '600',
  },
  smallText: {
    fontSize: 12,
  },
  followText: {
    color: colors.textInverse,
  },
  followingText: {
    color: colors.textSecondary,
  },
});
