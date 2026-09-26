import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { colors, withAlpha } from '@constants/colors';
import { fonts } from '@constants/typography';

import { ATLASI_APP_ICON } from './introBeatAssets';
import { SHARE_MOTION, easeInCubic, easeOutCubic, segmentAt } from './introMotion';

const PLAIN = withAlpha(colors.stormGray, 0.22);
const TARGETS = [
  { key: 'atlasi', label: 'Atlasi', color: colors.transparent },
  { key: 'copy', label: 'Copy link', color: PLAIN },
  { key: 'save', label: 'Save', color: PLAIN },
  { key: 'more', label: 'More', color: PLAIN },
] as const;

interface ShareSheetMockProps {
  clock: SharedValue<number>;
  width: number;
  height: number;
}

/**
 * A drawn system share sheet that slides up over the post, gets the Atlasi
 * app icon tapped, and drops away. The other targets are plain tiles.
 */
export default function ShareSheetMock({ clock, width, height }: ShareSheetMockProps) {
  const tileSize = Math.max(20, Math.min(34, (width - 24) / TARGETS.length - 10));

  const sheetStyle = useAnimatedStyle(() => {
    const t = clock.value;
    const up = easeOutCubic(segmentAt(t, SHARE_MOTION.sheetUp[0], SHARE_MOTION.sheetUp[1]));
    const down = easeInCubic(segmentAt(t, SHARE_MOTION.sheetDown[0], SHARE_MOTION.sheetDown[1]));
    // Hidden below the card before it rises and after it drops (and when still).
    return { transform: [{ translateY: height * (1 - up + down) }] };
  });

  const atlasiStyle = useAnimatedStyle(() => {
    const p = segmentAt(clock.value, SHARE_MOTION.atlasiTap[0], SHARE_MOTION.atlasiTap[1]);
    return { transform: [{ scale: 1 - 0.1 * Math.sin(Math.PI * p) }] };
  });

  const atlasiRingStyle = useAnimatedStyle(() => {
    const p = segmentAt(clock.value, SHARE_MOTION.atlasiTap[0], SHARE_MOTION.atlasiTap[1] + 150);
    return { opacity: p > 0 && p < 1 ? 1 - p : 0, transform: [{ scale: 1 + 0.35 * p }] };
  });

  return (
    <Animated.View style={[styles.sheet, { height }, sheetStyle]} testID="intro-share-sheet">
      <View style={styles.grabber} />
      <Text style={styles.title}>Share to</Text>
      <View style={styles.row}>
        {TARGETS.map((target) => {
          const isAtlasi = target.key === 'atlasi';
          const tile = (
            <View
              style={[
                styles.tile,
                {
                  width: tileSize,
                  height: tileSize,
                  borderRadius: tileSize * 0.26,
                  backgroundColor: target.color,
                },
              ]}
            >
              {isAtlasi ? (
                <Image
                  source={ATLASI_APP_ICON}
                  style={styles.appIcon}
                  contentFit="cover"
                  cachePolicy="none"
                />
              ) : null}
            </View>
          );
          return (
            <View key={target.key} style={styles.target}>
              {isAtlasi ? (
                <View>
                  <Animated.View style={atlasiStyle}>{tile}</Animated.View>
                  <Animated.View
                    style={[styles.tapRing, { borderRadius: tileSize * 0.3 + 4 }, atlasiRingStyle]}
                  />
                </View>
              ) : (
                tile
              )}
              <Text style={styles.label} numberOfLines={1}>
                {target.label}
              </Text>
            </View>
          );
        })}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.warmCream,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 10,
    paddingTop: 6,
    alignItems: 'center',
  },
  grabber: {
    width: 28,
    height: 4,
    borderRadius: 2,
    backgroundColor: withAlpha(colors.stormGray, 0.35),
  },
  title: {
    marginTop: 6,
    fontFamily: fonts.openSans.semiBold,
    fontSize: 10,
    color: colors.stormGray,
  },
  row: {
    marginTop: 8,
    alignSelf: 'stretch',
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  target: {
    alignItems: 'center',
    gap: 4,
  },
  tile: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  appIcon: {
    width: '100%',
    height: '100%',
  },
  tapRing: {
    position: 'absolute',
    top: -4,
    left: -4,
    right: -4,
    bottom: -4,
    borderWidth: 2,
    borderColor: colors.sunsetGold,
  },
  label: {
    fontFamily: fonts.openSans.regular,
    fontSize: 9,
    color: colors.midnightNavy,
  },
});
