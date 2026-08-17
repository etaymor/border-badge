/**
 * PhotoHero - a full-bleed photo region with a midnight-navy scrim so type
 * layered on top stays legible over arbitrary photos. Purely presentational:
 * the photo fills the container, the scrim sits over it (bottom fade by
 * default, or a full wash), and children render above both.
 */

import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import {
  StyleSheet,
  View,
  type ImageSourcePropType,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { colors, withAlpha } from '@constants/colors';

import type { ReactNode } from 'react';

interface PhotoHeroProps {
  /** A remote/local URI string, or a bundled asset source. */
  source: ImageSourcePropType | string;
  /** Scrim shape: a bottom fade for anchored type, or a full wash. */
  scrim?: 'bottom' | 'full';
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** The bottom-fade scrim pair, shared with surfaces that draw the same fade inline. */
export const BOTTOM_SCRIM_COLORS: [string, string] = [
  withAlpha(colors.midnightNavy, 0),
  withAlpha(colors.midnightNavy, 0.9),
];

const SCRIM_COLORS: Record<'bottom' | 'full', [string, string]> = {
  bottom: BOTTOM_SCRIM_COLORS,
  full: [withAlpha(colors.midnightNavy, 0.45), withAlpha(colors.midnightNavy, 0.75)],
};

const SCRIM_LOCATIONS: Record<'bottom' | 'full', [number, number]> = {
  bottom: [0.4, 1],
  full: [0, 1],
};

export function PhotoHero({ source, scrim = 'bottom', children, style, testID }: PhotoHeroProps) {
  return (
    <View style={[styles.container, style]} testID={testID}>
      <Image
        source={typeof source === 'string' ? { uri: source } : source}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        cachePolicy="memory-disk"
        transition={150}
      />
      <LinearGradient
        colors={SCRIM_COLORS[scrim]}
        locations={SCRIM_LOCATIONS[scrim]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      {children ? <View style={styles.content}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    backgroundColor: colors.midnightNavy,
  },
  content: {
    ...StyleSheet.absoluteFillObject,
  },
});
