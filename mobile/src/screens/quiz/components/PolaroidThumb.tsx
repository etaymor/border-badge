/**
 * PolaroidThumb - a photo as a small instant print: white frame, deep bottom
 * lip, alternating tilt. Used for the results recap, the challenge list
 * thumbnails, and the intro. Correctness is spoken by a corner VerdictMark
 * sitting on the bottom lip - never over the photo itself. An unknown
 * verdict (graded server-side, verdict lost locally) keeps a neutral gray
 * dot in the same spot.
 */

import { Image } from 'expo-image';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';

import { VerdictMark } from './VerdictMark';

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
        verdict === 'unknown' ? (
          <View
            style={styles.unknownDot}
            testID={testID ? `${testID}-verdict-unknown` : undefined}
          />
        ) : (
          <VerdictMark
            verdict={verdict}
            size={20}
            style={styles.verdictMark}
            testID={testID ? `${testID}-verdict-${verdict}` : undefined}
          />
        )
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
  // Both marks sit on the bottom lip's right corner, so they never cover the
  // photo content above.
  verdictMark: {
    position: 'absolute',
    bottom: 3,
    right: 4,
  },
  unknownDot: {
    position: 'absolute',
    bottom: 6,
    right: 7,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.stormGray,
    borderWidth: 2,
    borderColor: colors.cloudWhite,
  },
});
