import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import React, { memo, useCallback } from 'react';
import { Animated, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { getCountryImage } from '../../assets/countryImages';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { useAnimatedPress, AnimatedPressPresets } from '@hooks/useAnimatedPress';
import type { FeedItem } from '@hooks/useSocialHome';

import { getFeedItemConfig, feedKeyExtractor } from './feedItemConfig';
import { UserAvatar } from './UserAvatar';

interface FeedCardProps {
  item: FeedItem;
  onUserPress?: (userId: string, username: string) => void;
  onCountryPress?: (countryCode: string, countryName: string) => void;
  onEntryPress?: (entryId: string) => void;
}

function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function FeedCardComponent({ item, onUserPress, onCountryPress, onEntryPress }: FeedCardProps) {
  const { scaleValue, pressHandlers } = useAnimatedPress(AnimatedPressPresets.subtle);

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

  // Wire-compat rule: unknown activity types render nothing (default-skip).
  const config = getFeedItemConfig(item);
  if (!config) {
    return null;
  }

  const activityColor = config.getColor(item);
  const activityIcon = config.getIcon(item);
  const badgeLabel = config.getBadgeLabel(item);
  const verb = config.getVerb(item);
  const highlight = config.getHighlight(item);
  const suffix = config.getSuffix?.(item) ?? null;
  const isCountryIllustration = item.activity_type === 'country_visited' && !!item.country;

  // Determine main image source
  const mainImageSource = isCountryIllustration
    ? getCountryImage(item.country!.country_code)
    : item.entry?.image_url
      ? { uri: item.entry.image_url }
      : null;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable style={styles.userInfo} onPress={handleUserPress}>
          <UserAvatar avatarUrl={item.user.avatar_url} username={item.user.username} size={36} />
          <View style={styles.headerTexts}>
            <Text style={styles.headerUsername}>{item.user.username}</Text>
            <Text style={styles.timestamp}>{formatTimeAgo(item.created_at)}</Text>
          </View>
        </Pressable>
      </View>

      {/* Main Content Media */}
      <Animated.View style={{ transform: [{ scale: scaleValue }] }}>
        <TouchableOpacity
          activeOpacity={0.9}
          onPress={handleContentPress}
          style={styles.mediaContainer}
          {...pressHandlers}
        >
          {mainImageSource ? (
            <View style={styles.imageWrapper}>
              <Image
                source={mainImageSource}
                recyclingKey={feedKeyExtractor(item)}
                cachePolicy="memory-disk"
                transition={150}
                contentFit="cover"
                style={[styles.mainImage, isCountryIllustration && styles.countryIllustration]}
              />
            </View>
          ) : (
            <View style={[styles.placeholderMedia, { backgroundColor: `${activityColor}10` }]}>
              <Ionicons name={activityIcon} size={48} color={activityColor} />
            </View>
          )}

          {/* Activity Type Badge - Overlay on Image */}
          <View style={[styles.activityBadgeOverlay, { backgroundColor: colors.cloudWhite }]}>
            <Ionicons name={activityIcon} size={12} color={activityColor} />
            <Text style={[styles.activityBadgeText, { color: activityColor }]}>{badgeLabel}</Text>
          </View>
        </TouchableOpacity>
      </Animated.View>

      {/* Caption & Details */}
      <View style={styles.content}>
        <View style={styles.captionContainer}>
          <Text style={styles.captionText}>
            <Text style={styles.usernameText}>{item.user.username}</Text>
            <Text style={styles.actionText}> {verb}</Text>
            {highlight ? <Text style={styles.highlightText}> {highlight}</Text> : null}
            {suffix ? <Text> {suffix}</Text> : null}
          </Text>
          {item.entry?.location_name ? (
            <View style={styles.locationTag}>
              <Ionicons name="location-sharp" size={12} color={colors.stormGray} />
              <Text style={styles.locationTagText} numberOfLines={1}>
                {item.entry.location_name}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

export const FeedCard = memo(FeedCardComponent);
FeedCard.displayName = 'FeedCard';

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.cloudWhite,
    marginBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: colors.paperBeige,
    paddingBottom: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerTexts: {
    justifyContent: 'center',
    gap: 2,
  },
  headerUsername: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 14,
    color: colors.midnightNavy,
  },
  timestamp: {
    fontFamily: fonts.openSans.regular,
    fontSize: 11,
    color: colors.stormGray,
  },
  mediaContainer: {
    width: '100%',
    aspectRatio: 4 / 3,
    backgroundColor: colors.paperBeige,
    overflow: 'hidden',
    position: 'relative',
    marginBottom: 12,
  },
  imageWrapper: {
    width: '100%',
    height: '100%',
    overflow: 'hidden',
  },
  mainImage: {
    width: '100%',
    height: '100%',
  },
  countryIllustration: {
    // To show the bottom part and crop the top:
    // We scale the image up slightly and position it to align the bottom
    height: '120%',
    width: '100%',
    position: 'absolute',
    bottom: 0,
  },
  placeholderMedia: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: 250,
  },
  activityBadgeOverlay: {
    position: 'absolute',
    top: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    gap: 4,
    shadowColor: colors.midnightNavy,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  activityBadgeText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 11,
    textTransform: 'capitalize',
  },
  content: {
    paddingHorizontal: 16,
  },
  captionContainer: {},
  captionText: {
    fontFamily: fonts.openSans.regular,
    fontSize: 15, // Slightly larger for readability
    color: colors.midnightNavy,
    lineHeight: 22,
  },
  usernameText: {
    fontFamily: fonts.openSans.semiBold,
  },
  actionText: {
    color: colors.midnightNavy,
  },
  highlightText: {
    fontFamily: fonts.playfair.bold,
    color: colors.midnightNavy,
  },
  locationTag: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    gap: 4,
  },
  locationTagText: {
    fontFamily: fonts.openSans.regular,
    fontSize: 12,
    color: colors.stormGray,
  },
});
