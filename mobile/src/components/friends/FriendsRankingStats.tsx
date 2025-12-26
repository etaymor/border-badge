import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { useFriendsRanking } from '@hooks/useFriendsRanking';

export function FriendsRankingStats() {
  const { data: ranking, isLoading } = useFriendsRanking();

  if (isLoading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="small" color={colors.primary} />
      </View>
    );
  }

  if (!ranking || ranking.total_friends === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.emptyState}>
          <Ionicons name="trophy-outline" size={32} color={colors.textTertiary} />
          <Text style={styles.emptyText}>Follow friends to see your ranking</Text>
        </View>
      </View>
    );
  }

  const rankText = getRankText(ranking.rank, ranking.total_friends);

  return (
    <View style={styles.container}>
      <View style={styles.statRow}>
        <View style={styles.statItem}>
          <View style={styles.rankBadge}>
            <Ionicons name="trophy" size={16} color={colors.sunsetGold} />
            <Text style={styles.rankNumber}>#{ranking.rank}</Text>
          </View>
          <Text style={styles.statLabel}>{rankText}</Text>
        </View>

        <View style={styles.statDivider} />

        <View style={styles.statItem}>
          <Text style={styles.statNumber}>{ranking.my_countries}</Text>
          <Text style={styles.statLabel}>Your Countries</Text>
        </View>

        <View style={styles.statDivider} />

        <View style={styles.statItem}>
          <Text style={styles.statNumber}>{ranking.total_friends}</Text>
          <Text style={styles.statLabel}>Following</Text>
        </View>
      </View>

      {ranking.leader_username && ranking.leader_countries && (
        <View style={styles.leaderRow}>
          <Ionicons name="medal-outline" size={14} color={colors.sunsetGold} />
          <Text style={styles.leaderText}>
            @{ranking.leader_username} leads with {ranking.leader_countries} countries
          </Text>
        </View>
      )}
    </View>
  );
}

function getRankText(rank: number, total: number): string {
  if (rank === 1) return 'Top traveler!';
  if (rank <= 3) return `Top 3 of ${total}`;
  const percentage = Math.round((rank / total) * 100);
  if (percentage <= 10) return `Top 10%`;
  if (percentage <= 25) return `Top 25%`;
  return `Rank ${rank} of ${total}`;
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    marginHorizontal: 16,
    marginTop: 12,
    padding: 16,
  },
  emptyState: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 8,
  },
  emptyText: {
    fontFamily: fonts.openSans.regular,
    fontSize: 14,
    color: colors.textTertiary,
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  rankBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  rankNumber: {
    fontFamily: fonts.playfair.bold,
    fontSize: 20,
    color: colors.midnightNavy,
  },
  statNumber: {
    fontFamily: fonts.playfair.bold,
    fontSize: 20,
    color: colors.midnightNavy,
  },
  statLabel: {
    fontFamily: fonts.openSans.regular,
    fontSize: 12,
    color: colors.stormGray,
    marginTop: 4,
  },
  statDivider: {
    width: 1,
    height: 32,
    backgroundColor: colors.border,
  },
  leaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  leaderText: {
    fontFamily: fonts.openSans.regular,
    fontSize: 12,
    color: colors.stormGray,
  },
});
