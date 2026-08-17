import { useCallback, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  Dimensions,
  FlatList,
  Image,
  Modal,
  PanResponder,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
  StatusBar,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Reanimated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import type { MediaFile } from '@hooks/useMedia';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const DISMISS_THRESHOLD = 150;

/** Pinching in past this magnification clamps rather than blowing out. */
const MAX_ZOOM_SCALE = 4;
/** Critically-damped-ish settle for the zoom/pan release. */
const RELEASE_SPRING = { damping: 20, stiffness: 220 };

interface PinchZoomViewProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  testID?: string;
}

/**
 * PinchZoomView - the app's single pinch-to-zoom surface, shared by this
 * viewer's photo items and the quiz PhotoInspector (Unit 1.2).
 *
 * Instagram-style inspection: the pinch magnifies while the fingers are down
 * (clamped 1x..MAX_ZOOM_SCALE) and a two-finger drag pans the zoomed photo;
 * releasing springs everything back to the fitted frame. Because zoom only
 * persists under the fingers, single-finger touches are never claimed here -
 * they fall through to whatever the host surface does with them (this viewer's
 * swipe-to-dismiss, the inspector's tap-to-close).
 */
export function PinchZoomView({ children, style, accessibilityLabel, testID }: PinchZoomViewProps) {
  const scale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);

  const pinch = Gesture.Pinch()
    .onUpdate((event) => {
      scale.value = Math.min(Math.max(event.scale, 1), MAX_ZOOM_SCALE);
    })
    .onEnd(() => {
      scale.value = withSpring(1, RELEASE_SPRING);
    });

  // Two pointers only: panning happens while pinch-zoomed (fingers down), and
  // a single-finger drag stays with the host surface.
  const pan = Gesture.Pan()
    .minPointers(2)
    .onUpdate((event) => {
      if (scale.value > 1) {
        translateX.value = event.translationX;
        translateY.value = event.translationY;
      }
    })
    .onEnd(() => {
      translateX.value = withSpring(0, RELEASE_SPRING);
      translateY.value = withSpring(0, RELEASE_SPRING);
    });

  const zoomStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: scale.value },
      { translateX: translateX.value },
      { translateY: translateY.value },
    ],
  }));

  return (
    <GestureDetector gesture={Gesture.Simultaneous(pinch, pan)}>
      <Reanimated.View
        style={[style, zoomStyle]}
        accessible={true}
        accessibilityRole="image"
        accessibilityLabel={accessibilityLabel}
        testID={testID}
      >
        {children}
      </Reanimated.View>
    </GestureDetector>
  );
}

interface MediaViewerProps {
  visible: boolean;
  media: MediaFile[];
  initialIndex?: number;
  onClose: () => void;
  onDelete?: (mediaId: string) => void;
}

interface MediaItemProps {
  item: MediaFile;
}

function MediaItem({ item }: MediaItemProps) {
  return (
    <View style={styles.mediaItemContainer}>
      <PinchZoomView
        style={styles.imageContainer}
        accessibilityLabel="Photo. Swipe up or down to dismiss, pinch to zoom"
      >
        <Image source={{ uri: item.url }} style={styles.fullImage} resizeMode="contain" />
      </PinchZoomView>
    </View>
  );
}

export function MediaViewer({
  visible,
  media,
  initialIndex = 0,
  onClose,
  onDelete,
}: MediaViewerProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const flatListRef = useRef<FlatList>(null);
  const dismissY = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;

  // Handle swipe to dismiss
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) => {
        return Math.abs(gestureState.dy) > 10 && Math.abs(gestureState.dx) < 50;
      },
      onPanResponderMove: (_, gestureState) => {
        dismissY.setValue(gestureState.dy);
        const progress = Math.min(Math.abs(gestureState.dy) / DISMISS_THRESHOLD, 1);
        opacity.setValue(1 - progress * 0.5);
      },
      onPanResponderRelease: (_, gestureState) => {
        if (Math.abs(gestureState.dy) > DISMISS_THRESHOLD) {
          // Dismiss
          Animated.parallel([
            Animated.timing(dismissY, {
              toValue: gestureState.dy > 0 ? SCREEN_HEIGHT : -SCREEN_HEIGHT,
              duration: 200,
              useNativeDriver: true,
            }),
            Animated.timing(opacity, {
              toValue: 0,
              duration: 200,
              useNativeDriver: true,
            }),
          ]).start(() => {
            onClose();
            dismissY.setValue(0);
            opacity.setValue(1);
          });
        } else {
          // Reset
          Animated.parallel([
            Animated.spring(dismissY, { toValue: 0, useNativeDriver: true }),
            Animated.spring(opacity, { toValue: 1, useNativeDriver: true }),
          ]).start();
        }
      },
    })
  ).current;

  const handleScroll = useCallback((event: { nativeEvent: { contentOffset: { x: number } } }) => {
    const index = Math.round(event.nativeEvent.contentOffset.x / SCREEN_WIDTH);
    setCurrentIndex(index);
  }, []);

  const handleDelete = useCallback(() => {
    if (!onDelete || media.length === 0) return;

    const mediaToDelete = media[currentIndex];
    onDelete(mediaToDelete.id);

    // If this was the last image, close the viewer
    if (media.length === 1) {
      onClose();
    }
  }, [currentIndex, media, onDelete, onClose]);

  const renderItem = useCallback(({ item }: { item: MediaFile }) => <MediaItem item={item} />, []);

  const currentMedia = media[currentIndex];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
      accessibilityViewIsModal={true}
    >
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      {/* RN Modals mount outside the app's GestureHandlerRootView, so the
          pinch surface needs its own root here (Android requirement). */}
      <GestureHandlerRootView style={styles.gestureRoot}>
        <Animated.View style={[styles.container, { opacity }]} {...panResponder.panHandlers}>
          <Animated.View style={[styles.content, { transform: [{ translateY: dismissY }] }]}>
            {/* Header */}
            <SafeAreaView style={styles.header}>
              <Pressable
                style={styles.closeButton}
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Close image viewer"
              >
                <Ionicons name="close" size={28} color="#fff" />
              </Pressable>

              <Text
                style={styles.counter}
                accessibilityRole="text"
                accessibilityLabel={`Image ${currentIndex + 1} of ${media.length}`}
              >
                {currentIndex + 1} / {media.length}
              </Text>

              {onDelete && (
                <Pressable
                  style={styles.deleteButton}
                  onPress={handleDelete}
                  accessibilityRole="button"
                  accessibilityLabel="Delete this image"
                >
                  <Ionicons name="trash-outline" size={24} color="#fff" />
                </Pressable>
              )}
            </SafeAreaView>

            {/* Image Gallery */}
            <FlatList
              ref={flatListRef}
              data={media}
              keyExtractor={(item) => item.id}
              renderItem={renderItem}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              initialScrollIndex={initialIndex}
              getItemLayout={(_, index) => ({
                length: SCREEN_WIDTH,
                offset: SCREEN_WIDTH * index,
                index,
              })}
              onMomentumScrollEnd={handleScroll}
            />

            {/* Footer with metadata */}
            {currentMedia && (
              <SafeAreaView style={styles.footer}>
                {currentMedia.created_at && (
                  <Text style={styles.dateText}>
                    {new Date(currentMedia.created_at).toLocaleDateString('en-US', {
                      month: 'long',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </Text>
                )}
              </SafeAreaView>
            )}
          </Animated.View>
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  gestureRoot: {
    flex: 1,
  },
  container: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
  },
  content: {
    flex: 1,
  },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
    zIndex: 10,
  },
  closeButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  counter: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  deleteButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  mediaItemContainer: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
  },
  imageContainer: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT * 0.7,
  },
  fullImage: {
    width: '100%',
    height: '100%',
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingBottom: 20,
    alignItems: 'center',
  },
  dateText: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 14,
  },
});
