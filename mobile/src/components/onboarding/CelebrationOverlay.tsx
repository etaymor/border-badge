import { BlurView } from 'expo-blur';
import { useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  Easing,
  Image,
  StyleSheet,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';

import { getCountryImage } from '../../assets/countryImages';
import { getStampImage } from '../../assets/stampImages';

import { Text } from '@components/ui';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import type { CelebrationAnimationRefs } from '@hooks/useCountrySelectionAnimations';

export interface CelebrationOverlayProps {
  visible: boolean;
  countryCode: string;
  countryName: string;
  type: 'home' | 'dream';
  animationRefs: CelebrationAnimationRefs;
  onSkip?: () => void;
}

// Pre-calculate particle properties once at module load to avoid recalculating on every render
const BURST_PARTICLES = Array.from({ length: 24 }).map((_, i) => {
  const angle = (i / 24) * 2 * Math.PI;
  const radius = 350 + Math.random() * 100;
  const duration = 2500 + Math.random() * 1000;
  const color = i % 3 === 0 ? colors.sunsetGold : i % 3 === 1 ? colors.lakeBlue : colors.dustyCoral;
  return {
    index: i,
    angle,
    radius,
    duration,
    color,
    targetX: Math.cos(angle) * radius,
    targetY: Math.sin(angle) * radius,
  };
});

function BurstAnimation({ visible }: { visible: boolean }) {
  const anims = useRef(BURST_PARTICLES.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    if (visible) {
      const animations = BURST_PARTICLES.map((particle, i) => {
        anims[i].setValue(0);
        return Animated.timing(anims[i], {
          toValue: 1,
          duration: particle.duration,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        });
      });

      Animated.stagger(20, animations).start();
    } else {
      anims.forEach((anim) => anim.setValue(0));
    }
  }, [visible, anims]);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {BURST_PARTICLES.map((particle, i) => {
        const translateX = anims[i].interpolate({
          inputRange: [0, 1],
          outputRange: [0, particle.targetX],
        });

        const translateY = anims[i].interpolate({
          inputRange: [0, 1],
          outputRange: [0, particle.targetY],
        });

        const scale = anims[i].interpolate({
          inputRange: [0, 0.1, 0.8, 1],
          outputRange: [0, 1.8, 1.2, 0],
        });

        const opacity = anims[i].interpolate({
          inputRange: [0, 0.1, 0.8, 1],
          outputRange: [0, 1, 0.8, 0],
        });

        return (
          <Animated.View
            key={particle.index}
            style={[
              styles.particle,
              { backgroundColor: particle.color, opacity },
              {
                transform: [{ translateX }, { translateY }, { scale }],
              },
            ]}
          />
        );
      })}
    </View>
  );
}

export default function CelebrationOverlay({
  visible,
  countryCode,
  countryName,
  type,
  animationRefs,
  onSkip,
}: CelebrationOverlayProps) {
  const { width } = useWindowDimensions();
  const { selectionScale, selectionOpacity, flagScale, flagRotate } = animationRefs;

  const flagRotateInterpolation = useMemo(
    () =>
      flagRotate.interpolate({
        inputRange: [0, 1],
        outputRange: ['-5deg', '5deg'],
      }),
    [flagRotate]
  );

  const imageSource = useMemo(() => {
    if (type === 'home') {
      return getStampImage(countryCode);
    }
    return getCountryImage(countryCode);
  }, [countryCode, type]);

  if (!visible) return null;

  return (
    <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onSkip}>
      <Animated.View
        style={[
          styles.celebrationOverlay,
          {
            opacity: selectionOpacity,
          },
        ]}
      >
        <BlurView intensity={80} tint="dark" style={StyleSheet.absoluteFill} />

        <Animated.View
          style={[
            styles.celebrationContent,
            {
              transform: [{ scale: selectionScale }],
            },
          ]}
        >
          <BurstAnimation visible={visible} />

          <Animated.View
            style={[
              styles.imageContainer,
              {
                transform: [{ scale: flagScale }, { rotate: flagRotateInterpolation }],
              },
            ]}
          >
            {imageSource ? (
              <Image
                source={imageSource}
                style={[
                  type === 'home' ? styles.stampImage : styles.illustrationImage,
                  { width: width * 0.75 },
                ]}
                resizeMode="contain"
              />
            ) : (
              <View style={styles.fallbackContainer}>
                <Text style={styles.fallbackEmoji}>🌍</Text>
              </View>
            )}
          </Animated.View>

          <View style={styles.textContainer}>
            <Text variant="display" style={styles.titleText}>
              {type === 'home' ? 'Home Sweet Home' : 'Dream Big!'}
            </Text>
            <Text variant="body" style={styles.subtitleText}>
              {countryName} {type === 'home' ? 'is set as your home' : 'added to your list'}
            </Text>
          </View>
        </Animated.View>
      </Animated.View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  celebrationOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 100,
  },
  celebrationContent: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    width: '100%',
  },
  imageContainer: {
    marginBottom: 32,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 8,
  },
  stampImage: {
    height: 240,
    aspectRatio: 1,
  },
  illustrationImage: {
    height: 240,
    aspectRatio: 1.5,
  },
  fallbackContainer: {
    width: 150,
    height: 150,
    backgroundColor: colors.warmCream,
    borderRadius: 75,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fallbackEmoji: {
    fontSize: 64,
  },
  textContainer: {
    alignItems: 'center',
    gap: 8,
  },
  titleText: {
    color: colors.white,
    textAlign: 'center',
    fontSize: 40,
    fontFamily: fonts.playfair.bold,
  },
  subtitleText: {
    color: colors.warmCream,
    textAlign: 'center',
    opacity: 0.9,
    fontSize: 18,
    fontFamily: fonts.openSans.regular,
  },
  particle: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
