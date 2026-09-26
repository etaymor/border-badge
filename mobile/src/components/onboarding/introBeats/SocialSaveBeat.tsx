import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, Text, View, type ImageSourcePropType } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

import { colors, withAlpha } from '@constants/colors';
import { fonts } from '@constants/typography';

import {
  ATLASI_APP_ICON,
  INSTAGRAM_LOGO,
  SOCIAL_BACK_POST_PHOTO,
  SOCIAL_POST_PHOTO,
  SOCIAL_POST_PLACE,
  SOCIAL_POST_REGION,
  SOCIAL_SAVED_TRIP,
  TIKTOK_LOGO,
} from './introBeatAssets';
import type { IntroBeatProps } from './introBeats';
import IntroCheck from './IntroCheck';
import IntroPin from './IntroPin';
import { INTRO_BEAT_TIMING, SHARE_MOTION, easeOutCubic, popAt, segmentAt } from './introMotion';
import ShareSheetMock from './ShareSheetMock';
import { useIntroBeatClock } from './useIntroBeatClock';

const PAD = 16;
const RAIL_DOT = 22;
const RAIL_GAP = 14;
const LOGO = 26;
const SAVED_WIDTH = 214;
const SAVED_HEIGHT = 128;
const PIN_SIZE = 16;
const PIN_DROP = 28;

interface PostChromeProps {
  logo: ImageSourcePropType;
  platform: string;
  handle: string;
  /** The back card's left side is hidden under the front card. */
  alignRight?: boolean;
}

/** Top-left platform badge plus the author line, shared by both posts. */
function PostChrome({ logo, platform, handle, alignRight = false }: PostChromeProps) {
  return (
    <View style={[styles.chrome, alignRight && styles.chromeRight]}>
      <Image source={logo} style={styles.logo} contentFit="contain" cachePolicy="none" />
      <View style={alignRight && styles.chromeTextRight}>
        <Text style={styles.platform}>{platform}</Text>
        <Text style={styles.handle}>{handle}</Text>
      </View>
    </View>
  );
}

/**
 * Beat 2: an Instagram post and a TikTok post; the TikTok gets shared, the
 * real Atlasi app icon is picked from the share sheet, and the place is saved
 * to your trip. The logos are the official marks, unmodified.
 */
export default function SocialSaveBeat({
  isActive,
  canPlay,
  reduceMotion,
  width,
  height,
}: IntroBeatProps) {
  const { entrance } = useIntroBeatClock({
    isActive,
    canPlay,
    reduceMotion,
    ...INTRO_BEAT_TIMING.share,
  });

  const cardHeight = Math.max(0, height - PAD * 2);
  const cardWidth = Math.max(0, Math.min((cardHeight * 9) / 16, width * 0.5));
  const sheetHeight = Math.min(cardHeight * 0.4, 112);
  // The TikTok card and the saved card are centred as one group; the Instagram
  // card fans out from behind the TikTok card, inside the frame.
  const savedOverlap = cardWidth * 0.45;
  const savedWidth = Math.min(SAVED_WIDTH, width - PAD * 2 - (cardWidth - savedOverlap));
  const groupWidth = cardWidth - savedOverlap + savedWidth;
  const frontLeft = Math.max(PAD, (width - groupWidth) / 2);
  const savedLeft = frontLeft + cardWidth - savedOverlap;
  const savedTop = PAD + cardHeight - SAVED_HEIGHT - 18;
  const fanDistance = Math.min(cardWidth * 0.32, width - PAD - (frontLeft + cardWidth));
  const shareDot = {
    x: cardWidth - RAIL_DOT - 10,
    y: cardHeight * 0.36 + (RAIL_DOT + RAIL_GAP) * 2,
  };

  const backStyle = useAnimatedStyle(() => {
    const p = easeOutCubic(
      segmentAt(entrance.value, SHARE_MOTION.fanOut[0], SHARE_MOTION.fanOut[1])
    );
    return {
      transform: [
        { translateX: fanDistance * p },
        { translateY: 6 * p },
        { rotate: `${7 * p}deg` },
        { scale: 0.92 },
      ],
    };
  });

  const frontStyle = useAnimatedStyle(() => {
    const p = easeOutCubic(
      segmentAt(entrance.value, SHARE_MOTION.cardIn[0], SHARE_MOTION.cardIn[1])
    );
    return { transform: [{ scale: 0.95 + 0.05 * p }] };
  });

  const shareDotStyle = useAnimatedStyle(() => {
    const p = segmentAt(entrance.value, SHARE_MOTION.shareTap[0], SHARE_MOTION.shareTap[1]);
    return { transform: [{ scale: 1 - 0.12 * Math.sin(Math.PI * p) }] };
  });

  const pressRingStyle = useAnimatedStyle(() => {
    const p = segmentAt(entrance.value, SHARE_MOTION.shareTap[0], SHARE_MOTION.shareTap[1]);
    return {
      opacity: p > 0 && p < 1 ? 0.7 * (1 - p) : 0,
      transform: [{ scale: 0.6 + 0.7 * p }],
    };
  });

  const savedStyle = useAnimatedStyle(() => {
    const t = entrance.value;
    const rise = popAt(t, SHARE_MOTION.savedIn[0], SHARE_MOTION.savedIn[1]);
    const shown = segmentAt(t, SHARE_MOTION.savedIn[0], 160);
    return {
      opacity: shown,
      transform: [{ translateY: 44 * (1 - rise) }, { scale: 0.94 + 0.06 * Math.min(1, rise) }],
    };
  });

  const pinStyle = useAnimatedStyle(() => {
    const t = entrance.value;
    const drop = popAt(t, SHARE_MOTION.pinDrop[0], SHARE_MOTION.pinDrop[1]);
    return {
      opacity: segmentAt(t, SHARE_MOTION.pinDrop[0], 60),
      transform: [{ translateY: -PIN_DROP * (1 - drop) }],
    };
  });

  const savedCheckStyle = useAnimatedStyle(() => {
    const pop = popAt(entrance.value, SHARE_MOTION.savedCheck[0], SHARE_MOTION.savedCheck[1]);
    return { opacity: Math.min(1, pop), transform: [{ scale: 0.4 + 0.6 * pop }] };
  });

  return (
    <View style={StyleSheet.absoluteFill} testID="intro-beat-share">
      {/* Instagram, fanning out from behind */}
      <Animated.View
        style={[
          styles.card,
          { left: frontLeft, top: PAD, width: cardWidth, height: cardHeight },
          backStyle,
        ]}
        testID="intro-share-instagram"
      >
        <Image
          source={SOCIAL_BACK_POST_PHOTO}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          cachePolicy="none"
        />
        <View style={styles.backShade} />
        <PostChrome logo={INSTAGRAM_LOGO} platform="Instagram" handle="@lena.abroad" alignRight />
      </Animated.View>

      {/* TikTok, the one being shared */}
      <Animated.View
        style={[
          styles.card,
          styles.front,
          { left: frontLeft, top: PAD, width: cardWidth, height: cardHeight },
          frontStyle,
        ]}
        testID="intro-share-tiktok"
      >
        <Image
          source={SOCIAL_POST_PHOTO}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          cachePolicy="none"
        />
        <LinearGradient
          colors={[withAlpha(colors.black, 0.45), withAlpha(colors.black, 0)]}
          style={styles.topScrim}
        />
        <LinearGradient
          colors={[withAlpha(colors.black, 0), withAlpha(colors.black, 0.55)]}
          style={styles.bottomScrim}
        />
        <PostChrome logo={TIKTOK_LOGO} platform="TikTok" handle="@wanderlust" />
        {[0, 1].map((slot) => (
          <View
            key={slot}
            style={[
              styles.railDot,
              { left: shareDot.x, top: cardHeight * 0.36 + (RAIL_DOT + RAIL_GAP) * slot },
            ]}
          />
        ))}
        <Animated.View
          style={[
            styles.railDot,
            styles.shareDot,
            { left: shareDot.x, top: shareDot.y },
            shareDotStyle,
          ]}
        >
          <View style={styles.shareArrow} />
        </Animated.View>
        <Animated.View
          style={[styles.pressRing, { left: shareDot.x - 6, top: shareDot.y - 6 }, pressRingStyle]}
        />
        <View style={styles.caption}>
          <Text style={styles.captionTitle} numberOfLines={1}>
            {SOCIAL_POST_PLACE}, {SOCIAL_POST_REGION}
          </Text>
          <Text style={styles.captionMeta} numberOfLines={1}>
            you have to see this village
          </Text>
        </View>
        <ShareSheetMock clock={entrance} width={cardWidth} height={sheetHeight} />
      </Animated.View>

      {/* Saved in Atlasi */}
      <Animated.View
        style={[
          styles.saved,
          { left: savedLeft, top: savedTop, width: savedWidth, height: SAVED_HEIGHT },
          savedStyle,
        ]}
        testID="intro-share-saved"
      >
        <View style={styles.savedHeader}>
          <Image
            source={ATLASI_APP_ICON}
            style={styles.savedIcon}
            contentFit="cover"
            cachePolicy="none"
          />
          <Text style={styles.savedBrand}>Atlasi</Text>
        </View>
        <View style={styles.savedPlace}>
          <View>
            <Image
              source={SOCIAL_POST_PHOTO}
              style={styles.savedThumb}
              contentFit="cover"
              cachePolicy="none"
            />
            <Animated.View style={[styles.savedPin, pinStyle]} testID="intro-share-pin">
              <IntroPin size={PIN_SIZE} />
            </Animated.View>
          </View>
          <View style={styles.savedText}>
            <Text style={styles.savedName} numberOfLines={1}>
              {SOCIAL_POST_PLACE}
            </Text>
            <Text style={styles.savedRegion} numberOfLines={1}>
              {SOCIAL_POST_REGION}
            </Text>
          </View>
        </View>
        <View style={styles.savedFooter}>
          <Animated.View style={[styles.savedCheck, savedCheckStyle]}>
            <IntroCheck size={16} />
          </Animated.View>
          <Text style={styles.savedTo} numberOfLines={1}>
            Saved to {SOCIAL_SAVED_TRIP}
          </Text>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    borderRadius: 18,
    borderCurve: 'continuous',
    overflow: 'hidden',
    backgroundColor: withAlpha(colors.cloudWhite, 0.06),
  },
  front: {
    borderWidth: 1,
    borderColor: withAlpha(colors.cloudWhite, 0.12),
  },
  backShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: withAlpha(colors.midnightNavy, 0.25),
  },
  topScrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: 64,
  },
  bottomScrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '45%',
  },
  chrome: {
    position: 'absolute',
    top: 10,
    left: 10,
    right: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  chromeRight: {
    flexDirection: 'row-reverse',
  },
  chromeTextRight: {
    alignItems: 'flex-end',
  },
  logo: {
    width: LOGO,
    height: LOGO,
    borderRadius: 7,
  },
  platform: {
    fontFamily: fonts.openSans.bold,
    fontSize: 11,
    lineHeight: 14,
    color: colors.white,
  },
  handle: {
    fontFamily: fonts.openSans.regular,
    fontSize: 10,
    lineHeight: 13,
    color: withAlpha(colors.cloudWhite, 0.85),
  },
  railDot: {
    position: 'absolute',
    width: RAIL_DOT,
    height: RAIL_DOT,
    borderRadius: RAIL_DOT / 2,
    backgroundColor: withAlpha(colors.cloudWhite, 0.85),
  },
  shareDot: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The share affordance: a small drawn chevron, not an icon library glyph.
  shareArrow: {
    width: 8,
    height: 8,
    borderTopWidth: 2,
    borderRightWidth: 2,
    borderColor: colors.midnightNavy,
    transform: [{ rotate: '45deg' }, { translateX: -1 }, { translateY: 1 }],
  },
  pressRing: {
    position: 'absolute',
    width: RAIL_DOT + 12,
    height: RAIL_DOT + 12,
    borderRadius: (RAIL_DOT + 12) / 2,
    borderWidth: 2,
    borderColor: colors.sunsetGold,
  },
  caption: {
    position: 'absolute',
    left: 10,
    right: RAIL_DOT + 18,
    bottom: 12,
  },
  captionTitle: {
    fontFamily: fonts.openSans.bold,
    fontSize: 12,
    color: colors.white,
  },
  captionMeta: {
    fontFamily: fonts.openSans.regular,
    fontSize: 11,
    color: withAlpha(colors.cloudWhite, 0.85),
  },
  saved: {
    position: 'absolute',
    borderRadius: 16,
    borderCurve: 'continuous',
    backgroundColor: colors.warmCream,
    padding: 12,
    justifyContent: 'space-between',
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 18,
  },
  savedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  savedIcon: {
    width: 18,
    height: 18,
    borderRadius: 5,
  },
  savedBrand: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 11,
    color: colors.stormGray,
  },
  savedPlace: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  savedThumb: {
    width: 40,
    height: 40,
    borderRadius: 10,
  },
  savedPin: {
    position: 'absolute',
    right: -6,
    top: -10,
  },
  savedText: {
    flex: 1,
  },
  savedName: {
    fontFamily: fonts.playfair.bold,
    fontSize: 17,
    lineHeight: 21,
    color: colors.midnightNavy,
  },
  savedRegion: {
    fontFamily: fonts.openSans.regular,
    fontSize: 12,
    color: colors.stormGray,
  },
  savedFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  savedCheck: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.mossGreen,
  },
  savedTo: {
    flexShrink: 1,
    fontFamily: fonts.openSans.semiBold,
    fontSize: 12,
    color: colors.mossGreen,
  },
});
