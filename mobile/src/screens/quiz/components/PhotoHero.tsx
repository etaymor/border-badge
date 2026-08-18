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

/**
 * The bottom-fade scrim, shared with surfaces that draw the same fade inline.
 * The stops trace an ease-in curve into SOLID navy - a two-stop linear ramp
 * read as a hard band across the photo, and the type below needs a fully
 * opaque ground anyway.
 */
type GradientColors = [string, string, ...string[]];
type GradientLocations = [number, number, ...number[]];

export const BOTTOM_SCRIM_COLORS = [0, 0.04, 0.14, 0.32, 0.58, 0.85, 1].map((alpha) =>
  withAlpha(colors.midnightNavy, alpha)
) as GradientColors;
export const BOTTOM_SCRIM_LOCATIONS: GradientLocations = [0, 0.18, 0.34, 0.5, 0.65, 0.8, 1];

const SCRIM_COLORS: Record<'bottom' | 'full', GradientColors> = {
  bottom: BOTTOM_SCRIM_COLORS,
  full: [withAlpha(colors.midnightNavy, 0.45), withAlpha(colors.midnightNavy, 0.75)],
};

const SCRIM_LOCATIONS: Record<'bottom' | 'full', GradientLocations> = {
  bottom: BOTTOM_SCRIM_LOCATIONS.map((location) => 0.3 + location * 0.7) as GradientLocations,
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
