import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import {
  useEntryMedia,
  useUploadMedia,
  useDeleteMedia,
  useRetryUpload,
  MediaFile,
} from '@hooks/useMedia';
import { pickImages, takePhoto, LocalFile, MAX_PHOTOS_PER_ENTRY } from '@services/mediaUpload';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const ITEM_SIZE = (SCREEN_WIDTH - 48 - 16) / 3; // 3 columns with gaps

interface EntryMediaGalleryProps {
  entryId: string;
  editable?: boolean;
  onImagePress?: (media: MediaFile, index: number) => void;
}

interface LocalMediaItem {
  localUri: string;
  file: LocalFile;
  uploading: boolean;
  progress: number;
  error?: string;
}

export function EntryMediaGallery({
  entryId,
  editable = true,
  onImagePress,
}: EntryMediaGalleryProps) {
  const { data: mediaFiles, isLoading } = useEntryMedia(entryId);
  const uploadMedia = useUploadMedia();
  const deleteMedia = useDeleteMedia();
  const retryUpload = useRetryUpload();

  const [localMedia, setLocalMedia] = useState<LocalMediaItem[]>([]);
  const [isPickerOpen, setIsPickerOpen] = useState(false);

  const currentCount = (mediaFiles?.length ?? 0) + localMedia.filter((m) => !m.error).length;
  const remainingSlots = MAX_PHOTOS_PER_ENTRY - currentCount;

  // Handle picking images from library
  const handlePickImages = useCallback(async () => {
    if (remainingSlots <= 0) {
      Alert.alert('Limit Reached', `Maximum ${MAX_PHOTOS_PER_ENTRY} photos per entry.`);
      return;
    }

    setIsPickerOpen(true);
    try {
      const files = await pickImages({ maxCount: remainingSlots });

      if (files.length === 0) return;

      // Add to local state
      const newLocalMedia: LocalMediaItem[] = files.map((file) => ({
        localUri: file.uri,
        file,
        uploading: true,
        progress: 0,
      }));

      setLocalMedia((prev) => [...prev, ...newLocalMedia]);

      // Upload each file
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        try {
          await uploadMedia.mutateAsync({
            entryId,
            file,
            onProgress: (progress) => {
              setLocalMedia((prev) =>
                prev.map((item) =>
                  item.localUri === file.uri ? { ...item, progress: progress.percentage } : item
                )
              );
            },
          });

          // Remove from local state on success
          setLocalMedia((prev) => prev.filter((item) => item.localUri !== file.uri));
        } catch {
          // Mark as failed
          setLocalMedia((prev) =>
            prev.map((item) =>
              item.localUri === file.uri
                ? { ...item, uploading: false, error: 'Upload failed' }
                : item
            )
          );
        }
      }
    } catch (error) {
      console.error('Failed to pick images:', error);
      if ((error as Error).message.includes('denied')) {
        Alert.alert('Permission Required', 'Please allow photo library access in Settings.');
      }
    } finally {
      setIsPickerOpen(false);
    }
  }, [entryId, remainingSlots, uploadMedia]);

  // Handle taking a photo
  const handleTakePhoto = useCallback(async () => {
    if (remainingSlots <= 0) {
      Alert.alert('Limit Reached', `Maximum ${MAX_PHOTOS_PER_ENTRY} photos per entry.`);
      return;
    }

    try {
      const file = await takePhoto();
      if (!file) return;

      // Add to local state
      const localItem: LocalMediaItem = {
        localUri: file.uri,
        file,
        uploading: true,
        progress: 0,
      };

      setLocalMedia((prev) => [...prev, localItem]);

      // Upload
      await uploadMedia.mutateAsync({
        entryId,
        file,
        onProgress: (progress) => {
          setLocalMedia((prev) =>
            prev.map((item) =>
              item.localUri === file.uri ? { ...item, progress: progress.percentage } : item
            )
          );
        },
      });

      // Remove from local state on success
      setLocalMedia((prev) => prev.filter((item) => item.localUri !== file.uri));
    } catch (error) {
      console.error('Failed to take photo:', error);
      if ((error as Error).message.includes('denied')) {
        Alert.alert('Permission Required', 'Please allow camera access in Settings.');
      }
    }
  }, [entryId, remainingSlots, uploadMedia]);

  // Handle delete
  const handleDelete = useCallback(
    (mediaId: string) => {
      Alert.alert('Delete Photo', 'Are you sure you want to delete this photo?', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            deleteMedia.mutate(mediaId);
          },
        },
      ]);
    },
    [deleteMedia]
  );

  // Handle retry failed upload
  const handleRetry = useCallback(
    async (localItem: LocalMediaItem) => {
      setLocalMedia((prev) =>
        prev.map((item) =>
          item.localUri === localItem.localUri
            ? { ...item, uploading: true, error: undefined, progress: 0 }
            : item
        )
      );

      try {
        await uploadMedia.mutateAsync({
          entryId,
          file: localItem.file,
          onProgress: (progress) => {
            setLocalMedia((prev) =>
              prev.map((item) =>
                item.localUri === localItem.localUri
                  ? { ...item, progress: progress.percentage }
                  : item
              )
            );
          },
        });

        setLocalMedia((prev) => prev.filter((item) => item.localUri !== localItem.localUri));
      } catch {
        setLocalMedia((prev) =>
          prev.map((item) =>
            item.localUri === localItem.localUri
              ? { ...item, uploading: false, error: 'Upload failed' }
              : item
          )
        );
      }
    },
    [entryId, uploadMedia]
  );

  // Handle remove failed upload
  const handleRemoveFailed = useCallback((localUri: string) => {
    setLocalMedia((prev) => prev.filter((item) => item.localUri !== localUri));
  }, []);

  // Render uploaded media item
  const renderMediaItem = useCallback(
    (media: MediaFile, index: number) => (
      <Pressable
        key={media.id}
        style={styles.mediaItem}
        onPress={() => onImagePress?.(media, index)}
      >
        <Image
          source={{ uri: media.thumbnail_url ?? media.url }}
          style={styles.thumbnail}
          resizeMode="cover"
        />

        {media.status === 'processing' && (
          <View style={styles.overlay}>
            <ActivityIndicator size="small" color="#fff" />
          </View>
        )}

        {media.status === 'failed' && (
          <View style={styles.overlay}>
            <Ionicons name="alert-circle" size={24} color="#FF3B30" />
            <Pressable style={styles.retryButton} onPress={() => retryUpload.mutate(media.id)}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        )}

        {editable && media.status === 'completed' && (
          <Pressable style={styles.deleteButton} onPress={() => handleDelete(media.id)}>
            <Ionicons name="close-circle" size={22} color="#fff" />
          </Pressable>
        )}
      </Pressable>
    ),
    [editable, handleDelete, onImagePress, retryUpload]
  );

  // Render local uploading item
  const renderLocalItem = useCallback(
    (item: LocalMediaItem) => (
      <View key={item.localUri} style={styles.mediaItem}>
        <Image source={{ uri: item.localUri }} style={styles.thumbnail} resizeMode="cover" />

        {item.uploading && !item.error && (
          <View style={styles.overlay}>
            <ActivityIndicator size="small" color="#fff" />
            <Text style={styles.progressText}>{Math.round(item.progress)}%</Text>
          </View>
        )}

        {item.error && (
          <View style={styles.overlay}>
            <Ionicons name="alert-circle" size={24} color="#FF3B30" />
            <View style={styles.failedActions}>
              <Pressable style={styles.retryButton} onPress={() => handleRetry(item)}>
                <Text style={styles.retryText}>Retry</Text>
              </Pressable>
              <Pressable
                style={styles.removeButton}
                onPress={() => handleRemoveFailed(item.localUri)}
              >
                <Text style={styles.removeText}>Remove</Text>
              </Pressable>
            </View>
          </View>
        )}
      </View>
    ),
    [handleRetry, handleRemoveFailed]
  );

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="small" color="#007AFF" />
      </View>
    );
  }

  const hasMedia = (mediaFiles?.length ?? 0) > 0 || localMedia.length > 0;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>
          Photos ({currentCount}/{MAX_PHOTOS_PER_ENTRY})
        </Text>
      </View>

      {hasMedia ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scrollView}>
          <View style={styles.grid}>
            {/* Uploaded media */}
            {mediaFiles?.map((media, index) => renderMediaItem(media, index))}

            {/* Local uploading/failed media */}
            {localMedia.map(renderLocalItem)}

            {/* Add button */}
            {editable && remainingSlots > 0 && (
              <Pressable
                style={styles.addButton}
                onPress={handlePickImages}
                disabled={isPickerOpen}
              >
                <Ionicons name="add" size={32} color="#007AFF" />
              </Pressable>
            )}
          </View>
        </ScrollView>
      ) : (
        <View style={styles.emptyState}>
          {editable ? (
            <View style={styles.emptyActions}>
              <Pressable
                style={styles.emptyButton}
                onPress={handlePickImages}
                disabled={isPickerOpen}
              >
                <Ionicons name="images-outline" size={24} color="#007AFF" />
                <Text style={styles.emptyButtonText}>Choose Photos</Text>
              </Pressable>

              <Pressable style={styles.emptyButton} onPress={handleTakePhoto}>
                <Ionicons name="camera-outline" size={24} color="#007AFF" />
                <Text style={styles.emptyButtonText}>Take Photo</Text>
              </Pressable>
            </View>
          ) : (
            <Text style={styles.emptyText}>No photos</Text>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 8,
  },
  loadingContainer: {
    height: ITEM_SIZE + 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  headerTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#666',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  scrollView: {
    marginHorizontal: -4,
  },
  grid: {
    flexDirection: 'row',
    paddingHorizontal: 4,
    gap: 8,
  },
  mediaItem: {
    width: ITEM_SIZE,
    height: ITEM_SIZE,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#f0f0f0',
  },
  thumbnail: {
    width: '100%',
    height: '100%',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  progressText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
  },
  deleteButton: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    borderRadius: 11,
  },
  retryButton: {
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#007AFF',
    borderRadius: 4,
  },
  retryText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  failedActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  removeButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 4,
  },
  removeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  addButton: {
    width: ITEM_SIZE,
    height: ITEM_SIZE,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#007AFF',
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f8f8f8',
  },
  emptyState: {
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#e0e0e0',
    borderStyle: 'dashed',
    paddingVertical: 24,
    alignItems: 'center',
  },
  emptyActions: {
    flexDirection: 'row',
    gap: 16,
  },
  emptyButton: {
    alignItems: 'center',
    padding: 12,
  },
  emptyButtonText: {
    color: '#007AFF',
    fontSize: 14,
    fontWeight: '500',
    marginTop: 6,
  },
  emptyText: {
    color: '#999',
    fontSize: 14,
  },
});
