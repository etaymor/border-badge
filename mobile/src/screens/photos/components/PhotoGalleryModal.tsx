/**
 * PhotoGalleryModal - Full-screen gallery overlay with photo selection and cluster splitting.
 *
 * Displays photos in a horizontal paged list. Users can:
 * - Swipe between photos
 * - Toggle photo inclusion/exclusion for upload
 * - Split a cluster at the current photo position
 */

import { useCallback } from 'react';
import { Dimensions, FlatList, Modal, Pressable, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';

import { colors } from '@constants/colors';
import { styles } from '../photoImportStyles';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export interface PhotoGalleryModalProps {
  /** Gallery data: cluster ID, photo list, and initial index */
  previewGallery: {
    clusterId: string;
    photos: { id: string; uri: string }[];
    initialIndex: number;
  };
  /** Close the gallery */
  onClose: () => void;
  /** Current gallery page index */
  currentGalleryIndex: number;
  /** Update the gallery page index */
  onGalleryIndexChange: (index: number) => void;
  /** Map of cluster ID -> Set of excluded photo IDs */
  excludedPhotoIds: Map<string, Set<string>>;
  /** Toggle a photo's inclusion/exclusion */
  onTogglePhotoSelection: (clusterId: string, photoId: string) => void;
  /** Split cluster into two groups at the current position */
  onSplitCluster: (clusterId: string, groupA: string[], groupB: string[]) => void;
}

export function PhotoGalleryModal({
  previewGallery,
  onClose,
  currentGalleryIndex,
  onGalleryIndexChange,
  excludedPhotoIds,
  onTogglePhotoSelection,
  onSplitCluster,
}: PhotoGalleryModalProps) {
  const handleSplit = useCallback(() => {
    const photos = previewGallery.photos;
    const clusterId = previewGallery.clusterId;
    const groupA = photos.slice(0, currentGalleryIndex).map((p) => p.id);
    const groupB = photos.slice(currentGalleryIndex).map((p) => p.id);
    onClose();
    onSplitCluster(clusterId, groupA, groupB);
  }, [previewGallery, currentGalleryIndex, onClose, onSplitCluster]);

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <View style={styles.overlayBackground}>
        <TouchableOpacity style={styles.closeButton} onPress={onClose}>
          <Ionicons name="close" size={28} color={colors.white} />
        </TouchableOpacity>

        <View style={styles.galleryContainer}>
          <FlatList
            data={previewGallery.photos}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            initialScrollIndex={previewGallery.initialIndex}
            getItemLayout={(_, index) => ({
              length: SCREEN_WIDTH,
              offset: SCREEN_WIDTH * index,
              index,
            })}
            keyExtractor={(item) => item.id}
            onMomentumScrollEnd={(e) => {
              const index = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
              onGalleryIndexChange(index);
            }}
            renderItem={({ item }) => {
              const isExcluded =
                excludedPhotoIds.get(previewGallery.clusterId)?.has(item.id) ?? false;
              const isSelected = !isExcluded;

              return (
                <View
                  style={{
                    width: SCREEN_WIDTH,
                    height: '100%',
                  }}
                >
                  <Pressable
                    onPress={onClose}
                    style={{
                      flex: 1,
                      justifyContent: 'center',
                      alignItems: 'center',
                    }}
                  >
                    <Image
                      source={{ uri: item.uri }}
                      style={styles.fullPreview}
                      contentFit="contain"
                    />
                  </Pressable>

                  {/* Dimming overlay for deselected photos */}
                  {!isSelected && (
                    <View style={styles.galleryDeselectedOverlay} pointerEvents="none" />
                  )}

                  {/* Selection toggle */}
                  <Pressable
                    style={styles.gallerySelectionToggle}
                    onPress={() => onTogglePhotoSelection(previewGallery.clusterId, item.id)}
                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  >
                    <View
                      style={[styles.galleryCheckbox, isSelected && styles.galleryCheckboxSelected]}
                    >
                      {isSelected && <Ionicons name="checkmark" size={16} color={colors.white} />}
                    </View>
                  </Pressable>
                </View>
              );
            }}
          />
        </View>

        {/* Gallery Bottom Bar: Counter + Split */}
        <View style={styles.galleryBottomBar}>
          <View style={styles.galleryCounter}>
            <Text style={styles.galleryCounterText}>
              {(() => {
                const total = previewGallery.photos.length;
                const excluded = excludedPhotoIds.get(previewGallery.clusterId)?.size ?? 0;
                const selected = total - excluded;
                if (excluded > 0) {
                  return `${selected} of ${total} selected`;
                }
                return `${currentGalleryIndex + 1} / ${total}`;
              })()}
            </Text>
          </View>

          {previewGallery.photos.length >= 4 &&
            currentGalleryIndex > 0 &&
            currentGalleryIndex < previewGallery.photos.length - 1 && (
              <TouchableOpacity style={styles.gallerySplitButton} onPress={handleSplit}>
                <Text style={styles.gallerySplitButtonText}>Split here</Text>
              </TouchableOpacity>
            )}
        </View>
      </View>
    </Modal>
  );
}
