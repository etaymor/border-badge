/**
 * Full-screen overlay modal for onboarding share cards.
 * Includes swipeable carousel of three card variants, sharing, and save functionality.
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

  // Scale to fit screen while keeping aspect ratio; keep it smaller to avoid clipping
  const availableWidth = screenWidth - 32;
  const availableHeight = screenHeight - insets.top - insets.bottom - 320;
  const rawScale = Math.min(
    availableWidth / ONBOARDING_SHARE_CARD_WIDTH,
    availableHeight / ONBOARDING_SHARE_CARD_HEIGHT
  );
  const displayScale = Math.max(0.45, Math.min(0.8, Number.isFinite(rawScale) ? rawScale : 0.7));
  const scaledCardWidth = ONBOARDING_SHARE_CARD_WIDTH * displayScale;
  const scaledCardHeight = ONBOARDING_SHARE_CARD_HEIGHT * displayScale;

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

  const CARD_VARIANTS: OnboardingShareVariant[] = ['stamps', 'stats', 'map'];
  const variant = CARD_VARIANTS[currentIndex];

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

        {/* Content - stop propagation to prevent dismiss on card tap */}
        <Pressable onPress={(e) => e.stopPropagation()}>
          <Animated.View
            style={[
              styles.content,
              {
                opacity: contentOpacity,
                paddingTop: insets.top + 60,
                paddingBottom: insets.bottom + 40,
              },
            ]}
          >
            {/* Close button */}
            <TouchableOpacity
              style={[styles.closeButton, { top: insets.top + 16 }]}
              onPress={handleDismiss}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityRole="button"
              accessibilityLabel="Close share overlay"
            >
              <Ionicons name="close" size={28} color={colors.warmCream} />
            </TouchableOpacity>

            {/* Centered single card preview (still switches variants via dots) */}
            <View style={styles.cardContainerArea}>
              <View
                style={[
                  styles.cardWrapper,
                  {
                    width: scaledCardWidth + 32,
                    height: scaledCardHeight + 220,
                    justifyContent: 'flex-start',
                  },
                ]}
              >
                <View style={styles.cardSpacer} />
                <View
                  style={{
                    width: scaledCardWidth,
                    height: scaledCardHeight,
                    alignItems: 'center',
                    justifyContent: 'center',
                    shadowColor: colors.black,
                    shadowOffset: { width: 0, height: 12 },
                    shadowOpacity: 0.25,
                    shadowRadius: 18,
                  }}
                >
                  <ViewShot
                    ref={(ref) => {
                      viewShotRefs.current[0] = ref;
                    }}
                    options={{
                      format: 'png',
                      quality: 0.95,
                      width: 1080,
                      height: 1920,
                      result: 'tmpfile',
                    }}
                    style={[
                      styles.cardInner,
                      {
                        transform: [{ scale: displayScale }],
                      },
                    ]}
                  >
                    <OnboardingShareCard variant={variant} context={context} />
                  </ViewShot>
                </View>
              </View>
            </View>

            {/* Pagination dots */}
            <View style={styles.pagination}>
              {CARD_VARIANTS.map((v, index) => (
                <TouchableOpacity
                  key={v}
                  onPress={() => setCurrentIndex(index)}
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
                    {v.toUpperCase()}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Action buttons */}
            <View style={[styles.actionsContainer, { paddingBottom: insets.bottom + 36 }]}>
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
            </View>
          </Animated.View>
        </Pressable>
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
  cardContainerArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardSpacer: {
    height: 60,
  },
  cardShell: {
    width: ONBOARDING_SHARE_CARD_WIDTH,
    height: ONBOARDING_SHARE_CARD_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardInner: {
    width: ONBOARDING_SHARE_CARD_WIDTH,
    height: ONBOARDING_SHARE_CARD_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.warmCream,
    borderRadius: 24,
    overflow: 'hidden',
    borderColor: colors.sunsetGold,
    borderWidth: 2,
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.3,
    shadowRadius: 18,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(23, 42, 58, 0.95)',
  },
  content: {
    flex: 1,
  },
  closeButton: {
    position: 'absolute',
    right: 20,
    zIndex: 10,
    padding: 8,
  },
  carousel: {
    flexGrow: 0,
  },
  carouselContent: {
    alignItems: 'center',
  },
  cardWrapper: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardContainer: {
    // Removed specific shadow styles from here as they are now inline in the renderItem
    // to separate shadow/layout from ViewShot
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
