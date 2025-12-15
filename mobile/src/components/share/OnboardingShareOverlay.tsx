/**
 * Full-screen overlay modal for onboarding share cards.
 * Displays three card variants (stamps, stats, map) with tap-to-switch pagination.
 * Includes sharing and save functionality.
 */

import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
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

import { ErrorBoundary, Text } from '@components/ui';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { logger } from '@utils/logger';

import {
  OnboardingShareCard,
  ONBOARDING_SHARE_CARD_WIDTH,
  ONBOARDING_SHARE_CARD_HEIGHT,
  type OnboardingShareContext,
  type OnboardingShareVariant,
} from './OnboardingShareCard';

const CARD_HORIZONTAL_PADDING = 24;
const CARD_TOTAL_HORIZONTAL_PADDING = CARD_HORIZONTAL_PADDING * 2;
const ACTION_AREA_HEIGHT = 200; // Accounts for pagination + actions + margins
const MIN_TOP_SPACING = 60;
const CARD_VARIANTS: OnboardingShareVariant[] = ['stamps', 'stats', 'map'];

interface OnboardingShareOverlayProps {
  visible: boolean;
  context: OnboardingShareContext | null;
  onDismiss: () => void;
}

function OnboardingShareOverlayComponent({
  visible,
  context,
  onDismiss,
}: OnboardingShareOverlayProps) {
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const viewShotRefs = useRef<(ViewShot | null)[]>([null, null, null]);

  // Animation values
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const contentOpacity = useRef(new Animated.Value(0)).current;

  // State
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isSaving, setIsSaving] = useState(false);

  // Animation sequence
  useEffect(() => {
    if (visible && context) {
      Animated.parallel([
        Animated.timing(backdropOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(contentOpacity, {
          toValue: 1,
          duration: 300,
          delay: 100,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      backdropOpacity.setValue(0);
      contentOpacity.setValue(0);
    }
  }, [visible, context, backdropOpacity, contentOpacity]);

  // Scale to fit screen using same approach as ShareCard overlay
  const availableWidth = screenWidth - CARD_TOTAL_HORIZONTAL_PADDING;
  const availableHeight =
    screenHeight - insets.top - insets.bottom - MIN_TOP_SPACING - ACTION_AREA_HEIGHT;
  const widthScale = availableWidth / ONBOARDING_SHARE_CARD_WIDTH;
  const heightScale = availableHeight / ONBOARDING_SHARE_CARD_HEIGHT;
  const displayScale = Math.min(widthScale, heightScale);
  const displayWidth = ONBOARDING_SHARE_CARD_WIDTH * displayScale;
  const displayHeight = ONBOARDING_SHARE_CARD_HEIGHT * displayScale;

  // Handle dismiss with fade out
  const handleDismiss = useCallback(() => {
    Animated.parallel([
      Animated.timing(backdropOpacity, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.timing(contentOpacity, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start(() => {
      onDismiss();
    });
  }, [backdropOpacity, contentOpacity, onDismiss]);

  // Share current card as image
  const handleShare = useCallback(async () => {
    try {
      const ref = viewShotRefs.current[currentIndex];
      const uri = await ref?.capture?.();
      if (uri) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        await Share.share({ url: uri });
      }
    } catch (error) {
      logger.error('Share failed:', error);
      Alert.alert('Error', 'Failed to share. Please try again.');
    }
  }, [currentIndex]);

  // Save current card to photos
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
      const ref = viewShotRefs.current[currentIndex];
      const uri = await ref?.capture?.();
      if (uri) {
        await MediaLibrary.saveToLibraryAsync(uri);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert('Saved!', 'Image saved to your photo library.');
      }
    } catch (error) {
      logger.error('Save failed:', error);
      Alert.alert('Error', 'Failed to save image. Please try again.');
    } finally {
      setIsSaving(false);
    }
  }, [currentIndex]);

  if (!context) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={handleDismiss}
    >
      <Pressable style={styles.container} onPress={handleDismiss}>
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
            accessibilityLabel="Close share overlay"
          >
            <Ionicons name="close" size={28} color={colors.warmCream} />
          </TouchableOpacity>

          {/* Card container - matches ShareCardOverlay pattern */}
          <Animated.View
            style={[
              styles.cardContainer,
              {
                width: displayWidth,
                height: displayHeight,
                opacity: contentOpacity,
              },
            ]}
          >
            <View
              style={{
                width: ONBOARDING_SHARE_CARD_WIDTH,
                height: ONBOARDING_SHARE_CARD_HEIGHT,
                transform: [{ scale: displayScale }],
                transformOrigin: 'top left',
              }}
            >
              <ViewShot
                ref={(ref) => {
                  viewShotRefs.current[currentIndex] = ref;
                }}
                options={{
                  format: 'png',
                  quality: 0.95,
                  width: 1080,
                  height: 1920,
                  result: 'tmpfile',
                }}
                style={styles.cardInner}
              >
                <OnboardingShareCard variant={CARD_VARIANTS[currentIndex]} context={context} />
              </ViewShot>
            </View>
          </Animated.View>

          {/* Pagination dots */}
          <View style={styles.pagination}>
            {CARD_VARIANTS.map((variant, index) => (
              <TouchableOpacity
                key={variant}
                onPress={() => {
                  if (index !== currentIndex) {
                    setCurrentIndex(index);
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  }
                }}
                style={styles.paginationDotContainer}
              >
                <View
                  style={[
                    styles.paginationDot,
                    index === currentIndex && styles.paginationDotActive,
                  ]}
                />
                <Text
                  style={[
                    styles.paginationLabel,
                    index === currentIndex && styles.paginationLabelActive,
                  ]}
                >
                  {variant.toUpperCase()}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Action buttons */}
          <Animated.View style={[styles.actionsContainer, { opacity: contentOpacity }]}>
            {/* Share button */}
            <TouchableOpacity
              style={[styles.actionButton, styles.primaryAction]}
              onPress={handleShare}
              activeOpacity={0.7}
              hitSlop={{ top: 16, bottom: 16, left: 12, right: 12 }}
              accessibilityRole="button"
              accessibilityLabel="Share card"
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

const OnboardingShareOverlayWithBoundary = memo(function OnboardingShareOverlayWithBoundary(
  props: OnboardingShareOverlayProps
) {
  const handleError = (error: Error) => {
    logger.error('OnboardingShareOverlay error:', error);
    props.onDismiss();
  };

  return (
    <ErrorBoundary onError={handleError} fallback={null}>
      <OnboardingShareOverlayComponent {...props} />
    </ErrorBoundary>
  );
});

export const OnboardingShareOverlay = OnboardingShareOverlayWithBoundary;

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
  cardInner: {
    width: ONBOARDING_SHARE_CARD_WIDTH,
    height: ONBOARDING_SHARE_CARD_HEIGHT,
    backgroundColor: colors.warmCream,
    borderRadius: 24,
    overflow: 'hidden',
    borderColor: colors.sunsetGold,
    borderWidth: 2,
  },
  pagination: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 24,
    marginBottom: 12,
    gap: 32,
  },
  paginationDotContainer: {
    alignItems: 'center',
    gap: 6,
  },
  paginationDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
  },
  paginationDotActive: {
    backgroundColor: colors.sunsetGold,
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  paginationLabel: {
    fontFamily: fonts.openSans.regular,
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.5)',
  },
  paginationLabelActive: {
    fontFamily: fonts.openSans.semiBold,
    color: colors.warmCream,
  },
  actionsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
    gap: 40,
  },
  actionButton: {
    alignItems: 'center',
  },
  primaryAction: {
    // Primary action styling handled via child styles
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
