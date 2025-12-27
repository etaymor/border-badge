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
        <ActivityIndicator size="small" color={colors.adobeBrick} />
      </View>
    );
  }

  if (!ranking || ranking.total_friends === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.emptyState}>
          <View style={styles.emptyIconWrap}>
            <Ionicons name="trophy-outline" size={24} color={colors.sunsetGold} />
          </View>
          <Text style={styles.emptyText}>Follow travelers to see your ranking</Text>
        </View>
      </View>
    );
  }

  const rankText = getRankText(ranking.rank, ranking.total_friends);
  const isTopRanked = ranking.rank <= 3;

  return (
    <View style={styles.container}>
      <View style={styles.rankingHeader}>
        <View style={[styles.trophyBadge, isTopRanked && styles.trophyBadgeTop]}>
          <Ionicons
            name={isTopRanked ? 'trophy' : 'trophy-outline'}
            size={20}
            color={isTopRanked ? colors.sunsetGold : colors.stormGray}
          />
        </View>
        <View style={styles.rankInfo}>
          <Text style={[styles.rankNumber, isTopRanked && styles.rankNumberTop]}>
            #{ranking.rank}
          </Text>
          <Text style={styles.rankLabel}>{rankText}</Text>
        </View>
      </View>

      <View style={styles.statsRow}>
        <View style={styles.statItem}>
          <View style={[styles.statIconWrap, { backgroundColor: `${colors.adobeBrick}15` }]}>
            <Ionicons name="compass" size={16} color={colors.adobeBrick} />
          </View>
          <Text style={styles.statNumber}>{ranking.my_countries}</Text>
          <Text style={styles.statLabel}>Your Countries</Text>
        </View>

        <View style={styles.statDivider} />

        <View style={styles.statItem}>
          <View style={[styles.statIconWrap, { backgroundColor: `${colors.mossGreen}15` }]}>
            <Ionicons name="people" size={16} color={colors.mossGreen} />
          </View>
          <Text style={styles.statNumber}>{ranking.total_friends}</Text>
          <Text style={styles.statLabel}>Following</Text>
        </View>
      </View>

      {ranking.leader_username && ranking.leader_countries && (
        <View style={styles.leaderRow}>
          <View style={styles.leaderBadge}>
            <Ionicons name="medal" size={14} color={colors.sunsetGold} />
          </View>
          <Text style={styles.leaderText}>
            <Text style={styles.leaderUsername}>@{ranking.leader_username}</Text>
            {' leads with '}
            <Text style={styles.leaderCount}>{ranking.leader_countries}</Text>
            {' countries'}
          </Text>
        </View>
      )}
    </View>
  );
}

function getRankText(rank: number, total: number): string {
  if (rank === 1) return 'Top Explorer!';
  if (rank <= 3) return `Top 3 of ${total}`;
  const percentage = Math.round((rank / total) * 100);
  if (percentage <= 10) return 'Top 10%';
  if (percentage <= 25) return 'Top 25%';
  return `Rank ${rank} of ${total}`;
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.cloudWhite,
    borderRadius: 16,
    marginHorizontal: 16,
    marginTop: 12,
    padding: 16,
    shadowColor: colors.midnightNavy,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  emptyState: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 8,
  },
  emptyIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.paperBeige,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    fontFamily: fonts.openSans.regular,
    fontSize: 14,
    color: colors.stormGray,
  },
  rankingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.paperBeige,
  },
  trophyBadge: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.paperBeige,
    justifyContent: 'center',
    alignItems: 'center',
  },
  trophyBadgeTop: {
    backgroundColor: `${colors.sunsetGold}20`,
  },
  rankInfo: {
    marginLeft: 14,
  },
  rankNumber: {
    fontFamily: fonts.playfair.bold,
    fontSize: 28,
    color: colors.midnightNavy,
  },
  rankNumberTop: {
    color: colors.sunsetGold,
  },
  rankLabel: {
    fontFamily: fonts.openSans.regular,
    fontSize: 13,
    color: colors.stormGray,
    marginTop: 2,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  statNumber: {
    fontFamily: fonts.playfair.bold,
    fontSize: 22,
    color: colors.midnightNavy,
  },
  statLabel: {
    fontFamily: fonts.openSans.regular,
    fontSize: 11,
    color: colors.stormGray,
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  statDivider: {
    width: 1,
    height: 48,
    backgroundColor: colors.paperBeige,
  },
  leaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: colors.paperBeige,
  },
  leaderBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: `${colors.sunsetGold}20`,
    justifyContent: 'center',
    alignItems: 'center',
  },
  leaderText: {
    fontFamily: fonts.openSans.regular,
    fontSize: 13,
    color: colors.stormGray,
  },
  leaderUsername: {
    fontFamily: fonts.openSans.semiBold,
    color: colors.midnightNavy,
  },
  leaderCount: {
    fontFamily: fonts.openSans.bold,
    color: colors.adobeBrick,
  },
});
