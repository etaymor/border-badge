/**
 * Full-screen overlay modal for the share card.
 * Includes animation, photo selection, sharing, and save functionality.
 */

import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Modal,
  Pressable,
  Share,
  StyleSheet,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ViewShot from 'react-native-view-shot';

import { Text } from '@components/ui';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import type { MilestoneContext } from '@utils/milestones';

import { ShareCard, SHARE_CARD_WIDTH, SHARE_CARD_HEIGHT } from './ShareCard';

/** Horizontal padding on each side of the card */
const CARD_HORIZONTAL_PADDING = 24;

/** Total horizontal padding (both sides) */
const CARD_TOTAL_HORIZONTAL_PADDING = CARD_HORIZONTAL_PADDING * 2;

/** Vertical margin above and below the card */
const CARD_VERTICAL_MARGIN = 80;

interface ShareCardOverlayProps {
  visible: boolean;
  context: MilestoneContext | null;
  onDismiss: () => void;
}

function ShareCardOverlayComponent({ visible, context, onDismiss }: ShareCardOverlayProps) {
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const viewShotRef = useRef<ViewShot>(null);

  // Animation values
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const cardScale = useRef(new Animated.Value(0.9)).current;
  const cardOpacity = useRef(new Animated.Value(0)).current;

  // Calculate scale to fit screen with padding, respecting both width and height constraints
  const availableWidth = screenWidth - CARD_TOTAL_HORIZONTAL_PADDING;
  const availableHeight = screenHeight - insets.top - insets.bottom - CARD_VERTICAL_MARGIN;
  const widthScale = availableWidth / SHARE_CARD_WIDTH;
  const heightScale = availableHeight / SHARE_CARD_HEIGHT;
  const displayScale = Math.min(widthScale, heightScale);

  // State
  const [backgroundImage, setBackgroundImage] = useState<string | undefined>(undefined);
  const [isAnimating, setIsAnimating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Animation sequence
  useEffect(() => {
    if (visible && context) {
      setIsAnimating(true);

      const animation = Animated.parallel([
        Animated.timing(backdropOpacity, {
          toValue: 1,
          duration: 150,
          useNativeDriver: true,
        }),
        Animated.spring(cardScale, {
          toValue: displayScale,
          friction: 8,
          tension: 100,
          useNativeDriver: true,
        }),
        Animated.timing(cardOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]);

      animation.start(() => {
        setIsAnimating(false);
      });

      // Cleanup: stop animation if component unmounts mid-animation
      return () => {
        animation.stop();
      };
    } else {
      // Reset animations
      backdropOpacity.setValue(0);
      cardScale.setValue(0.9 * displayScale);
      cardOpacity.setValue(0);
      setBackgroundImage(undefined);
    }
  }, [visible, context, backdropOpacity, cardScale, cardOpacity, displayScale]);

  // Skip animation on tap
  const handleSkipAnimation = useCallback(() => {
    if (isAnimating) {
      backdropOpacity.setValue(1);
      cardScale.setValue(displayScale);
      cardOpacity.setValue(1);
      setIsAnimating(false);
    }
  }, [isAnimating, backdropOpacity, cardScale, cardOpacity, displayScale]);

  // Handle dismiss with fade out
  const handleDismiss = useCallback(() => {
    Animated.parallel([
      Animated.timing(backdropOpacity, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.timing(cardOpacity, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start(() => {
      onDismiss();
    });
  }, [backdropOpacity, cardOpacity, onDismiss]);

  // Add photo from camera roll
  const handleAddPhoto = useCallback(async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [9, 16],
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        setBackgroundImage(result.assets[0].uri);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    } catch (error) {
      console.error('Failed to pick image:', error);
    }
  }, []);

  // Remove photo
  const handleRemovePhoto = useCallback(() => {
    setBackgroundImage(undefined);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  // Share card as image
  const handleShare = useCallback(async () => {
    try {
      const uri = await viewShotRef.current?.capture?.();
      if (uri) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        await Share.share({ url: uri });
      }
    } catch (error) {
      console.error('Share failed:', error);
      Alert.alert('Error', 'Failed to share. Please try again.');
    }
  }, []);

  // Save card to photos
  const handleSave = useCallback(async () => {
    try {
      setIsSaving(true);

      // Request permissions
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Permission Required',
          'Please enable photo library access in Settings to save images.',
          [{ text: 'OK' }]
        );
        return;
      }

      // Capture and save
      const uri = await viewShotRef.current?.capture?.();
      if (uri) {
        await MediaLibrary.saveToLibraryAsync(uri);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert('Saved!', 'Image saved to your photo library.');
      }
    } catch (error) {
      console.error('Save failed:', error);
      Alert.alert('Error', 'Failed to save image. Please try again.');
    } finally {
      setIsSaving(false);
    }
  }, []);

  if (!context) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={handleDismiss}
    >
      <Pressable style={styles.container} onPress={isAnimating ? handleSkipAnimation : undefined}>
        {/* Backdrop */}
        <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]} />

        {/* Content */}
        <View style={[styles.content, { paddingTop: insets.top + 16 }]}>
          {/* Close button */}
          <TouchableOpacity
            style={styles.closeButton}
            onPress={handleDismiss}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityRole="button"
            accessibilityLabel="Close share card"
          >
            <Ionicons name="close" size={28} color={colors.warmCream} />
          </TouchableOpacity>

          {/* Share Card */}
          <Animated.View
            style={[
              styles.cardContainer,
              {
                opacity: cardOpacity,
                transform: [{ scale: cardScale }],
              },
            ]}
          >
            <ViewShot
              ref={viewShotRef}
              options={{
                format: 'png',
                quality: 0.9,
                width: 1080, // Instagram Story width
                height: 1920, // Instagram Story height
              }}
            >
              <ShareCard context={context} backgroundImage={backgroundImage} />
            </ViewShot>
          </Animated.View>

          {/* Action buttons */}
          <Animated.View style={[styles.actionsContainer, { opacity: cardOpacity }]}>
            {/* Photo button */}
            <TouchableOpacity
              style={styles.actionButton}
              onPress={backgroundImage ? handleRemovePhoto : handleAddPhoto}
              activeOpacity={0.7}
              hitSlop={{ top: 16, bottom: 16, left: 12, right: 12 }}
              accessibilityRole="button"
              accessibilityLabel={backgroundImage ? 'Remove photo' : 'Add photo from library'}
              accessibilityHint={
                backgroundImage ? 'Removes the background photo' : 'Opens photo library to select a background'
              }
            >
              <View style={styles.actionIconContainer}>
                <Ionicons
                  name={backgroundImage ? 'close-circle' : 'image-outline'}
                  size={24}
                  color={colors.midnightNavy}
                />
              </View>
              <Text style={styles.actionLabel}>{backgroundImage ? 'Remove' : 'Add Photo'}</Text>
            </TouchableOpacity>

            {/* Share button */}
            <TouchableOpacity
              style={[styles.actionButton, styles.primaryAction]}
              onPress={handleShare}
              activeOpacity={0.7}
              hitSlop={{ top: 16, bottom: 16, left: 12, right: 12 }}
              accessibilityRole="button"
              accessibilityLabel="Share card"
              accessibilityHint="Opens share sheet to share this card"
            >
              <View style={[styles.actionIconContainer, styles.primaryIconContainer]}>
                <Ionicons name="share-outline" size={24} color={colors.white} />
              </View>
              <Text style={[styles.actionLabel, styles.primaryLabel]}>Share</Text>
            </TouchableOpacity>

            {/* Save button */}
            <TouchableOpacity
              style={styles.actionButton}
              onPress={handleSave}
              activeOpacity={0.7}
              disabled={isSaving}
              hitSlop={{ top: 16, bottom: 16, left: 12, right: 12 }}
              accessibilityRole="button"
              accessibilityLabel={isSaving ? 'Saving to photos' : 'Save to photos'}
              accessibilityHint="Saves this card to your photo library"
              accessibilityState={{ disabled: isSaving }}
            >
              <View style={styles.actionIconContainer}>
                <Ionicons
                  name={isSaving ? 'hourglass-outline' : 'download-outline'}
                  size={24}
                  color={colors.midnightNavy}
                />
              </View>
              <Text style={styles.actionLabel}>Save</Text>
            </TouchableOpacity>
          </Animated.View>
        </View>
      </Pressable>
    </Modal>
  );
}

export const ShareCardOverlay = memo(ShareCardOverlayComponent);

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(23, 42, 58, 0.95)',
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  closeButton: {
    position: 'absolute',
    top: 60,
    right: 20,
    zIndex: 10,
    padding: 8,
  },
  cardContainer: {
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.4,
    shadowRadius: 24,
    elevation: 20,
  },
  actionsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 32,
    gap: 24,
  },
  actionButton: {
    alignItems: 'center',
  },
  primaryAction: {
    // Primary action styling
  },
  actionIconContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.warmCream,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  primaryIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.sunsetGold,
  },
  actionLabel: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 12,
    color: colors.warmCream,
  },
  primaryLabel: {
    color: colors.sunsetGold,
  },
});
