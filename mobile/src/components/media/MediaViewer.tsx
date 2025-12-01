import { useCallback, useRef, useState } from 'react';
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
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { MediaFile } from '@hooks/useMedia';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const DISMISS_THRESHOLD = 150;

interface MediaViewerProps {
  visible: boolean;
  media: MediaFile[];
  initialIndex?: number;
  onClose: () => void;
  onDelete?: (mediaId: string) => void;
}

interface MediaItemProps {
  item: MediaFile;
  isActive: boolean;
}

function MediaItem({ item, isActive }: MediaItemProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;

  // Simple pinch-to-zoom implementation
  const baseScale = useRef(1);
  const pinchScale = useRef(new Animated.Value(1)).current;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        baseScale.current = 1;
      },
      onPanResponderMove: (_, gestureState) => {
        // Simple pan when zoomed
        if (baseScale.current > 1) {
          translateX.setValue(gestureState.dx);
          translateY.setValue(gestureState.dy);
        }
      },
      onPanResponderRelease: () => {
        // Reset position
        Animated.parallel([
          Animated.spring(translateX, { toValue: 0, useNativeDriver: true }),
          Animated.spring(translateY, { toValue: 0, useNativeDriver: true }),
        ]).start();
      },
    })
  ).current;

  return (
    <View style={styles.mediaItemContainer}>
      <Animated.View
        style={[
          styles.imageContainer,
          {
            transform: [
              { scale: Animated.multiply(scale, pinchScale) },
              { translateX },
              { translateY },
            ],
          },
        ]}
        {...panResponder.panHandlers}
      >
        <Image source={{ uri: item.url }} style={styles.fullImage} resizeMode="contain" />
      </Animated.View>
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

  const handleScroll = useCallback((event: any) => {
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

  const renderItem = useCallback(
    ({ item, index }: { item: MediaFile; index: number }) => (
      <MediaItem item={item} isActive={index === currentIndex} />
    ),
    [currentIndex]
  );

  const currentMedia = media[currentIndex];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      <Animated.View style={[styles.container, { opacity }]} {...panResponder.panHandlers}>
        <Animated.View style={[styles.content, { transform: [{ translateY: dismissY }] }]}>
          {/* Header */}
          <SafeAreaView style={styles.header}>
            <Pressable style={styles.closeButton} onPress={onClose}>
              <Ionicons name="close" size={28} color="#fff" />
            </Pressable>

            <Text style={styles.counter}>
              {currentIndex + 1} / {media.length}
            </Text>

            {onDelete && (
              <Pressable style={styles.deleteButton} onPress={handleDelete}>
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
    </Modal>
  );
}

const styles = StyleSheet.create({
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
