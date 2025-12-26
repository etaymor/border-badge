import { Ionicons } from '@expo/vector-icons';
import React, { useCallback } from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import type { FeedItem } from '@hooks/useFeed';

import { UserAvatar } from './UserAvatar';

interface FeedCardProps {
  item: FeedItem;
  onUserPress?: (userId: string, username: string) => void;
  onCountryPress?: (countryCode: string, countryName: string) => void;
  onEntryPress?: (entryId: string) => void;
}

export function FeedCard({
  item,
  onUserPress,
  onCountryPress,
  onEntryPress,
}: FeedCardProps) {
  const handleUserPress = useCallback(() => {
    onUserPress?.(item.user.user_id, item.user.username);
  }, [item.user, onUserPress]);

  const handleContentPress = useCallback(() => {
    if (item.country) {
      onCountryPress?.(item.country.country_code, item.country.country_name);
    } else if (item.entry) {
      onEntryPress?.(item.entry.entry_id);
    }
  }, [item, onCountryPress, onEntryPress]);

  const formatTimeAgo = (dateString: string): string => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const getActivityIcon = (): string => {
    if (item.activity_type === 'country_visited') {
      return 'flag';
    }
    switch (item.entry?.entry_type) {
      case 'food':
        return 'restaurant';
      case 'place':
        return 'location';
      case 'stay':
        return 'bed';
      case 'experience':
        return 'star';
      default:
        return 'bookmark';
    }
  };

  const getActivityText = (): string => {
    if (item.activity_type === 'country_visited' && item.country) {
      return `visited ${item.country.country_name}`;
    }
    if (item.entry) {
      return `added ${item.entry.entry_name}`;
    }
    return 'did something';
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.header} onPress={handleUserPress}>
        <UserAvatar
          avatarUrl={item.user.avatar_url}
          username={item.user.username}
          size={40}
        />
        <View style={styles.headerText}>
          <Text style={styles.username}>@{item.user.username}</Text>
          <Text style={styles.timestamp}>{formatTimeAgo(item.created_at)}</Text>
        </View>
      </TouchableOpacity>

      <TouchableOpacity style={styles.content} onPress={handleContentPress}>
        <View style={styles.activityRow}>
          <View style={styles.iconContainer}>
            <Ionicons
              name={getActivityIcon() as keyof typeof Ionicons.glyphMap}
              size={20}
              color={colors.primary}
            />
          </View>
          <Text style={styles.activityText}>{getActivityText()}</Text>
        </View>

        {item.entry?.image_url && (
          <Image
            source={{ uri: item.entry.image_url }}
            style={styles.entryImage}
            resizeMode="cover"
          />
        )}

        {item.entry?.location_name && (
          <View style={styles.locationRow}>
            <Ionicons name="location-outline" size={14} color={colors.textTertiary} />
            <Text style={styles.locationText}>{item.entry.location_name}</Text>
          </View>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    marginHorizontal: 16,
    marginBottom: 12,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerText: {
    marginLeft: 12,
    flex: 1,
  },
  username: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 14,
    color: colors.text,
  },
  timestamp: {
    fontFamily: fonts.openSans.regular,
    fontSize: 12,
    color: colors.textTertiary,
    marginTop: 2,
  },
  content: {
    padding: 12,
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconContainer: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.lakeBlue,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  activityText: {
    fontFamily: fonts.openSans.regular,
    fontSize: 16,
    color: colors.text,
    flex: 1,
  },
  entryImage: {
    width: '100%',
    height: 200,
    borderRadius: 8,
    marginTop: 12,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 4,
  },
  locationText: {
    fontFamily: fonts.openSans.regular,
    fontSize: 12,
    color: colors.textTertiary,
  },
});
