import { memo } from 'react';
import { Animated, Image, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';

interface CountryHeroProps {
  displayName: string;
  subregion: string;
  flagEmoji: string;
  countryImage: ReturnType<typeof require> | null;
  heroHeight: number;
  insetTop: number;
  imageScale: Animated.AnimatedInterpolation<number>;
  imageTranslateY: Animated.AnimatedInterpolation<number>;
  titleScale: Animated.AnimatedInterpolation<number>;
  titleOpacity: Animated.AnimatedInterpolation<number>;
}

function CountryHeroComponent({
  displayName,
  subregion,
  flagEmoji,
  countryImage,
  heroHeight,
  insetTop,
  imageScale,
  imageTranslateY,
  titleScale,
  titleOpacity,
}: CountryHeroProps) {
  return (
    <Animated.View
      style={[
        styles.heroBackground,
        {
          height: heroHeight,
          transform: [{ scale: imageScale }, { translateY: imageTranslateY }],
        },
      ]}
    >
      {countryImage ? (
        <Image source={countryImage} style={styles.heroImage} resizeMode="cover" />
      ) : (
        <View style={[styles.heroImage, { backgroundColor: colors.mossGreen }]} />
      )}

      {/* Bottom gradient for sheet transition */}
      <LinearGradient
        colors={['transparent', 'rgba(255, 248, 240, 0.4)', colors.warmCream]}
        locations={[0.6, 0.8, 1]}
        style={styles.heroGradient}
      />

      {/* Title Content - Top Overlay */}
      <Animated.View
        style={[
          styles.heroContent,
          {
            paddingTop: insetTop + 12,
            opacity: titleOpacity,
            transform: [{ scale: titleScale }],
          },
        ]}
      >
        <Text style={styles.countryTitle} numberOfLines={2} adjustsFontSizeToFit>
          {displayName}
        </Text>
        <View style={styles.subregionContainer}>
          <Text style={styles.subregionTextHero}>{subregion}</Text>
          <Text style={styles.flagEmoji}>{flagEmoji}</Text>
        </View>
      </Animated.View>
    </Animated.View>
  );
}

export default memo(CountryHeroComponent);

const styles = StyleSheet.create({
  heroBackground: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 0,
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  heroGradient: {
    ...StyleSheet.absoluteFillObject,
  },
  heroContent: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingHorizontal: 20,
  },
  countryTitle: {
    fontFamily: fonts.oswald.bold,
    fontSize: 56,
    lineHeight: 64,
    color: colors.midnightNavy,
    textAlign: 'center',
    textTransform: 'uppercase',
    textShadowColor: 'rgba(255, 255, 255, 0.6)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
    marginBottom: -8,
  },
  subregionContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  subregionTextHero: {
    fontFamily: fonts.dawning.regular,
    fontSize: 32,
    color: colors.midnightNavy,
    textShadowColor: 'rgba(255, 255, 255, 0.6)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  flagEmoji: {
    fontSize: 28,
    textShadowColor: 'rgba(255, 255, 255, 0.3)',
    textShadowOffset: { width: 0, height: 4 },
    textShadowRadius: 8,
  },
});
