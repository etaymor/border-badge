/**
 * PolaroidThumb - a photo as a small instant print: white frame, deep bottom
 * lip, alternating tilt. Used for the results breakdown, the challenge list
 * thumbnails, and the intro. The verdict dot (moss / brick / gray) is the
 * only correctness language - color-coded, no iconography (per CLAUDE.md the
 * marks stay custom-free until approved artwork exists).
 */

import { Image } from 'expo-image';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';

export type PolaroidVerdict = 'correct' | 'incorrect' | 'unknown';

interface PolaroidThumbProps {
  uri: string;
  /** Drives the alternating tilt so a grid reads as scattered prints. */
  index?: number;
  /** Photo edge length; the frame adds its lip around it. */
  size?: number;
  verdict?: PolaroidVerdict | null;
  /** Handwritten-style caption on the bottom lip (e.g. the country). */
  caption?: string;
  style?: ViewStyle;
  testID?: string;
}

const TILTS = ['-2.5deg', '2deg', '-1.5deg', '2.5deg'];

const VERDICT_COLORS: Record<PolaroidVerdict, string> = {
  correct: colors.mossGreen,
  incorrect: colors.adobeBrick,
  unknown: colors.stormGray,
};

export function PolaroidThumb({
  uri,
  index = 0,
  size = 96,
  verdict,
  caption,
  style,
  testID,
}: PolaroidThumbProps) {
  const tilt = TILTS[index % TILTS.length];
  return (
    <View style={[styles.frame, { transform: [{ rotate: tilt }] }, style]} testID={testID}>
      <Image
        source={{ uri }}
        style={{ width: size, height: size }}
        contentFit="cover"
        transition={150}
      />
      <View style={[styles.lip, { width: size }]}>
        {caption ? (
          <Text style={styles.caption} numberOfLines={1}>
            {caption}
          </Text>
        ) : null}
      </View>
      {verdict ? (
        <View
          style={[styles.verdictDot, { backgroundColor: VERDICT_COLORS[verdict] }]}
          testID={testID ? `${testID}-verdict-${verdict}` : undefined}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    backgroundColor: colors.cloudWhite,
    padding: 6,
    paddingBottom: 0,
    borderRadius: 4,
    shadowColor: colors.midnightNavy,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 4,
  },
  lip: {
    height: 26,
    justifyContent: 'center',
    alignItems: 'center',
  },
  caption: {
    fontFamily: fonts.dawning.regular,
    fontSize: 14,
    color: colors.midnightNavy,
    paddingHorizontal: 2,
  },
  verdictDot: {
    position: 'absolute',
    top: -5,
    right: -5,
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colors.cloudWhite,
  },
});
