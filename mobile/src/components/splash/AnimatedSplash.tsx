/**
 * Animated splash screen with video background and logo overlay.
 * Displays while the app initializes, then fades out to reveal the main app.
 */

import { useVideoPlayer, VideoView } from 'expo-video';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet } from 'react-native';

/* eslint-disable @typescript-eslint/no-require-imports */
const splashVideo = require('../../../assets/country-images/wonders-world/Atlantis2.mp4');
/* eslint-enable @typescript-eslint/no-require-imports */

interface AnimatedSplashProps {
  /** Whether the app is ready (fonts loaded, auth initialized, etc.) */
  isAppReady: boolean;
  /** Callback when splash animation completes and should be removed */
  onAnimationComplete: () => void;
  /** Callback to signal that the animated splash is now visible (video ready) */
  onSplashVisible: () => void;
}

function AnimatedSplashComponent({
  isAppReady,
  onAnimationComplete,
  onSplashVisible,
}: AnimatedSplashProps) {
  const [isVideoReady, setIsVideoReady] = useState(false);
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const hasStartedFadeOut = useRef(false);
  const hasNotifiedVisible = useRef(false);

  // Create video player
  const player = useVideoPlayer(splashVideo, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });

  // Handler for when the first video frame is rendered
  // useCallback with empty deps ensures stable reference across renders
  const handleFirstFrameRender = useCallback(() => {
    setIsVideoReady(true);
  }, []);

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

  // Notify parent that the splash is now visible (video ready)
  useEffect(() => {
    if (isVideoReady && !hasNotifiedVisible.current) {
      hasNotifiedVisible.current = true;
      onSplashVisible();
    }
  }, [isVideoReady, onSplashVisible]);

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
      <VideoView
        player={player}
        style={styles.video}
        contentFit="cover"
        nativeControls={false}
        onFirstFrameRender={handleFirstFrameRender}
      />
    </Animated.View>
  );
}

export const AnimatedSplash = memo(AnimatedSplashComponent);

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#F5F0E8', // matches native splash background
    zIndex: 1000,
  },
  video: {
    ...StyleSheet.absoluteFillObject,
  },
});
