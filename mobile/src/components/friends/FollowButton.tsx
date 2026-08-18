import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useCallback } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { useAnimatedPress, AnimatedPressPresets } from '@hooks/useAnimatedPress';
import { useFollowUser, useUnfollowUser } from '@hooks/useFollows';

interface FollowButtonProps {
  userId: string;
  username?: string;
  isFollowing: boolean;
  onFollowChange?: (isFollowing: boolean) => void;
  size?: 'small' | 'medium';
}

/**
 * Follow/unfollow toggle. The rendered state comes straight from the
 * `isFollowing` prop, whose source cache the mutations update optimistically
 * (and roll back on error) - the query cache is the single source of truth.
 */
export function FollowButton({
  userId,
  username,
  isFollowing,
  onFollowChange,
  size = 'medium',
}: FollowButtonProps) {
  const followMutation = useFollowUser(userId, username);
  const unfollowMutation = useUnfollowUser(userId, username);
  const { scaleValue, pressHandlers } = useAnimatedPress(AnimatedPressPresets.default);

  const isPending = followMutation.isPending || unfollowMutation.isPending;

  const handlePress = useCallback(() => {
    // Prevent rapid clicks during pending mutations to avoid state desync
    if (isPending) {
      return;
    }

    const next = !isFollowing;
    const mutation = next ? followMutation : unfollowMutation;
    mutation.mutate(undefined, {
      onSuccess: () => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        onFollowChange?.(next);
      },
    });
  }, [isFollowing, isPending, followMutation, unfollowMutation, onFollowChange]);

  const isSmall = size === 'small';

  if (isFollowing) {
    return (
      <Animated.View style={{ transform: [{ scale: scaleValue }] }}>
        <TouchableOpacity
          style={[styles.followingButton, isSmall && styles.smallButton]}
          onPress={handlePress}
          disabled={isPending}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={username ? `Unfollow ${username}` : 'Unfollow'}
          accessibilityState={{ disabled: isPending, busy: isPending }}
          {...pressHandlers}
        >
          <View style={styles.followingContent}>
            <Ionicons name="checkmark-circle" size={isSmall ? 14 : 16} color={colors.mossGreen} />
            <Text style={[styles.followingText, isSmall && styles.smallText]}>Following</Text>
          </View>
        </TouchableOpacity>
      </Animated.View>
    );
  }

  return (
    <Animated.View style={{ transform: [{ scale: scaleValue }] }}>
      <TouchableOpacity
        style={[styles.followButton, isSmall && styles.smallButton]}
        onPress={handlePress}
        disabled={isPending}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={username ? `Follow ${username}` : 'Follow'}
        accessibilityState={{ disabled: isPending, busy: isPending }}
        {...pressHandlers}
      >
        <View style={styles.followContent}>
          <Ionicons name="add" size={isSmall ? 14 : 16} color={colors.cloudWhite} />
          <Text style={[styles.followText, isSmall && styles.smallText]}>Follow</Text>
        </View>
      </TouchableOpacity>
    </Animated.View>
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
