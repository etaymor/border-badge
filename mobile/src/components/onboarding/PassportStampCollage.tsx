import * as Haptics from 'expo-haptics';
import React, { useEffect, useMemo } from 'react';
import { Animated, Image, StyleSheet, useWindowDimensions, View } from 'react-native';

import { Text } from '@components/ui';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';

import { getStampImage } from '../../assets/stampImages';

const CONTAINER_PADDING = 24;
const MAX_VISIBLE_STAMPS = 12;

interface StampPosition {
  x: number;
  y: number;
  rotation: number;
  scale: number;
  zIndex: number;
}

function generateOrganicPositions(
  stampCount: number,
  homeCountryIndex: number,
  containerWidth: number
): StampPosition[] {
  const positions: StampPosition[] = [];
  const stampSize = containerWidth / 3.5;
  const effectiveCount = Math.min(stampCount, MAX_VISIBLE_STAMPS);

  // Seed random for consistency
  const seededRandom = (seed: number) => {
    const x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
  };

  if (effectiveCount <= 6) {
    // Organic scatter for small counts - 2x3 style but with variation
    const cols = Math.min(effectiveCount, 3);
    const cellWidth = containerWidth / cols;
    const cellHeight = stampSize * 1.1;

    for (let i = 0; i < effectiveCount; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const isHomeCountry = i === homeCountryIndex;

      // Add jitter to make it organic
      const jitterX = (seededRandom(i * 7) - 0.5) * 20;
      const jitterY = (seededRandom(i * 13) - 0.5) * 15;

      positions.push({
        x: col * cellWidth + cellWidth / 2 - stampSize / 2 + jitterX,
        y: row * cellHeight + jitterY,
        rotation: (seededRandom(i * 17) - 0.5) * 16, // -8 to +8 degrees
        scale: isHomeCountry ? 1.15 : 1.0,
        zIndex: isHomeCountry ? effectiveCount : i,
      });
    }
  } else {
    // Denser organic cluster with overlapping for larger counts
    const cols = 4;
    const cellWidth = containerWidth / cols;
    const cellHeight = stampSize * 0.85; // Overlap more

    for (let i = 0; i < effectiveCount; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const isHomeCountry = i === homeCountryIndex;

      // More jitter for organic feel
      const jitterX = (seededRandom(i * 7) - 0.5) * 25;
      const jitterY = (seededRandom(i * 13) - 0.5) * 20;

      positions.push({
        x: col * cellWidth + cellWidth / 2 - stampSize / 2 + jitterX,
        y: row * cellHeight + jitterY,
        rotation: (seededRandom(i * 17) - 0.5) * 16,
        scale: isHomeCountry ? 1.1 : 0.95,
        zIndex: isHomeCountry ? effectiveCount : Math.floor(seededRandom(i * 23) * effectiveCount),
      });
    }
  }

  return positions;
}

export interface PassportStampCollageProps {
  countryCodes: string[];
  homeCountry: string | null;
  onAnimationComplete?: () => void;
  animated?: boolean;
  animationDelay?: number;
}

export default function PassportStampCollage({
  countryCodes,
  homeCountry,
  onAnimationComplete,
  animated = true,
  animationDelay = 0,
}: PassportStampCollageProps) {
  const { width: screenWidth } = useWindowDimensions();
  const containerWidth = screenWidth - CONTAINER_PADDING * 2;

  const visibleCodes = countryCodes.slice(0, MAX_VISIBLE_STAMPS);
  const extraCount = countryCodes.length - MAX_VISIBLE_STAMPS;
  const homeCountryIndex = homeCountry ? visibleCodes.indexOf(homeCountry) : -1;

  // Sort to put home country first in animation order
  const sortedCodes = useMemo(() => {
    if (homeCountryIndex === -1) return visibleCodes;
    const sorted = [...visibleCodes];
    const [home] = sorted.splice(homeCountryIndex, 1);
    return [home, ...sorted];
  }, [visibleCodes, homeCountryIndex]);

  const positions = useMemo(
    () => generateOrganicPositions(visibleCodes.length, homeCountryIndex, containerWidth - 32),
    [visibleCodes.length, homeCountryIndex, containerWidth]
  );

  // Create animation values - recreate when sortedCodes length changes
  const stampAnimsCount = sortedCodes.length;
  const stampAnims = useMemo(() => {
    return Array.from({ length: stampAnimsCount }, () => ({
      scale: new Animated.Value(animated ? 0.5 : 1),
      opacity: new Animated.Value(animated ? 0 : 1),
      translateY: new Animated.Value(animated ? -20 : 0),
    }));
  }, [stampAnimsCount, animated]);

  useEffect(() => {
    if (!animated || visibleCodes.length === 0) {
      onAnimationComplete?.();
      return;
    }

    const staggerDelay = 100;
    const timeoutIds: ReturnType<typeof setTimeout>[] = [];

    const animations = sortedCodes.map((_, index) => {
      return Animated.sequence([
        Animated.delay(animationDelay + index * staggerDelay),
        Animated.parallel([
          Animated.spring(stampAnims[index].scale, {
            toValue: 1,
            friction: 6,
            tension: 100,
            useNativeDriver: true,
          }),
          Animated.timing(stampAnims[index].opacity, {
            toValue: 1,
            duration: 200,
            useNativeDriver: true,
          }),
          Animated.spring(stampAnims[index].translateY, {
            toValue: 0,
            friction: 8,
            tension: 80,
            useNativeDriver: true,
          }),
        ]),
      ]);
    });

    // Trigger haptic on each stamp with cleanup
    sortedCodes.forEach((_, index) => {
      const timeoutId = setTimeout(() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }, animationDelay + index * staggerDelay);
      timeoutIds.push(timeoutId);
    });

    Animated.parallel(animations).start(() => {
      onAnimationComplete?.();
    });

    return () => {
      timeoutIds.forEach(clearTimeout);
    };
  }, [animated, animationDelay, sortedCodes, stampAnims, onAnimationComplete, visibleCodes.length]);

  const stampSize = (containerWidth - 32) / 3.5;

  // Calculate container height based on positions
  const containerHeight = useMemo(() => {
    if (positions.length === 0) return 200;
    const maxY = Math.max(...positions.map((p) => p.y));
    return maxY + stampSize + 20;
  }, [positions, stampSize]);

  if (visibleCodes.length === 0) {
    return (
      <View style={[styles.emptyContainer, { height: 200 }]}>
        <Text style={styles.emptyText}>Your passport awaits its first stamp</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { height: containerHeight }]}>
      {sortedCodes.map((code, index) => {
        const originalIndex = visibleCodes.indexOf(code);
        const position = positions[originalIndex];
        const stampImage = getStampImage(code);

        if (!stampImage || !position || !stampAnims[index]) return null;

        return (
          <Animated.View
            key={code}
            style={[
              styles.stampWrapper,
              {
                left: position.x,
                top: position.y,
                width: stampSize * position.scale,
                height: stampSize * position.scale,
                zIndex: position.zIndex,
                transform: [
                  { scale: stampAnims[index].scale },
                  { translateY: stampAnims[index].translateY },
                  { rotate: `${position.rotation}deg` },
                ],
                opacity: stampAnims[index].opacity,
              },
            ]}
          >
            <Image source={stampImage} style={styles.stampImage} resizeMode="contain" />
          </Animated.View>
        );
      })}

      {extraCount > 0 && (
        <View style={[styles.moreIndicator, { top: containerHeight - 40 }]}>
          <Text style={styles.moreText}>+{extraCount} more adventures</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    position: 'relative',
  },
  stampWrapper: {
    position: 'absolute',
  },
  stampImage: {
    width: '100%',
    height: '100%',
  },
  emptyContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  emptyText: {
    fontFamily: fonts.dawning.regular,
    fontSize: 24,
    color: colors.stormGray,
    textAlign: 'center',
  },
  moreIndicator: {
    position: 'absolute',
    right: 0,
    backgroundColor: colors.sunsetGold,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 16,
  },
  moreText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 14,
    color: colors.midnightNavy,
  },
});
