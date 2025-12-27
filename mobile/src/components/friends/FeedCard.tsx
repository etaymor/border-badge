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

export function FeedCard({ item, onUserPress, onCountryPress, onEntryPress }: FeedCardProps) {
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

  const getActivityIcon = (): keyof typeof Ionicons.glyphMap => {
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

  const getActivityColor = (): string => {
    if (item.activity_type === 'country_visited') {
      return colors.adobeBrick;
    }
    switch (item.entry?.entry_type) {
      case 'food':
        return colors.sunsetGold;
      case 'place':
        return colors.primary;
      case 'stay':
        return '#5856D6';
      case 'experience':
        return colors.mossGreen;
      default:
        return colors.stormGray;
    }
  };

  const getActivityText = (): string => {
    if (item.activity_type === 'country_visited' && item.country) {
      return `planted a flag in ${item.country.country_name}`;
    }
    if (item.entry) {
      const typeLabel =
        {
          food: 'discovered',
          place: 'explored',
          stay: 'stayed at',
          experience: 'experienced',
        }[item.entry.entry_type] || 'added';
      return `${typeLabel} ${item.entry.entry_name}`;
    }
    return 'did something';
  };

  const activityColor = getActivityColor();

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.header} onPress={handleUserPress} activeOpacity={0.7}>
        <UserAvatar avatarUrl={item.user.avatar_url} username={item.user.username} size={44} />
        <View style={styles.headerText}>
          <Text style={styles.username}>@{item.user.username}</Text>
          <View style={styles.timestampRow}>
            <Ionicons name="time-outline" size={12} color={colors.stormGray} />
            <Text style={styles.timestamp}>{formatTimeAgo(item.created_at)}</Text>
          </View>
        </View>
      </TouchableOpacity>

      <TouchableOpacity style={styles.content} onPress={handleContentPress} activeOpacity={0.7}>
        <View style={styles.activityRow}>
          <View style={[styles.iconContainer, { backgroundColor: `${activityColor}15` }]}>
            <Ionicons name={getActivityIcon()} size={18} color={activityColor} />
          </View>
          <Text style={styles.activityText}>{getActivityText()}</Text>
        </View>

        {item.entry?.image_url && (
          <View style={styles.imageContainer}>
            <Image
              source={{ uri: item.entry.image_url }}
              style={styles.entryImage}
              resizeMode="cover"
            />
            <View style={styles.imageOverlay} />
          </View>
        )}

        {item.entry?.location_name && (
          <View style={styles.locationRow}>
            <View style={styles.locationIconWrap}>
              <Ionicons name="navigate" size={12} color={colors.dustyCoral} />
            </View>
            <Text style={styles.locationText}>{item.entry.location_name}</Text>
          </View>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.cloudWhite,
    borderRadius: 16,
    marginHorizontal: 16,
    marginBottom: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.paperBeige,
    shadowColor: colors.midnightNavy,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.paperBeige,
  },
  headerText: {
    marginLeft: 12,
    flex: 1,
  },
  username: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 15,
    color: colors.midnightNavy,
  },
  timestampRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  timestamp: {
    fontFamily: fonts.openSans.regular,
    fontSize: 12,
    color: colors.stormGray,
  },
  content: {
    padding: 14,
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  activityText: {
    fontFamily: fonts.openSans.regular,
    fontSize: 15,
    color: colors.midnightNavy,
    flex: 1,
    lineHeight: 22,
  },
  imageContainer: {
    marginTop: 14,
    borderRadius: 12,
    overflow: 'hidden',
  },
  entryImage: {
    width: '100%',
    height: 180,
  },
  imageOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.05)',
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    gap: 6,
  },
  locationIconWrap: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.paperBeige,
    justifyContent: 'center',
    alignItems: 'center',
  },
  locationText: {
    fontFamily: fonts.openSans.regular,
    fontSize: 13,
    color: colors.stormGray,
    flex: 1,
  },
});
