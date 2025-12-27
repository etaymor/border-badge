import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';

interface StatBoxProps {
  value: string | number;
  label: string;
  backgroundColor: string;
  textColor?: string;
  labelColor?: string;
  index: number;
  show: boolean;
  onPress?: () => void;
}

function StatBox({
  value,
  label,
  backgroundColor,
  textColor = colors.midnightNavy,
  labelColor,
  index,
  show,
  onPress,
}: StatBoxProps) {
  const scaleAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (show) {
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 6,
        tension: 50,
        delay: index * 100,
        useNativeDriver: true,
      }).start();
    }
  }, [show, index, scaleAnim]);

  const content = (
    <Animated.View
      style={[
        styles.statBox,
        {
          backgroundColor,
          transform: [{ scale: scaleAnim }],
          opacity: scaleAnim,
        },
      ]}
    >
      <Text style={[styles.statValue, { color: textColor }]}>{value}</Text>
      <Text
        style={[
          styles.statLabel,
          labelColor ? { color: labelColor } : { color: textColor, opacity: 0.7 },
        ]}
      >
        {label}
      </Text>
    </Animated.View>
  );

  if (onPress) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.8} style={styles.touchable}>
        {content}
      </TouchableOpacity>
    );
  }

  return <View style={styles.touchable}>{content}</View>;
}

interface FriendsStatsGridProps {
  followerCount: number;
  followingCount: number;
  rank: number | null;
  isLoading: boolean;
  onFollowersPress?: () => void;
  onFollowingPress?: () => void;
}

export function FriendsStatsGrid({
  followerCount,
  followingCount,
  rank,
  isLoading,
  onFollowersPress,
  onFollowingPress,
}: FriendsStatsGridProps) {
  const rankDisplay = rank ? `#${rank}` : '-';

  return (
    <View style={styles.statsGrid}>
      <StatBox
        value={followerCount}
        label="FOLLOWERS"
        backgroundColor={colors.adobeBrick}
        textColor={colors.cloudWhite}
        labelColor="rgba(255,255,255,0.8)"
        index={0}
        show={!isLoading}
        onPress={onFollowersPress}
      />
      <StatBox
        value={followingCount}
        label="FOLLOWING"
        backgroundColor={colors.lakeBlue}
        textColor={colors.midnightNavy}
        labelColor={colors.midnightNavy}
        index={1}
        show={!isLoading}
        onPress={onFollowingPress}
      />
      <StatBox
        value={rankDisplay}
        label="RANK"
        backgroundColor={colors.sunsetGold}
        textColor={colors.midnightNavy}
        labelColor={colors.midnightNavy}
        index={2}
        show={!isLoading}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  statsGrid: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 16,
    gap: 12,
  },
  touchable: {
    flex: 1,
  },
  statBox: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  statValue: {
    fontFamily: fonts.openSans.bold,
    fontSize: 22,
    marginBottom: 4,
  },
  statLabel: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 10,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
});
