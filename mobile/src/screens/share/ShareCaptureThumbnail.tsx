/**
 * Thumbnail card component for ShareCaptureScreen.
 * Displays the video thumbnail, provider badge, title and author.
 */

import { useCallback, useEffect, useState } from 'react';
import { Image, LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import type { SocialIngestResponse } from '@hooks/useSocialIngest';
import { PROVIDER_COLORS } from './shareCaptureUtils';

/** Number of lines to show when title is collapsed */
const COLLAPSED_LINE_COUNT = 2;

interface ThumbnailCardProps {
  ingestResult: SocialIngestResponse;
}

export function ThumbnailCard({ ingestResult }: ThumbnailCardProps) {
  const [isTitleExpanded, setIsTitleExpanded] = useState(false);
  const [isTitleTruncated, setIsTitleTruncated] = useState(false);

  // Heights measured from hidden and visible Text components
  const [fullTextHeight, setFullTextHeight] = useState<number | null>(null);
  const [constrainedTextHeight, setConstrainedTextHeight] = useState<number | null>(null);

  // Reset expand/truncate state when title changes (e.g., navigating between videos)
  useEffect(() => {
    setIsTitleExpanded(false);
    setIsTitleTruncated(false);
    setFullTextHeight(null);
    setConstrainedTextHeight(null);
  }, [ingestResult.title]);

  // Compare measured heights to determine if text is truncated
  // Using height comparison is more reliable cross-platform than line counting
  useEffect(() => {
    if (fullTextHeight !== null && constrainedTextHeight !== null) {
      // Add small tolerance (1px) to handle rounding differences
      const truncated = fullTextHeight > constrainedTextHeight + 1;
      if (truncated !== isTitleTruncated) {
        setIsTitleTruncated(truncated);
      }
    }
  }, [fullTextHeight, constrainedTextHeight, isTitleTruncated]);

  // Measure the full (unconstrained) text height from hidden component
  const handleFullTextLayout = useCallback((event: LayoutChangeEvent) => {
    const height = event.nativeEvent.layout.height;
    setFullTextHeight(height);
  }, []);

  // Measure the constrained text height when collapsed
  const handleConstrainedTextLayout = useCallback(
    (event: LayoutChangeEvent) => {
      // Only measure constrained height when collapsed
      if (!isTitleExpanded) {
        const height = event.nativeEvent.layout.height;
        setConstrainedTextHeight(height);
      }
    },
    [isTitleExpanded]
  );

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
          <View>
            {/* Hidden text to measure full unconstrained height */}
            <Text
              style={[styles.videoTitle, styles.hiddenMeasureText]}
              onLayout={handleFullTextLayout}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              {ingestResult.title}
            </Text>
            {/* Visible text with optional line constraint */}
            <Text
              style={styles.videoTitle}
              numberOfLines={isTitleExpanded ? undefined : COLLAPSED_LINE_COUNT}
              onLayout={handleConstrainedTextLayout}
            >
              {ingestResult.title}
            </Text>
            {(isTitleTruncated || isTitleExpanded) && (
              <Pressable
                onPress={() => setIsTitleExpanded(!isTitleExpanded)}
                style={styles.titleToggle}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={isTitleExpanded ? 'Show less of title' : 'Show more of title'}
                accessibilityHint={
                  isTitleExpanded
                    ? 'Collapses the title to two lines'
                    : 'Expands the title to show full text'
                }
              >
                <Text style={styles.toggleText}>{isTitleExpanded ? 'Show less' : 'Show more'}</Text>
                <Ionicons
                  name={isTitleExpanded ? 'chevron-up' : 'chevron-down'}
                  size={12}
                  color={colors.sunsetGold}
                />
              </Pressable>
            )}
          </View>
        )}
        {ingestResult.author_handle && (
          <Text style={styles.authorHandle}>@{ingestResult.author_handle}</Text>
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
  },
  titleToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
    marginBottom: 4,
  },
  authorHandle: {
    fontFamily: fonts.openSans.regular,
    fontSize: 13,
    color: colors.stormGray,
  },
  toggleText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 12,
    color: colors.sunsetGold,
  },
  hiddenMeasureText: {
    position: 'absolute',
    opacity: 0,
    // Ensure same width constraints as visible text for accurate measurement
    left: 0,
    right: 0,
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
