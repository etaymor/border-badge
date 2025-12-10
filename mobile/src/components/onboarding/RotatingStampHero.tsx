import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Image, StyleSheet, useWindowDimensions, View } from 'react-native';

import { colors } from '@constants/colors';

import { getStampImage } from '../../assets/stampImages';

// Sample stamps to use as fallback when user has few stamps
const SAMPLE_STAMPS = ['US', 'FR', 'JP', 'IT', 'AU', 'BR', 'GB', 'DE', 'ES', 'TH'];

// Organic stamp positions for overlapping layout (6 visible at a time)
const STAMP_POSITIONS = [
  { x: 0.05, y: 0.1, rotation: -5, scale: 1.0 },
  { x: 0.35, y: 0.0, rotation: 3, scale: 0.95 },
  { x: 0.65, y: 0.08, rotation: -2, scale: 1.02 },
  { x: 0.12, y: 0.45, rotation: 4, scale: 0.98 },
  { x: 0.42, y: 0.52, rotation: -3, scale: 1.0 },
  { x: 0.68, y: 0.42, rotation: 2, scale: 0.96 },
];

export interface RotatingStampHeroProps {
  stampCodes: string[];
  visibleCount?: number;
  rotationInterval?: number;
}

export default function RotatingStampHero({
  stampCodes,
  visibleCount = 6,
  rotationInterval = 3000,
}: RotatingStampHeroProps) {
  const { width: screenWidth } = useWindowDimensions();

  // Clamp visibleCount to available positions to prevent undefined indexing
  const actualVisibleCount = Math.max(0, Math.min(visibleCount, STAMP_POSITIONS.length));

  // Combine user stamps with samples if needed
  const allStamps = useMemo(() => {
    if (stampCodes.length >= actualVisibleCount) {
      return stampCodes;
    }
    // Fill with sample stamps that aren't already in user's collection
    const needed = actualVisibleCount - stampCodes.length;
    const available = SAMPLE_STAMPS.filter((s) => !stampCodes.includes(s));
    return [...stampCodes, ...available.slice(0, needed)];
  }, [stampCodes, actualVisibleCount]);

  // Track which stamps are currently visible
  const [visibleIndices, setVisibleIndices] = useState<number[]>(() =>
    Array.from({ length: Math.min(actualVisibleCount, allStamps.length) }, (_, i) => i)
  );

  // Animation values for each slot
  const slotAnimations = useRef<Animated.Value[]>(
    Array.from({ length: actualVisibleCount }, () => new Animated.Value(1))
  ).current;

  // Floating animation for each slot
  const floatAnimations = useRef<Animated.Value[]>(
    Array.from({ length: actualVisibleCount }, () => new Animated.Value(0))
  ).current;

  // Entrance animation
  const containerScale = useRef(new Animated.Value(0.9)).current;
  const containerOpacity = useRef(new Animated.Value(0)).current;

  // Initial entrance animation
  useEffect(() => {
    Animated.parallel([
      Animated.spring(containerScale, {
        toValue: 1,
        friction: 8,
        tension: 60,
        useNativeDriver: true,
      }),
      Animated.timing(containerOpacity, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      }),
    ]).start();
  }, [containerScale, containerOpacity]);

  // Staggered stamp entrance with cleanup
  useEffect(() => {
    const timeoutIds: ReturnType<typeof setTimeout>[] = [];

    slotAnimations.forEach((anim, index) => {
      const timeoutId = setTimeout(
        () => {
          Animated.spring(anim, {
            toValue: 1,
            friction: 8,
            tension: 100,
            useNativeDriver: true,
          }).start();
        },
        400 + index * 80
      );
      timeoutIds.push(timeoutId);
    });

    return () => {
      timeoutIds.forEach(clearTimeout);
    };
  }, [slotAnimations]);

  // Floating animation for each stamp
  useEffect(() => {
    const startTimeouts: ReturnType<typeof setTimeout>[] = [];
    const floatLoops: Animated.CompositeAnimation[] = [];

    floatAnimations.forEach((anim, index) => {
      // Offset each stamp's float cycle
      const delay = index * 500;

      const startFloat = () => {
        const loop = Animated.loop(
          Animated.sequence([
            Animated.timing(anim, {
              toValue: 1,
              duration: 1500,
              useNativeDriver: true,
            }),
            Animated.timing(anim, {
              toValue: 0,
              duration: 1500,
              useNativeDriver: true,
            }),
          ])
        );
        floatLoops[index] = loop;
        loop.start();
      };

      startTimeouts.push(setTimeout(startFloat, delay));
    });
    return () => {
      startTimeouts.forEach(clearTimeout);
      floatLoops.forEach((loop) => {
        if (loop) loop.stop();
      });
    };
  }, [floatAnimations]);

  // Rotation logic - rotate one stamp at a time
  useEffect(() => {
    if (allStamps.length <= actualVisibleCount) return;

    const interval = setInterval(() => {
      // Pick a random slot to rotate
      const slotToRotate = Math.floor(Math.random() * actualVisibleCount);

      // Fade out
      Animated.timing(slotAnimations[slotToRotate], {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start(() => {
        // Update the stamp index for this slot
        setVisibleIndices((prev) => {
          const newIndices = [...prev];
          // Find next stamp that isn't currently visible
          let nextIndex = prev[slotToRotate];
          do {
            nextIndex = (nextIndex + 1) % allStamps.length;
          } while (prev.includes(nextIndex) && nextIndex !== prev[slotToRotate]);
          newIndices[slotToRotate] = nextIndex;
          return newIndices;
        });

        // Fade in
        Animated.timing(slotAnimations[slotToRotate], {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }).start();
      });
    }, rotationInterval);

    return () => clearInterval(interval);
  }, [allStamps.length, actualVisibleCount, rotationInterval, slotAnimations]);

  const containerWidth = screenWidth - 48; // 24px padding each side
  const containerHeight = containerWidth * 0.7; // Aspect ratio for stamp display
  const stampSize = containerWidth * 0.28;

  // Memoize interpolations to prevent recreation on every render (Issue #7)
  const floatYInterpolations = useMemo(
    () =>
      floatAnimations.map((anim) =>
        anim.interpolate({
          inputRange: [0, 1],
          outputRange: [0, -3],
        })
      ),
    [floatAnimations]
  );

  const slotScaleInterpolations = useMemo(
    () =>
      slotAnimations.map((anim) =>
        anim.interpolate({
          inputRange: [0, 1],
          outputRange: [0.8, 1],
        })
      ),
    [slotAnimations]
  );

  return (
    <Animated.View
      style={[
        styles.container,
        {
          width: containerWidth,
          height: containerHeight,
          opacity: containerOpacity,
          transform: [{ scale: containerScale }],
        },
      ]}
    >
      {/* Background card */}
      <View style={styles.backgroundCard} />

      {/* Stamps */}
      {visibleIndices.map((stampIndex, slotIndex) => {
        const stampCode = allStamps[stampIndex];
        const stampImage = getStampImage(stampCode);
        const pos = STAMP_POSITIONS[slotIndex];

        if (!stampImage || !pos) return null;

        // Use memoized interpolations (Issue #7)
        const floatY = floatYInterpolations[slotIndex];
        const slotScale = slotScaleInterpolations[slotIndex];

        return (
          <Animated.View
            key={`slot-${slotIndex}`}
            style={[
              styles.stampWrapper,
              {
                left: pos.x * containerWidth,
                top: pos.y * containerHeight,
                width: stampSize,
                height: stampSize,
                opacity: slotAnimations[slotIndex],
                transform: [
                  { rotate: `${pos.rotation}deg` },
                  { scale: pos.scale },
                  { translateY: floatY },
                  { scale: slotScale },
                ],
              },
            ]}
          >
            <Image source={stampImage} style={styles.stampImage} resizeMode="contain" />
          </Animated.View>
        );
      })}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    alignSelf: 'center',
  },
  backgroundCard: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'transparent',
    borderRadius: 20,
  },
  stampWrapper: {
    position: 'absolute',
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  stampImage: {
    width: '100%',
    height: '100%',
  },
});
