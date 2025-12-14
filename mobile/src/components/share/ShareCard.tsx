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

// Card dimensions: Fixed 9:16 aspect ratio (standard width 375 for logical resolution)
// This ensures consistent export size regardless of device screen size
const CARD_WIDTH = 375;
const CARD_HEIGHT = (CARD_WIDTH * 16) / 9; // ~666.67

// Stamp size for photo mode (bottom left corner)
const STAMP_SIZE_PHOTO_MODE = CARD_WIDTH * 0.35;

interface ShareCardProps {
  context: MilestoneContext;
  backgroundImage?: string; // URI from image picker
}

/**
 * Default mode: Full-bleed illustration with bold typography
 */
function DefaultModeContent({ context }: { context: MilestoneContext }) {
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
                <Ionicons name={milestone.icon} size={20} color={colors.white} />
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

      {/* Watermark - TODO: Replace with logo asset when available */}
      <Text style={styles.watermark}>Border Badge</Text>
    </>
  );
}

/**
 * Photo mode: User's photo with stamp in corner
 */
function PhotoModeContent({
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
              <Ionicons name={milestone.icon} size={18} color={colors.white} />
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

      {/* Watermark - TODO: Replace with logo asset when available */}
      <Text style={styles.watermarkPhotoMode}>Border Badge</Text>
    </>
  );
}

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
    borderRadius: 24,
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
    top: 32,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 20, // Prevent text clipping
    paddingBottom: 12,
  },
  countryNameBold: {
    fontFamily: fonts.oswald.bold,
    fontSize: 42,
    lineHeight: 60, // Increased line height to prevent ascender clipping
    color: colors.midnightNavy,
    textAlign: 'center',
    letterSpacing: 0.5, // Reduced from 3
    textShadowColor: 'rgba(255, 255, 255, 0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },

  // Number badge in bottom-left corner
  numberContainer: {
    position: 'absolute',
    bottom: 48,
    left: 32,
  },
  numberGlass: {
    backgroundColor: withAlpha(colors.white, 0.85),
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 10, // Increased for better optical balance
    borderWidth: 1,
    borderColor: withAlpha(colors.midnightNavy, 0.1),
    minWidth: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bigNumber: {
    fontFamily: fonts.oswald.bold,
    fontSize: 28,
    lineHeight: 34,
    color: colors.midnightNavy,
    textAlign: 'center',
  },

  // Milestone celebration - below country name
  milestoneContainer: {
    marginTop: 12,
    alignItems: 'center',
    gap: 8,
  },
  milestoneTag: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 30,
    gap: 10,
    // Glow effect
    shadowColor: colors.sunsetGold,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 8,
  },
  milestoneText: {
    fontFamily: fonts.oswald.medium,
    fontSize: 18,
    color: colors.white,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },

  // Watermark
  watermark: {
    position: 'absolute',
    bottom: 16,
    right: 20,
    fontFamily: fonts.openSans.regular,
    fontSize: 12,
    color: colors.warmCream,
    opacity: 0.6,
  },

  // ============ PHOTO MODE STYLES ============

  // Milestone at top
  photoModeMilestoneContainer: {
    position: 'absolute',
    top: '18%',
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: 8,
  },
  photoModeMilestoneTag: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 24,
    gap: 8,
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  photoModeMilestoneText: {
    fontFamily: fonts.oswald.medium,
    fontSize: 16,
    color: colors.white,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  // Stamp in corner
  stampCornerContainer: {
    position: 'absolute',
    bottom: 24,
    left: 20,
  },
  stampWrapper: {
    position: 'relative',
    width: STAMP_SIZE_PHOTO_MODE,
    height: STAMP_SIZE_PHOTO_MODE,
    // Shadow for stamp
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 12,
  },
  stampCornerImage: {
    width: '100%',
    height: '100%',
  },
  stampNumberBadge: {
    position: 'absolute',
    bottom: -8,
    right: -8,
    backgroundColor: colors.sunsetGold,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    // Badge shadow
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  stampNumberText: {
    fontFamily: fonts.oswald.bold,
    fontSize: 18,
    color: colors.midnightNavy,
  },

  // Photo mode watermark
  watermarkPhotoMode: {
    position: 'absolute',
    bottom: 16,
    right: 20,
    fontFamily: fonts.openSans.semiBold,
    fontSize: 14,
    color: colors.white,
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
});
