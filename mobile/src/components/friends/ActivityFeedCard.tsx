import React from 'react';
import { View, Text, Image, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { formatDistanceToNow } from 'date-fns';

import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import type { FeedItem } from '@hooks/useFeed';

interface ActivityFeedCardProps {
  item: FeedItem;
  onPress: () => void;
}

export function ActivityFeedCard({ item, onPress }: ActivityFeedCardProps) {
  const getActivityText = () => {
    switch (item.activity_type) {
      case 'trip_created':
        return `created a trip to ${item.country_name}`;
      case 'country_visited':
        return `visited ${item.country_name}`;
      case 'entry_added':
        return `added ${item.entry_type === 'place' ? 'a place' : item.entry_type === 'food' ? 'food' : item.entry_type === 'stay' ? 'a stay' : 'an experience'} in ${item.country_name}`;
      default:
        return 'had an activity';
    }
  };

  const getActivityIcon = () => {
    switch (item.activity_type) {
      case 'trip_created':
        return 'airplane';
      case 'country_visited':
        return 'flag';
      case 'entry_added':
        return item.entry_type === 'place'
          ? 'location'
          : item.entry_type === 'food'
            ? 'restaurant'
            : item.entry_type === 'stay'
              ? 'bed'
              : 'star';
      default:
        return 'ellipse';
    }
  };

  return (
    <Pressable style={styles.container} onPress={onPress}>
      <View style={styles.header}>
        {item.avatar_url ? (
          <Image source={{ uri: item.avatar_url }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarPlaceholder]}>
            <Ionicons name="person" size={16} color={colors.textSecondary} />
          </View>
        )}

        <View style={styles.headerText}>
          <View style={styles.activityRow}>
            <Text style={styles.username}>@{item.username}</Text>
            <Text style={styles.activityText}> {getActivityText()}</Text>
          </View>
          <Text style={styles.timestamp}>
            {formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}
          </Text>
        </View>

        <View style={styles.iconContainer}>
          <Ionicons name={getActivityIcon()} size={20} color={colors.sunsetGold} />
        </View>
      </View>

      {item.trip_name && (
        <View style={styles.detailsContainer}>
          <Text style={styles.tripName}>{item.trip_name}</Text>
          {item.media_count > 0 && (
            <View style={styles.mediaIndicator}>
              <Ionicons name="images" size={14} color={colors.textSecondary} />
              <Text style={styles.mediaCount}>{item.media_count}</Text>
            </View>
          )}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.cardBackground,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    marginRight: 10,
  },
  avatarPlaceholder: {
    backgroundColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerText: {
    flex: 1,
  },
  activityRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    marginBottom: 4,
  },
  username: {
    fontSize: 14,
    fontFamily: fonts.medium,
    color: colors.text,
  },
  activityText: {
    fontSize: 14,
    fontFamily: fonts.regular,
    color: colors.textSecondary,
  },
  timestamp: {
    fontSize: 12,
    fontFamily: fonts.regular,
    color: colors.textSecondary,
  },
  iconContainer: {
    marginLeft: 8,
  },
  detailsContainer: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  tripName: {
    flex: 1,
    fontSize: 14,
    fontFamily: fonts.medium,
    color: colors.text,
  },
  mediaIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 8,
  },
  mediaCount: {
    fontSize: 12,
    fontFamily: fonts.regular,
    color: colors.textSecondary,
    marginLeft: 4,
  },
});
