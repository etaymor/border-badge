/**
 * TripPartners - Displays trip participants as an overlapping avatar stack
 *
 * Design: Simple overlapping avatars. Pending users are greyed out.
 * For email-only users (no username), shows first 2 characters of email.
 */

import React, { memo, useMemo } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import type { TripTag, TripTagUser } from '@hooks/useTrips';

/** Represents a person to display in the avatar stack */
interface TripParticipant {
  id: string;
  user?: TripTagUser;
  isPending: boolean;
}

interface TripPartnersProps {
  /** Trip tags (tagged users) */
  tags: TripTag[];
  /** Trip owner info (to show owner when viewing someone else's trip) */
  owner?: TripTagUser;
  /** Current user ID (to avoid showing yourself) */
  currentUserId?: string;
  /** Maximum avatars to show before +N indicator */
  maxVisible?: number;
  /** Size of each avatar */
  avatarSize?: number;
  /** Callback when component is pressed */
  onPress?: () => void;
}

/**
 * Get display initials from username or email
 * For email addresses, takes first 2 chars before @
 */
function getInitials(user?: TripTagUser): string {
  if (!user) return '??';

  // Check if username looks like an email
  const username = user.username || '';
  let initials: string;
  if (username.includes('@')) {
    // Email: take first 2 chars before @
    const localPart = username.split('@')[0];
    initials = localPart.slice(0, 2).toUpperCase();
  } else {
    // Regular username: take first 2 chars
    initials = username.slice(0, 2).toUpperCase();
  }

  // Fallback for empty usernames or emails with no local part (e.g. "@example.com")
  return initials || '?';
}

function TripPartnersComponent({
  tags,
  owner,
  currentUserId,
  maxVisible = 4,
  avatarSize = 28,
  onPress,
}: TripPartnersProps) {
  // Build participant list: owner first (if viewing someone else's trip), then tags
  const participants = useMemo(() => {
    const result: TripParticipant[] = [];

    // Add owner if provided and not the current user
    if (owner && owner.user_id !== currentUserId) {
      result.push({
        id: `owner-${owner.user_id}`,
        user: owner,
        isPending: false,
      });
    }

    // Add tagged users (filter out declined, sort approved before pending)
    const validTags = tags
      .filter((tag) => tag.status !== 'declined')
      .filter((tag) => tag.tagged_user_id !== currentUserId) // Don't show yourself
      .sort((a, b) => {
        if (a.status === 'approved' && b.status === 'pending') return -1;
        if (a.status === 'pending' && b.status === 'approved') return 1;
        return 0;
      });

    for (const tag of validTags) {
      result.push({
        id: tag.id,
        user: tag.user,
        isPending: tag.status === 'pending',
      });
    }

    return result;
  }, [tags, owner, currentUserId]);

  const displayedParticipants = participants.slice(0, maxVisible);
  const overflowCount = Math.max(0, participants.length - maxVisible);

  if (participants.length === 0) {
    return null;
  }

  // Calculate overlap - each avatar overlaps 35% with the previous
  const overlapOffset = avatarSize * 0.65;
  const stackWidth =
    overlapOffset * (displayedParticipants.length - 1) +
    avatarSize +
    (overflowCount > 0 ? overlapOffset + avatarSize * 0.8 : 0);

  const content = (
    <View style={[styles.avatarStack, { width: stackWidth, height: avatarSize + 4 }]}>
      {displayedParticipants.map((participant, index) => {
        const initials = getInitials(participant.user);
        const hasAvatar = !!participant.user?.avatar_url;

        return (
          <View
            key={participant.id}
            style={[
              styles.avatarWrapper,
              {
                left: index * overlapOffset,
                zIndex: displayedParticipants.length - index,
                width: avatarSize + 4,
                height: avatarSize + 4,
                opacity: participant.isPending ? 0.5 : 1,
              },
            ]}
          >
            <View
              style={[
                styles.avatarRing,
                {
                  width: avatarSize + 4,
                  height: avatarSize + 4,
                  borderRadius: (avatarSize + 4) / 2,
                },
              ]}
            >
              {hasAvatar ? (
                <Image
                  source={{ uri: participant.user!.avatar_url! }}
                  style={[
                    styles.avatarImage,
                    {
                      width: avatarSize,
                      height: avatarSize,
                      borderRadius: avatarSize / 2,
                    },
                  ]}
                />
              ) : (
                <View
                  style={[
                    styles.avatarPlaceholder,
                    {
                      width: avatarSize,
                      height: avatarSize,
                      borderRadius: avatarSize / 2,
                    },
                  ]}
                >
                  <Text style={[styles.avatarInitials, { fontSize: avatarSize * 0.38 }]}>
                    {initials}
                  </Text>
                </View>
              )}
            </View>
          </View>
        );
      })}

      {/* Overflow indicator */}
      {overflowCount > 0 && (
        <View
          style={[
            styles.overflowBadge,
            {
              left: displayedParticipants.length * overlapOffset,
              width: avatarSize * 0.8,
              height: avatarSize * 0.8,
              borderRadius: (avatarSize * 0.8) / 2,
              top: (avatarSize + 4 - avatarSize * 0.8) / 2,
            },
          ]}
        >
          <Text style={[styles.overflowText, { fontSize: avatarSize * 0.3 }]}>
            +{overflowCount}
          </Text>
        </View>
      )}
    </View>
  );

  const accessibilityLabel = `${participants.length} trip partner${participants.length !== 1 ? 's' : ''}`;

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => pressed && styles.pressed}
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
      >
        {content}
      </Pressable>
    );
  }

  return <View accessibilityLabel={accessibilityLabel}>{content}</View>;
}

export const TripPartners = memo(TripPartnersComponent);
TripPartners.displayName = 'TripPartners';

const styles = StyleSheet.create({
  avatarStack: {
    flexDirection: 'row',
    position: 'relative',
  },
  avatarWrapper: {
    position: 'absolute',
    top: 0,
  },
  avatarRing: {
    backgroundColor: colors.warmCream,
    borderWidth: 2,
    borderColor: colors.warmCream,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  avatarImage: {
    backgroundColor: colors.paperBeige,
  },
  avatarPlaceholder: {
    backgroundColor: colors.adobeBrick,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: {
    fontFamily: fonts.playfair.bold,
    color: colors.cloudWhite,
  },
  overflowBadge: {
    position: 'absolute',
    backgroundColor: colors.paperBeige,
    borderWidth: 1.5,
    borderColor: colors.warmCream,
    justifyContent: 'center',
    alignItems: 'center',
  },
  overflowText: {
    fontFamily: fonts.oswald.medium,
    color: colors.midnightNavy,
  },
  pressed: {
    opacity: 0.8,
  },
});
