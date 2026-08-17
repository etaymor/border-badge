import React from 'react';
import { StyleSheet, View } from 'react-native';

import { Skeleton } from '@components/ui';
import { colors } from '@constants/colors';

/**
 * Skeleton loaders for the social surfaces. These mirror the real layouts
 * (stats grid, feed cards, user rows, profile header) so loading states keep
 * the page structure instead of collapsing to a spinner.
 */

/** Skeleton for the FriendsStatsGrid (three stat boxes). */
export function FriendsStatsSkeleton() {
  return (
    <View style={styles.statsGrid} testID="friends-stats-skeleton">
      {[0, 1, 2].map((i) => (
        <View key={i} style={styles.statBox}>
          <Skeleton width={44} height={24} borderRadius={6} />
          <Skeleton width={64} height={10} borderRadius={4} style={styles.statLabel} />
        </View>
      ))}
    </View>
  );
}

/** Skeleton for a single feed card (header row + media + caption). */
function FeedCardSkeleton() {
  return (
    <View style={styles.feedCard}>
      <View style={styles.feedHeader}>
        <Skeleton width={36} height={36} borderRadius={18} />
        <View style={styles.feedHeaderTexts}>
          <Skeleton width={110} height={12} borderRadius={4} />
          <Skeleton width={40} height={10} borderRadius={4} />
        </View>
      </View>
      <Skeleton width="100%" height={220} borderRadius={0} />
      <View style={styles.feedCaption}>
        <Skeleton width="80%" height={14} borderRadius={4} />
      </View>
    </View>
  );
}

/** Skeleton for the activity feed (a couple of cards). */
export function FeedSkeleton({ count = 2 }: { count?: number }) {
  return (
    <View testID="feed-skeleton">
      {Array.from({ length: count }, (_, i) => (
        <FeedCardSkeleton key={i} />
      ))}
    </View>
  );
}

/** Skeleton for follower/following/blocked user rows. */
export function UserListSkeleton({ count = 6 }: { count?: number }) {
  return (
    <View testID="user-list-skeleton">
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={styles.userRow}>
          <Skeleton width={52} height={52} borderRadius={26} />
          <View style={styles.userInfo}>
            <Skeleton width={140} height={14} borderRadius={4} />
            <Skeleton width={90} height={12} borderRadius={4} style={styles.userInfoSecond} />
          </View>
          <Skeleton width={56} height={32} borderRadius={16} />
        </View>
      ))}
    </View>
  );
}

/** Skeleton for the user profile header (avatar + name + stats). */
export function UserProfileSkeleton() {
  return (
    <View testID="user-profile-skeleton">
      <View style={styles.profileHeader}>
        <Skeleton width={66} height={66} borderRadius={33} />
        <View style={styles.profileInfo}>
          <Skeleton width={160} height={20} borderRadius={4} />
          <Skeleton width={100} height={32} borderRadius={16} style={styles.profileButton} />
        </View>
      </View>
      <View style={styles.statsGrid}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={styles.statBox}>
            <Skeleton width={44} height={24} borderRadius={6} />
            <Skeleton width={64} height={10} borderRadius={4} style={styles.statLabel} />
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  statsGrid: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 24,
    gap: 12,
  },
  statBox: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.cloudWhite,
    borderWidth: 1,
    borderColor: colors.paperBeige,
  },
  statLabel: {
    marginTop: 8,
  },
  feedCard: {
    backgroundColor: colors.cloudWhite,
    marginBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: colors.paperBeige,
    paddingBottom: 16,
  },
  feedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  feedHeaderTexts: {
    gap: 6,
  },
  feedCaption: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: colors.cloudWhite,
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.paperBeige,
  },
  userInfo: {
    flex: 1,
    marginLeft: 14,
  },
  userInfoSecond: {
    marginTop: 6,
  },
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 20,
    paddingHorizontal: 20,
  },
  profileInfo: {
    marginLeft: 16,
    flex: 1,
  },
  profileButton: {
    marginTop: 10,
  },
});
