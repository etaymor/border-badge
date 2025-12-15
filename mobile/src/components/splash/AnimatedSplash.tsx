/**
 * Animated splash screen with video background and logo overlay.
 * Displays while the app initializes, then fades out to reveal the main app.
 */

import { useVideoPlayer, VideoView } from 'expo-video';
import { memo, useEffect, useRef, useState } from 'react';
import { Animated, Image, StyleSheet, View } from 'react-native';

import { colors } from '@constants/colors';

/* eslint-disable @typescript-eslint/no-require-imports */
const splashVideo = require('../../../assets/country-images/wonders-world/Atlantis2.mp4');
const atlasLogo = require('../../../assets/atlasi-logo.png');
/* eslint-enable @typescript-eslint/no-require-imports */

interface AnimatedSplashProps {
  /** Whether the app is ready (fonts loaded, auth initialized, etc.) */
  isAppReady: boolean;
  /** Callback when splash animation completes and should be removed */
  onAnimationComplete: () => void;
}

function AnimatedSplashComponent({ isAppReady, onAnimationComplete }: AnimatedSplashProps) {
  const [isVideoReady, setIsVideoReady] = useState(false);
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const logoScale = useRef(new Animated.Value(0.8)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const hasStartedFadeOut = useRef(false);

  // Create video player
  const player = useVideoPlayer(splashVideo, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });

  // Listen for player status changes to detect when video is ready
  useEffect(() => {
    if (!player) return;

    const subscription = player.addListener('statusChange', (status) => {
      if (status.status === 'readyToPlay' && !isVideoReady) {
        setIsVideoReady(true);
      }
    });

    return () => subscription.remove();
  }, [player, isVideoReady]);

  // Fallback: if video doesn't signal ready within 1 second, proceed anyway
  useEffect(() => {
    const fallbackTimeout = setTimeout(() => {
      if (!isVideoReady) {
        console.log('Video ready timeout - proceeding with splash');
        setIsVideoReady(true);
      }
    }, 1000);

    return () => clearTimeout(fallbackTimeout);
  }, [isVideoReady]);

  // Animate logo entrance when video is ready
  useEffect(() => {
    if (isVideoReady) {
      Animated.parallel([
        Animated.timing(logoOpacity, {
          toValue: 1,
          duration: 600,
          useNativeDriver: true,
        }),
        Animated.spring(logoScale, {
          toValue: 1,
          friction: 8,
          tension: 40,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [isVideoReady, logoOpacity, logoScale]);

  // Fade out splash when app is ready
  useEffect(() => {
    if (isAppReady && isVideoReady && !hasStartedFadeOut.current) {
      hasStartedFadeOut.current = true;
      // Wait a moment to let user see the splash, then fade out
      const timeout = setTimeout(() => {
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 500,
          useNativeDriver: true,
        }).start(() => {
          onAnimationComplete();
        });
      }, 1500); // Show splash for at least 1.5s after app is ready

      return () => clearTimeout(timeout);
    }
  }, [isAppReady, isVideoReady, fadeAnim, onAnimationComplete]);

  return (
    <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
      {/* Video background */}
      <VideoView
        player={player}
        style={styles.video}
        contentFit="cover"
        nativeControls={false}
      />

      {/* Dark overlay for better logo visibility */}
      <View style={styles.overlay} />

      {/* Logo */}
      <Animated.View
        style={[
          styles.logoContainer,
          {
            opacity: logoOpacity,
            transform: [{ scale: logoScale }],
          },
        ]}
      >
        <Image source={atlasLogo} style={styles.logo} resizeMode="contain" />
      </Animated.View>
    </Animated.View>
  );
}

export const AnimatedSplash = memo(AnimatedSplashComponent);

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.warmCream,
    zIndex: 1000,
  },
  video: {
    ...StyleSheet.absoluteFillObject,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(23, 42, 58, 0.3)', // midnightNavy with opacity for logo contrast
  },
  logoContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-start',
    alignItems: 'center',
    paddingTop: 100,
  },
  logo: {
    width: 240,
    height: 70,
  },
});
