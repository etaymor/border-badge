import { Ionicons } from '@expo/vector-icons';
import React, { useCallback } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
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

  const isSmall = size === 'small';

  if (isFollowing) {
    return (
      <TouchableOpacity
        style={[styles.followingButton, isSmall && styles.smallButton]}
        onPress={handlePress}
        disabled={isLoading}
        activeOpacity={0.7}
      >
        {isLoading ? (
          <ActivityIndicator size="small" color={colors.mossGreen} />
        ) : (
          <View style={styles.followingContent}>
            <Ionicons name="checkmark-circle" size={isSmall ? 14 : 16} color={colors.mossGreen} />
            <Text style={[styles.followingText, isSmall && styles.smallText]}>Following</Text>
          </View>
        )}
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      style={[styles.followButton, isSmall && styles.smallButton]}
      onPress={handlePress}
      disabled={isLoading}
      activeOpacity={0.8}
    >
      {isLoading ? (
        <ActivityIndicator size="small" color={colors.cloudWhite} />
      ) : (
        <View style={styles.followContent}>
          <Ionicons name="add" size={isSmall ? 14 : 16} color={colors.cloudWhite} />
          <Text style={[styles.followText, isSmall && styles.smallText]}>Follow</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  followButton: {
    backgroundColor: colors.adobeBrick,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    minWidth: 100,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.adobeBrick,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  smallButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 85,
  },
  followContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  followText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 14,
    color: colors.cloudWhite,
  },
  followingButton: {
    backgroundColor: colors.cloudWhite,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    minWidth: 100,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.mossGreen,
  },
  followingContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  followingText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 14,
    color: colors.mossGreen,
  },
  smallText: {
    fontSize: 12,
  },
});
