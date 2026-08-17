/**
 * ShareExtensionTutorialSheet - Bottom sheet with video tutorial for share extension
 *
 * Displays an instructional video and step-by-step guide for saving content
 * from TikTok and Instagram via the iOS share extension.
 */

import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  AppState,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@components/ui';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';

/* eslint-disable @typescript-eslint/no-require-imports */
const extensionVideo = require('../../../assets/extension.mp4');
/* eslint-enable @typescript-eslint/no-require-imports */

const DISMISS_THRESHOLD = 100;
const SHEET_HEIGHT_RATIO = 0.72;

interface ShareExtensionTutorialSheetProps {
  visible: boolean;
  onClose: () => void;
}

export function ShareExtensionTutorialSheet({
  visible,
  onClose,
}: ShareExtensionTutorialSheetProps) {
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();
  const sheetHeight = screenHeight * SHEET_HEIGHT_RATIO;

  const translateY = useRef(new Animated.Value(sheetHeight)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  // Video player setup
  const player = useVideoPlayer(extensionVideo, (playerInstance) => {
    playerInstance.loop = true;
    playerInstance.muted = true;
    playerInstance.audioMixingMode = 'mixWithOthers';
  });

  // Pause video on unmount for clean UX. useVideoPlayer handles release() automatically.
  // Wrap in try-catch because the native shared object may already be released.
  useEffect(() => {
    return () => {
      try {
        player.pause();
      } catch {
        // Native player already released, safe to ignore
      }
    };
  }, [player]);

  // Pause video when app goes to background
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active' && visible) {
        try {
          player.pause();
        } catch {
          // Native player may be released, safe to ignore
        }
      }
    });
    return () => subscription.remove();
  }, [player, visible]);

  // Animation handlers
  const openSheet = useCallback(() => {
    // Reset translateY to sheetHeight before animating in case it changed
    translateY.setValue(sheetHeight);
    Animated.parallel([
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        friction: 8,
        tension: 65,
      }),
      Animated.timing(backdropOpacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => {
      // Start video playback after animation completes
      // Re-ensure loop is enabled and reset position for consistent behavior
      player.loop = true;
      player.currentTime = 0;
      player.play();
    });
  }, [translateY, backdropOpacity, player, sheetHeight]);

  // Use ref to hold the latest onClose callback for panResponder
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const closeSheet = useCallback(() => {
    // Note: Video pause is handled by the visibility effect below
    // to ensure consistent behavior regardless of how the sheet closes
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: sheetHeight,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(backdropOpacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => onCloseRef.current());
  }, [translateY, backdropOpacity, sheetHeight]);

  // Pan gesture for drag-to-dismiss
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_, gestureState) => gestureState.dy > 10,
        onPanResponderMove: (_, gestureState) => {
          if (gestureState.dy > 0) {
            translateY.setValue(gestureState.dy);
          }
        },
        onPanResponderRelease: (_, gestureState) => {
          if (gestureState.dy > DISMISS_THRESHOLD) {
            closeSheet();
          } else {
            Animated.spring(translateY, {
              toValue: 0,
              useNativeDriver: true,
            }).start();
          }
        },
      }),
    [translateY, closeSheet]
  );

  // Handle "Got It" button press
  const handleGotIt = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    closeSheet();
  }, [closeSheet]);

  // Open animation on visible change
  useEffect(() => {
    if (visible) {
      openSheet();
    }
  }, [visible, openSheet]);

  // Control video playback based on visibility
  // This is the single source of truth for video state
  useEffect(() => {
    if (!visible) {
      try {
        player.pause();
      } catch {
        // Native player may be released, safe to ignore
      }
    }
  }, [visible, player]);

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={closeSheet}
      statusBarTranslucent
    >
      {/* Backdrop */}
      <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={closeSheet} />
      </Animated.View>

      {/* Bottom Sheet */}
      <Animated.View
        style={[
          styles.sheetContainer,
          {
            height: sheetHeight,
            transform: [{ translateY }],
          },
        ]}
        {...panResponder.panHandlers}
      >
        <BlurView intensity={80} tint="light" style={styles.blurContainer}>
          <View style={[styles.solidBackground, { paddingBottom: insets.bottom }]}>
            {/* Handle bar */}
            <View style={styles.handleContainer}>
              <View style={styles.handle} />
            </View>

            <ScrollView style={styles.content} showsVerticalScrollIndicator={false} bounces={false}>
              {/* Tutorial Title */}
              <Text style={styles.title}>Save Travel Inspiration</Text>

              {/* Video Player */}
              <View style={styles.videoContainer} pointerEvents="none">
                <VideoView
                  player={player}
                  style={styles.video}
                  contentFit="cover"
                  nativeControls={false}
                  allowsFullscreen={false}
                  allowsPictureInPicture={false}
                  accessible={true}
                  accessibilityLabel="Video showing how to use the share extension to save content from TikTok and Instagram"
                />
              </View>

              {/* Step-by-step Instructions */}
              <View style={styles.stepsContainer}>
                <View style={styles.step}>
                  <Text style={styles.stepNumber}>1</Text>
                  <Text style={styles.stepText}>Find a video or post on TikTok or Instagram</Text>
                </View>
                <View style={styles.step}>
                  <Text style={styles.stepNumber}>2</Text>
                  <Text style={styles.stepText}>Tap the share button</Text>
                </View>
                <View style={styles.step}>
                  <Text style={styles.stepNumber}>3</Text>
                  <Text style={styles.stepText}>
                    Select <Text style={styles.boldText}>Atlasi</Text> from the share menu
                  </Text>
                </View>
                <View style={styles.step}>
                  <Text style={styles.stepNumber}>4</Text>
                  <Text style={styles.stepText}>Choose which trip to save it to</Text>
                </View>
              </View>

              {/* Footer text */}
              <Text style={styles.footerText}>
                Your saves appear in your trip&apos;s log alongside your own memories.
              </Text>

              {/* Spacer for button */}
              <View style={styles.buttonSpacer} />
            </ScrollView>

            {/* Got It Button - Fixed at bottom */}
            <View style={styles.buttonContainer}>
              <TouchableOpacity
                style={styles.gotItButton}
                onPress={handleGotIt}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Close tutorial"
              >
                <Text style={styles.gotItButtonText}>Got It</Text>
              </TouchableOpacity>
            </View>
          </View>
        </BlurView>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(23, 42, 58, 0.5)',
  },
  sheetContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    // height is set dynamically via style prop to support screen rotation
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  blurContainer: {
    flex: 1,
  },
  solidBackground: {
    flex: 1,
    backgroundColor: colors.warmCream,
  },
  handleContainer: {
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 8,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.stormGray,
    opacity: 0.4,
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
  },
  videoContainer: {
    width: '100%',
    overflow: 'hidden',
    marginBottom: 20,
  },
  video: {
    width: '100%',
    aspectRatio: 4 / 5, // Video is 4:5 aspect ratio
  },
  title: {
    fontFamily: fonts.playfair.bold,
    fontSize: 26,
    color: colors.midnightNavy,
    textAlign: 'center',
    marginBottom: 16,
    paddingHorizontal: 16,
  },
  stepsContainer: {
    gap: 16,
    marginBottom: 20,
  },
  step: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  stepNumber: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 14,
    color: colors.cloudWhite,
    backgroundColor: colors.mossGreen,
    width: 24,
    height: 24,
    borderRadius: 12,
    textAlign: 'center',
    lineHeight: 24,
    overflow: 'hidden',
  },
  stepText: {
    fontFamily: fonts.openSans.regular,
    fontSize: 15,
    color: colors.midnightNavy,
    flex: 1,
    lineHeight: 22,
  },
  boldText: {
    fontFamily: fonts.openSans.semiBold,
  },
  footerText: {
    fontFamily: fonts.openSans.regular,
    fontSize: 14,
    color: colors.stormGray,
    textAlign: 'center',
    fontStyle: 'italic',
    lineHeight: 20,
  },
  buttonSpacer: {
    height: 80,
  },
  buttonContainer: {
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 8,
    backgroundColor: colors.warmCream,
  },
  gotItButton: {
    backgroundColor: colors.mossGreen,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  gotItButtonText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 16,
    color: colors.cloudWhite,
    letterSpacing: 0.5,
  },
});
