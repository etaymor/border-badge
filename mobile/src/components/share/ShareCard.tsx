/**
 * Epic 9:16 share card for viral social sharing.
 *
 * Two modes:
 * 1. Default: Full-bleed country illustration with bold typography
 * 2. Photo mode: User's photo with stamp in corner and number badge
 *
 * This component is captured via react-native-view-shot for sharing.
 */

import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { memo, useMemo } from 'react';
import { Image, StyleSheet, View } from 'react-native';

import { Text } from '@components/ui';
import { colors, withAlpha } from '@constants/colors';
import { fonts } from '@constants/typography';
import type { MilestoneContext } from '@utils/milestones';
import { getCountryImage } from '../../assets/countryImages';
import { getStampImage } from '../../assets/stampImages';
import atlasLogo from '../../../assets/atlasi-logo.png';

// Card dimensions: 9:16 aspect ratio optimized for Instagram Stories (1080x1920)
// Using 1080 as base width ensures high-quality exports for social sharing
// The component scales down for display but captures at full resolution
const CARD_WIDTH = 1080;
const CARD_HEIGHT = (CARD_WIDTH * 16) / 9; // 1920

// Stamp size for photo mode (bottom left corner) - proportional to card width
const STAMP_SIZE_PHOTO_MODE = CARD_WIDTH * 0.35;

// Scale factor for converting from 375px base to 1080px
const SCALE = CARD_WIDTH / 375;

// Scaled icon sizes for Ionicons
const ICON_SIZE_DEFAULT = Math.round(20 * SCALE);
const ICON_SIZE_PHOTO_MODE = Math.round(18 * SCALE);

interface ShareCardProps {
  context: MilestoneContext;
  backgroundImage?: string; // URI from image picker
}

/**
 * Default mode: Full-bleed illustration with bold typography
 */
const DefaultModeContent = memo(function DefaultModeContent({
  context,
}: {
  context: MilestoneContext;
}) {
  const countryImage = useMemo(() => getCountryImage(context.countryCode), [context.countryCode]);
  const hasMilestones = context.milestones.length > 0;

  return (
    <>
      {/* Full-bleed country illustration */}
      {countryImage && (
        <Image source={countryImage} style={styles.fullBleedImage} resizeMode="cover" />
      )}

      {/* Light overlay only at top for text legibility */}
      <LinearGradient
        colors={['rgba(255, 255, 255, 0.7)', 'rgba(255, 255, 255, 0.3)', 'transparent']}
        locations={[0, 0.2, 0.35]}
        style={styles.gradientOverlay}
      />

      {/* Country name at top (20% down for Instagram stories) */}
      <View style={styles.topContent}>
        <Text
          style={styles.countryNameBold}
          adjustsFontSizeToFit
          numberOfLines={2}
          minimumFontScale={0.7}
        >
          {context.countryName.toUpperCase()}
        </Text>

        {/* Milestone celebration - centered below country name */}
        {hasMilestones && (
          <View style={styles.milestoneContainer}>
            {context.milestones.map((milestone, index) => (
              <View
                key={`${milestone.type}-${index}`}
                style={[styles.milestoneTag, { backgroundColor: withAlpha(milestone.color, 0.95) }]}
              >
                <Ionicons
                  name={milestone.icon}
                  size={ICON_SIZE_DEFAULT}
                  color={colors.white}
                  style={styles.milestoneIcon}
                />
                <Text style={styles.milestoneText}>{milestone.label}</Text>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* Country number badge */}
      <View style={styles.numberContainer}>
        <View style={styles.numberGlass}>
          <Text style={styles.bigNumber}>#{context.newTotalCount}</Text>
        </View>
      </View>

      {/* Watermark */}
      <Image source={atlasLogo} style={styles.watermark} resizeMode="contain" />
    </>
  );
});

/**
 * Photo mode: User's photo with stamp in corner
 */
const PhotoModeContent = memo(function PhotoModeContent({
  context,
  backgroundImage,
}: {
  context: MilestoneContext;
  backgroundImage: string;
}) {
  const stampImage = useMemo(() => getStampImage(context.countryCode), [context.countryCode]);
  const hasMilestones = context.milestones.length > 0;

  return (
    <>
      {/* User's photo as full background */}
      <Image source={{ uri: backgroundImage }} style={styles.fullBleedImage} resizeMode="cover" />

      {/* Subtle vignette overlay */}
      <LinearGradient
        colors={['transparent', 'transparent', 'rgba(0, 0, 0, 0.4)']}
        locations={[0, 0.5, 1]}
        style={styles.gradientOverlay}
      />

      {/* Milestone at top center */}
      {hasMilestones && (
        <View style={styles.photoModeMilestoneContainer}>
          {context.milestones.slice(0, 2).map((milestone, index) => (
            <View
              key={`${milestone.type}-${index}`}
              style={[
                styles.photoModeMilestoneTag,
                { backgroundColor: withAlpha(milestone.color, 0.95) },
              ]}
            >
              <Ionicons name={milestone.icon} size={ICON_SIZE_PHOTO_MODE} color={colors.white} />
              <Text style={styles.photoModeMilestoneText}>{milestone.label}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Stamp in bottom left corner */}
      <View style={styles.stampCornerContainer}>
        {stampImage && (
          <View style={styles.stampWrapper}>
            <Image source={stampImage} style={styles.stampCornerImage} resizeMode="contain" />
            {/* Country number badge on stamp */}
            <View style={styles.stampNumberBadge}>
              <Text style={styles.stampNumberText}>#{context.newTotalCount}</Text>
            </View>
          </View>
        )}
      </View>

      {/* Watermark */}
      <Image source={atlasLogo} style={styles.watermarkPhotoMode} resizeMode="contain" />
    </>
  );
});

function ShareCardComponent({ context, backgroundImage }: ShareCardProps) {
  return (
    <View style={styles.card}>
      {backgroundImage ? (
        <PhotoModeContent context={context} backgroundImage={backgroundImage} />
      ) : (
        <DefaultModeContent context={context} />
      )}
    </View>
  );
}

export const ShareCard = memo(ShareCardComponent);

// Export dimensions for parent components
export const SHARE_CARD_WIDTH = CARD_WIDTH;
export const SHARE_CARD_HEIGHT = CARD_HEIGHT;

const styles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: 24 * SCALE,
    overflow: 'hidden',
    backgroundColor: colors.midnightNavy,
  },

  // Full-bleed image
  fullBleedImage: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
  },

  // Gradient overlay
  gradientOverlay: {
    ...StyleSheet.absoluteFillObject,
  },

  // ============ DEFAULT MODE STYLES ============

  // Country name at top
  topContent: {
    position: 'absolute',
    top: 32 * SCALE,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: 20 * SCALE,
    paddingTop: 20 * SCALE,
    paddingBottom: 12 * SCALE,
  },
  countryNameBold: {
    fontFamily: fonts.oswald.bold,
    fontSize: 42 * SCALE,
    lineHeight: 60 * SCALE,
    color: colors.midnightNavy,
    textAlign: 'center',
    letterSpacing: 0.5 * SCALE,
    textShadowColor: 'rgba(255, 255, 255, 0.8)',
    textShadowOffset: { width: 0, height: 1 * SCALE },
    textShadowRadius: 4 * SCALE,
  },

  // Number badge in bottom-left corner
  numberContainer: {
    position: 'absolute',
    bottom: 48 * SCALE,
    left: 32 * SCALE,
  },
  numberGlass: {
    backgroundColor: withAlpha(colors.white, 0.85),
    borderRadius: 16 * SCALE,
    paddingHorizontal: 16 * SCALE,
    paddingVertical: 10 * SCALE,
    borderWidth: 1 * SCALE,
    borderColor: withAlpha(colors.midnightNavy, 0.1),
    minWidth: 60 * SCALE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bigNumber: {
    fontFamily: fonts.oswald.bold,
    fontSize: 28 * SCALE,
    lineHeight: 34 * SCALE,
    color: colors.midnightNavy,
    textAlign: 'center',
  },

  // Milestone celebration - below country name
  milestoneContainer: {
    marginTop: 16 * SCALE,
    alignItems: 'center',
    gap: 8 * SCALE,
    width: '100%',
  },
  milestoneTag: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 52 * SCALE,
    paddingHorizontal: 24 * SCALE,
    borderRadius: 26 * SCALE,
    // Glow effect
    shadowColor: colors.sunsetGold,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 12 * SCALE,
    elevation: 8,
  },
  milestoneIcon: {
    marginRight: 10 * SCALE,
  },
  milestoneText: {
    fontFamily: fonts.oswald.medium,
    fontSize: 18 * SCALE,
    lineHeight: 24 * SCALE,
    color: colors.white,
    textTransform: 'uppercase',
    letterSpacing: 1 * SCALE,
    includeFontPadding: false,
  },

  // Watermark - aligned with number badge vertically
  watermark: {
    position: 'absolute',
    bottom: 48 * SCALE,
    right: 32 * SCALE,
    width: 120 * SCALE,
    height: 36 * SCALE,
    opacity: 0.8,
  },

  // ============ PHOTO MODE STYLES ============

  // Milestone at top
  photoModeMilestoneContainer: {
    position: 'absolute',
    top: '18%',
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: 8 * SCALE,
  },
  photoModeMilestoneTag: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8 * SCALE,
    paddingHorizontal: 16 * SCALE,
    borderRadius: 24 * SCALE,
    gap: 8 * SCALE,
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 4 * SCALE },
    shadowOpacity: 0.3,
    shadowRadius: 8 * SCALE,
    elevation: 6,
  },
  photoModeMilestoneText: {
    fontFamily: fonts.oswald.medium,
    fontSize: 16 * SCALE,
    color: colors.white,
    textTransform: 'uppercase',
    letterSpacing: 0.5 * SCALE,
  },

  // Stamp in corner
  stampCornerContainer: {
    position: 'absolute',
    bottom: 24 * SCALE,
    left: 20 * SCALE,
  },
  stampWrapper: {
    position: 'relative',
    width: STAMP_SIZE_PHOTO_MODE,
    height: STAMP_SIZE_PHOTO_MODE,
    // Shadow for stamp
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 8 * SCALE },
    shadowOpacity: 0.4,
    shadowRadius: 16 * SCALE,
    elevation: 12,
  },
  stampCornerImage: {
    width: '100%',
    height: '100%',
  },
  stampNumberBadge: {
    position: 'absolute',
    bottom: -8 * SCALE,
    right: -8 * SCALE,
    backgroundColor: colors.sunsetGold,
    borderRadius: 20 * SCALE,
    paddingHorizontal: 12 * SCALE,
    paddingVertical: 6 * SCALE,
    // Badge shadow
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 2 * SCALE },
    shadowOpacity: 0.3,
    shadowRadius: 4 * SCALE,
    elevation: 4,
  },
  stampNumberText: {
    fontFamily: fonts.oswald.bold,
    fontSize: 18 * SCALE,
    color: colors.midnightNavy,
  },

  // Photo mode watermark - aligned with stamp vertically
  watermarkPhotoMode: {
    position: 'absolute',
    bottom: 32 * SCALE,
    right: 24 * SCALE,
    width: 120 * SCALE,
    height: 36 * SCALE,
    opacity: 0.9,
    tintColor: colors.white,
  },
});
