import React, { useCallback } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { useFollowUser } from '@hooks/useFollows';
import { InviterSummary } from '@hooks/useInvites';

import { UserAvatar } from './UserAvatar';

interface InviteFollowBackPromptProps {
  /** The inviter, from the redeem-invite response. */
  inviter: InviterSummary;
  /** Called when the prompt should disappear (followed back or dismissed). */
  onDismiss: () => void;
}

/**
 * "〈inviter〉 invited you -- follow back" prompt, shown after an invite code
 * is redeemed (useRedeemInvite). The inviter already follows the new user;
 * this closes the loop by offering the follow back.
 *
 * Presentation-only: the caller decides where it renders (inline card after
 * signup today; U7's deep-link flow reuses it on invite-link launches).
 */
export function InviteFollowBackPrompt({ inviter, onDismiss }: InviteFollowBackPromptProps) {
  const displayName = inviter.display_name || inviter.username || 'A friend';
  const followMutation = useFollowUser(inviter.user_id, inviter.username ?? undefined);

  const handleFollowBack = useCallback(() => {
    if (followMutation.isPending) return;
    followMutation.mutate(undefined, {
      onSuccess: onDismiss,
    });
  }, [followMutation, onDismiss]);

  return (
    <View style={styles.card} testID="invite-follow-back-prompt">
      <UserAvatar
        avatarUrl={inviter.avatar_url}
        username={inviter.username || displayName}
        size={56}
      />
      <Text style={styles.title}>{displayName} invited you</Text>
      <Text style={styles.subtitle}>
        {inviter.username ? `@${inviter.username} is` : 'They are'} already following you. Follow
        back to see their trips in your feed.
      </Text>
      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.followButton}
          onPress={handleFollowBack}
          disabled={followMutation.isPending}
          accessibilityRole="button"
          accessibilityLabel={`Follow ${displayName} back`}
          testID="invite-follow-back-button"
        >
          {followMutation.isPending ? (
            <ActivityIndicator size="small" color={colors.cloudWhite} />
          ) : (
            <Text style={styles.followButtonText}>Follow back</Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.dismissButton}
          onPress={onDismiss}
          accessibilityRole="button"
          testID="invite-follow-back-dismiss"
        >
          <Text style={styles.dismissButtonText}>Not now</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: 'center',
    backgroundColor: colors.cloudWhite,
    borderRadius: 16,
    padding: 20,
    shadowColor: colors.midnightNavy,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
  },
  title: {
    fontFamily: fonts.body.bold,
    fontSize: 17,
    color: colors.midnightNavy,
    marginTop: 12,
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: fonts.body.regular,
    fontSize: 14,
    color: colors.stormGray,
    marginTop: 6,
    textAlign: 'center',
    lineHeight: 20,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    gap: 12,
  },
  followButton: {
    backgroundColor: colors.adobeBrick,
    borderRadius: 20,
    paddingHorizontal: 24,
    paddingVertical: 10,
    minWidth: 130,
    alignItems: 'center',
  },
  followButtonText: {
    fontFamily: fonts.body.bold,
    fontSize: 14,
    color: colors.cloudWhite,
  },
  dismissButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  dismissButtonText: {
    fontFamily: fonts.body.regular,
    fontSize: 14,
    color: colors.stormGray,
  },
});
