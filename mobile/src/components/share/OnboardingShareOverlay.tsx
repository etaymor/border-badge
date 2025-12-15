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
  FlatList,
  Modal,
  Pressable,
  Share,
  StyleSheet,
  TouchableOpacity,
  useWindowDimensions,
  View,
  type ListRenderItemInfo,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ViewShot from 'react-native-view-shot';

import { ErrorBoundary, Text } from '@components/ui';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { logger } from '@utils/logger';

import {
  OnboardingShareCard,
  type OnboardingShareContext,
  type OnboardingShareVariant,
} from './OnboardingShareCard';

/** Horizontal padding on each side of the card */
const CARD_HORIZONTAL_PADDING = 24;

/** Total horizontal padding (both sides) */
const CARD_TOTAL_HORIZONTAL_PADDING = CARD_HORIZONTAL_PADDING * 2;

/** Vertical margin above and below the card */
const CARD_VERTICAL_MARGIN = 140;

const CARD_VARIANTS: OnboardingShareVariant[] = ['stamps', 'stats', 'map'];

const VARIANT_LABELS: Record<OnboardingShareVariant, string> = {
  stamps: 'Stamps',
  stats: 'Stats',
  map: 'Map',
};

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
  const flatListRef = useRef<FlatList>(null);

  // Animation values
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const contentOpacity = useRef(new Animated.Value(0)).current;

  // Card now renders at mobile size (375x666), calculate display size
  const availableWidth = screenWidth - CARD_TOTAL_HORIZONTAL_PADDING;
  const availableHeight = screenHeight - insets.top - insets.bottom - CARD_VERTICAL_MARGIN;

  // Scale to fit within available space while maintaining 9:16 aspect ratio
  const widthBasedHeight = (availableWidth * 16) / 9;
  const scaledCardWidth = widthBasedHeight <= availableHeight
    ? availableWidth
    : (availableHeight * 9) / 16;
  const scaledCardHeight = (scaledCardWidth * 16) / 9;

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
      setCurrentIndex(0);
    }
  }, [visible, context, backdropOpacity, contentOpacity]);

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

  // Handle scroll to update current index
  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const offsetX = event.nativeEvent.contentOffset.x;
      const index = Math.round(offsetX / scaledCardWidth);
      if (index !== currentIndex && index >= 0 && index < CARD_VARIANTS.length) {
        setCurrentIndex(index);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    },
    [currentIndex, scaledCardWidth]
  );

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

  // Render a single card
  const renderCard = useCallback(
    ({ item, index }: ListRenderItemInfo<OnboardingShareVariant>) => {
      if (!context) return null;

      return (
        <View
          style={[
            styles.cardWrapper,
            {
              width: scaledCardWidth,
              paddingHorizontal: CARD_HORIZONTAL_PADDING,
            },
          ]}
        >
          <ViewShot
            ref={(ref) => {
              viewShotRefs.current[index] = ref;
            }}
            options={{
              format: 'png',
              quality: 1,
              width: 1080,
              height: 1920,
            }}
            style={[
              styles.cardContainer,
              {
                width: scaledCardWidth - CARD_HORIZONTAL_PADDING * 2,
                height: scaledCardHeight,
              },
            ]}
          >
            <OnboardingShareCard variant={item} context={context} />
          </ViewShot>
        </View>
      );
    },
    [context, scaledCardWidth, scaledCardHeight]
  );

  // Key extractor
  const keyExtractor = useCallback((item: OnboardingShareVariant) => item, []);

  // Get item layout for optimized scrolling
  const getItemLayout = useCallback(
    (_: unknown, index: number) => ({
      length: scaledCardWidth,
      offset: scaledCardWidth * index,
      index,
    }),
    [scaledCardWidth]
  );

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

        {/* Content - stop propagation to prevent dismiss on card tap */}
        <Pressable onPress={(e) => e.stopPropagation()}>
          <Animated.View style={[styles.content, { opacity: contentOpacity }]}>
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

            {/* Card carousel */}
            <FlatList
              ref={flatListRef}
              data={CARD_VARIANTS}
              renderItem={renderCard}
              keyExtractor={keyExtractor}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onScroll={handleScroll}
              scrollEventThrottle={16}
              getItemLayout={getItemLayout}
              snapToInterval={scaledCardWidth}
              decelerationRate="fast"
              style={[
                styles.carousel,
                {
                  marginTop: insets.top + 60,
                  height: scaledCardHeight,
                },
              ]}
              contentContainerStyle={styles.carouselContent}
            />

            {/* Pagination dots */}
            <View style={styles.pagination}>
              {CARD_VARIANTS.map((variant, index) => (
                <TouchableOpacity
                  key={variant}
                  onPress={() => {
                    flatListRef.current?.scrollToIndex({ index, animated: true });
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
                    {VARIANT_LABELS[variant]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Action buttons */}
            <View style={[styles.actionsContainer, { paddingBottom: insets.bottom + 24 }]}>
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
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.4,
    shadowRadius: 24,
    elevation: 20,
  },
  pagination: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 24,
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
    marginTop: 32,
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
