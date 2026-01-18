/**
 * Thumbnail card component for ShareCaptureScreen.
 * Displays the video thumbnail, provider badge, title and author.
 */

import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import type { SocialIngestResponse } from '@hooks/useSocialIngest';
import { PROVIDER_COLORS } from './shareCaptureUtils';

interface ThumbnailCardProps {
  ingestResult: SocialIngestResponse;
  caption?: string;
}

export function ThumbnailCard({ ingestResult, caption }: ThumbnailCardProps) {
  const [isCaptionExpanded, setIsCaptionExpanded] = useState(false);

  return (
    <View style={styles.thumbnailCard}>
      {ingestResult.thumbnail_url ? (
        <Image
          source={{ uri: ingestResult.thumbnail_url }}
          style={styles.thumbnail}
          resizeMode="cover"
        />
      ) : (
        <LinearGradient
          colors={[colors.lakeBlue, colors.mossGreen]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.thumbnailPlaceholder}
        >
          <Ionicons name="videocam" size={32} color={colors.white} />
        </LinearGradient>
      )}
      <View style={styles.thumbnailOverlay}>
        <View
          style={[
            styles.providerBadge,
            { backgroundColor: PROVIDER_COLORS[ingestResult.provider] },
          ]}
        >
          <Ionicons
            name={ingestResult.provider === 'tiktok' ? 'musical-notes' : 'camera'}
            size={12}
            color={colors.white}
          />
          <Text style={styles.providerText}>
            {ingestResult.provider === 'tiktok' ? 'TikTok' : 'Instagram'}
          </Text>
        </View>
      </View>
      <View style={styles.thumbnailInfo}>
        {ingestResult.title && (
          <Text style={styles.videoTitle} numberOfLines={2}>
            {ingestResult.title}
          </Text>
        )}
        {ingestResult.author_handle && (
          <Text style={styles.authorHandle}>@{ingestResult.author_handle}</Text>
        )}
        {caption && caption.trim().length > 0 && (
          <View style={styles.captionContainer}>
            <Text style={styles.captionText} numberOfLines={isCaptionExpanded ? undefined : 2}>
              {caption}
            </Text>
            <Pressable
              onPress={() => setIsCaptionExpanded(!isCaptionExpanded)}
              style={styles.captionToggle}
              hitSlop={8}
            >
              <Text style={styles.captionToggleText}>
                {isCaptionExpanded ? 'Show less' : 'Show more'}
              </Text>
              <Ionicons
                name={isCaptionExpanded ? 'chevron-up' : 'chevron-down'}
                size={12}
                color={colors.sunsetGold}
              />
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}

interface ManualEntryBannerProps {
  visible: boolean;
}

export function ManualEntryBanner({ visible }: ManualEntryBannerProps) {
  if (!visible) return null;

  return (
    <View style={styles.manualEntryBanner}>
      <Ionicons name="search-outline" size={16} color={colors.sunsetGold} />
      <Text style={styles.manualEntryText}>
        Search for the place below to save it to your trip.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  thumbnailCard: {
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: colors.paperBeige,
    marginBottom: 16,
    shadowColor: colors.midnightNavy,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 4,
  },
  thumbnail: {
    width: '100%',
    aspectRatio: 16 / 9,
  },
  thumbnailPlaceholder: {
    width: '100%',
    aspectRatio: 16 / 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbnailOverlay: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    flexDirection: 'row',
  },
  providerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    gap: 4,
  },
  providerText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 11,
    color: colors.white,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  thumbnailInfo: {
    padding: 16,
  },
  videoTitle: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 15,
    color: colors.midnightNavy,
    lineHeight: 22,
    marginBottom: 4,
  },
  authorHandle: {
    fontFamily: fonts.openSans.regular,
    fontSize: 13,
    color: colors.stormGray,
  },
  captionContainer: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.midnightNavyBorder,
  },
  captionText: {
    fontFamily: fonts.openSans.regular,
    fontSize: 13,
    color: colors.stormGray,
    lineHeight: 18,
  },
  captionToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 8,
  },
  captionToggleText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 12,
    color: colors.sunsetGold,
  },
  manualEntryBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(218, 165, 32, 0.1)',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    marginBottom: 20,
    gap: 8,
  },
  manualEntryText: {
    fontFamily: fonts.openSans.regular,
    fontSize: 13,
    color: colors.midnightNavy,
    flex: 1,
  },
});
