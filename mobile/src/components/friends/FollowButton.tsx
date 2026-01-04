import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { useFollowUser, useUnfollowUser } from '@hooks/useFollows';

interface FollowButtonProps {
  userId: string;
  username?: string;
  isFollowing: boolean;
  onFollowChange?: (isFollowing: boolean) => void;
  size?: 'small' | 'medium';
}

export function FollowButton({
  userId,
  username,
  isFollowing: isFollowingProp,
  onFollowChange,
  size = 'medium',
}: FollowButtonProps) {
  // Local optimistic state for instant UI feedback
  const [optimisticFollowing, setOptimisticFollowing] = useState(isFollowingProp);

  // Sync with prop when it changes (e.g., after refetch)
  useEffect(() => {
    setOptimisticFollowing(isFollowingProp);
  }, [isFollowingProp]);

  const followMutation = useFollowUser(userId, username);
  const unfollowMutation = useUnfollowUser(userId, username);

  const isLoading = followMutation.isPending || unfollowMutation.isPending;

  const handlePress = useCallback(() => {
    // Prevent rapid clicks during pending mutations to avoid state desync
    if (isLoading) {
      return;
    }

    if (optimisticFollowing) {
      // Optimistically update UI immediately
      setOptimisticFollowing(false);
      unfollowMutation.mutate(undefined, {
        onSuccess: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          onFollowChange?.(false);
        },
        onError: () => {
          // Rollback on error
          setOptimisticFollowing(true);
        },
      });
    } else {
      // Optimistically update UI immediately
      setOptimisticFollowing(true);
      followMutation.mutate(undefined, {
        onSuccess: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          onFollowChange?.(true);
        },
        onError: () => {
          // Rollback on error
          setOptimisticFollowing(false);
        },
      });
    }
  }, [optimisticFollowing, followMutation, unfollowMutation, onFollowChange, isLoading]);

  const isSmall = size === 'small';

  if (optimisticFollowing) {
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
