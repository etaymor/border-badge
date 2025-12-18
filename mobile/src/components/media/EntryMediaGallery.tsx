import { useCallback, useEffect, useRef, useState } from 'react';
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
import { BlurView } from 'expo-blur';

import {
  useEntryMedia,
  usePendingTripMedia,
  useUploadMedia,
  useDeleteMedia,
  useRetryUpload,
  MediaFile,
} from '@hooks/useMedia';
import { pickImages, LocalFile, MAX_PHOTOS_PER_ENTRY } from '@services/mediaUpload';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { logger } from '@utils/logger';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const ITEM_SIZE = (SCREEN_WIDTH - 48 - 16) / 3; // 3 columns with gaps

interface EntryMediaGalleryProps {
  entryId?: string; // Optional - not available during creation
  tripId?: string; // Required if entryId not provided (for pending uploads)
  editable?: boolean;
  onImagePress?: (media: MediaFile, index: number) => void;
  onPendingMediaChange?: (mediaIds: string[]) => void; // Track IDs for later reassignment
  onMediaCountChange?: (count: number) => void; // Notify parent of current photo count
}

interface LocalMediaItem {
  localUri: string;
  file: LocalFile;
  uploading: boolean;
  progress: number;
  error?: string;
  mediaId?: string; // Set after successful upload
}

export function EntryMediaGallery({
  entryId,
  tripId,
  editable = true,
  onImagePress,
  onPendingMediaChange,
  onMediaCountChange,
}: EntryMediaGalleryProps) {
  // Use entry media when editing, pending trip media when creating
  const isPendingMode = !entryId && !!tripId;

  const { data: entryMediaFiles, isLoading: isLoadingEntry } = useEntryMedia(entryId || '');
  const { data: pendingMediaFiles, isLoading: isLoadingPending } = usePendingTripMedia(
    tripId || '',
    isPendingMode
  );

  const mediaFiles = isPendingMode ? pendingMediaFiles : entryMediaFiles;
  const isLoading = isPendingMode ? isLoadingPending : isLoadingEntry;

  const uploadMedia = useUploadMedia();
  const deleteMedia = useDeleteMedia();
  const retryUpload = useRetryUpload();

  const [localMedia, setLocalMedia] = useState<LocalMediaItem[]>([]);
  const [isPickerOpen, setIsPickerOpen] = useState(false);

  // Track last progress update time per file to throttle re-renders
  const lastProgressUpdateRef = useRef<Map<string, number>>(new Map());
  const PROGRESS_UPDATE_INTERVAL = 150; // ms - throttle progress updates

  // Clean up progress tracking on unmount to prevent memory leaks
  useEffect(() => {
    const progressMap = lastProgressUpdateRef.current;
    return () => {
      progressMap.clear();
    };
  }, []);

  // Track pending media IDs for parent component
  useEffect(() => {
    if (isPendingMode && onPendingMediaChange) {
      const serverMediaIds = (mediaFiles || []).map((m) => m.id);
      const localMediaIds = localMedia.filter((m) => m.mediaId).map((m) => m.mediaId!);
      onPendingMediaChange([...serverMediaIds, ...localMediaIds]);
    }
  }, [isPendingMode, mediaFiles, localMedia, onPendingMediaChange]);

  // Once pending media is persisted and fetched from server, drop local copies to avoid duplicates
  useEffect(() => {
    if (!isPendingMode || !mediaFiles) return;
    setLocalMedia((prev) =>
      prev.filter((item) => !(item.mediaId && mediaFiles.some((m) => m.id === item.mediaId)))
    );
  }, [isPendingMode, mediaFiles]);

  const currentCount = (mediaFiles?.length ?? 0) + localMedia.filter((m) => !m.error).length;
  const remainingSlots = MAX_PHOTOS_PER_ENTRY - currentCount;

  // Notify parent of media count changes
  useEffect(() => {
    onMediaCountChange?.(currentCount);
  }, [currentCount, onMediaCountChange]);

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
          const result = await uploadMedia.mutateAsync({
            entryId: isPendingMode ? undefined : entryId,
            tripId: isPendingMode ? tripId : undefined,
            file,
            onProgress: (progress) => {
              // Throttle progress updates to reduce re-renders
              const now = Date.now();
              const lastUpdate = lastProgressUpdateRef.current.get(file.uri) ?? 0;
              const shouldUpdate =
                now - lastUpdate >= PROGRESS_UPDATE_INTERVAL ||
                progress.percentage === 100; // Always update on completion

              if (shouldUpdate) {
                lastProgressUpdateRef.current.set(file.uri, now);
                setLocalMedia((prev) =>
                  prev.map((item) =>
                    item.localUri === file.uri ? { ...item, progress: progress.percentage } : item
                  )
                );
              }
            },
          });

          // Clean up progress tracking for this file
          lastProgressUpdateRef.current.delete(file.uri);

          // In pending mode, keep the local placeholder with the new media ID until server fetch
          if (isPendingMode) {
            setLocalMedia((prev) =>
              prev.map((item) =>
                item.localUri === file.uri
                  ? { ...item, mediaId: result.id, uploading: false, progress: 100 }
                  : item
              )
            );
          } else {
            // Remove from local state on success (server has it now)
            setLocalMedia((prev) => prev.filter((item) => item.localUri !== file.uri));
          }
        } catch {
          // Clean up progress tracking for this file
          lastProgressUpdateRef.current.delete(file.uri);

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
      logger.error('Failed to pick images:', error);
      if ((error as Error).message.includes('denied')) {
        Alert.alert('Permission Required', 'Please allow photo library access in Settings.');
      }
    } finally {
      setIsPickerOpen(false);
    }
  }, [entryId, tripId, isPendingMode, remainingSlots, uploadMedia]);

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
        const result = await uploadMedia.mutateAsync({
          entryId: isPendingMode ? undefined : entryId,
          tripId: isPendingMode ? tripId : undefined,
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

        // Clean up progress tracking for this file
        lastProgressUpdateRef.current.delete(localItem.localUri);

        if (isPendingMode) {
          setLocalMedia((prev) =>
            prev.map((item) =>
              item.localUri === localItem.localUri
                ? { ...item, mediaId: result.id, uploading: false, progress: 100 }
                : item
            )
          );
        } else {
          setLocalMedia((prev) => prev.filter((item) => item.localUri !== localItem.localUri));
        }
      } catch {
        // Clean up progress tracking for this file
        lastProgressUpdateRef.current.delete(localItem.localUri);

        setLocalMedia((prev) =>
          prev.map((item) =>
            item.localUri === localItem.localUri
              ? { ...item, uploading: false, error: 'Upload failed' }
              : item
          )
        );
      }
    },
    [entryId, tripId, isPendingMode, uploadMedia]
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
          <View style={styles.overlay} pointerEvents="box-none">
            <Ionicons name="alert-circle" size={24} color={colors.adobeBrick} />
            <Pressable
              style={styles.retryButton}
              onPress={() => retryUpload.mutate(media.id)}
              hitSlop={8}
            >
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        )}

        {editable && media.status === 'uploaded' && (
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
          <View style={styles.overlay} pointerEvents="box-none">
            <Ionicons name="alert-circle" size={24} color={colors.adobeBrick} />
            <View style={styles.failedActions}>
              <Pressable style={styles.retryButton} onPress={() => handleRetry(item)} hitSlop={8}>
                <Text style={styles.retryText}>Retry</Text>
              </Pressable>
              <Pressable
                style={styles.removeButton}
                onPress={() => handleRemoveFailed(item.localUri)}
                hitSlop={8}
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
        <ActivityIndicator size="small" color={colors.sunsetGold} />
      </View>
    );
  }

  const hasMedia = (mediaFiles?.length ?? 0) > 0 || localMedia.length > 0;

  return (
    <View style={styles.container}>
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
                <Ionicons name="add" size={32} color={colors.midnightNavy} />
              </Pressable>
            )}
          </View>
        </ScrollView>
      ) : (
        <View style={styles.emptyState}>
          {editable ? (
            <Pressable
              style={styles.emptyButton}
              onPress={handlePickImages}
              disabled={isPickerOpen}
            >
              <BlurView intensity={20} tint="light" style={styles.emptyBlurView}>
                <View style={styles.emptyContent}>
                  <View style={styles.iconCircle}>
                    <Ionicons name="image-outline" size={28} color={colors.midnightNavy} />
                  </View>
                  <Text style={styles.emptyButtonText}>Choose Photos</Text>
                  <Text style={styles.emptyHint}>Tap to add memories</Text>
                </View>
              </BlurView>
            </Pressable>
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
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: colors.backgroundMuted,
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
    fontFamily: fonts.openSans.semiBold,
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
    backgroundColor: colors.sunsetGold,
    borderRadius: 8,
  },
  retryText: {
    color: colors.midnightNavy,
    fontSize: 12,
    fontFamily: fonts.openSans.semiBold,
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
    borderRadius: 8,
  },
  removeText: {
    color: '#fff',
    fontSize: 12,
    fontFamily: fonts.openSans.semiBold,
  },
  addButton: {
    width: ITEM_SIZE,
    height: ITEM_SIZE,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: 'rgba(244, 194, 78, 0.4)', // Sunset Gold faded
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(244, 194, 78, 0.1)', // Light Sunset Gold
  },
  emptyState: {
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.05)',
  },
  emptyButton: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  emptyBlurView: {
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 28,
  },
  emptyContent: {
    alignItems: 'center',
    gap: 6,
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(244, 194, 78, 0.1)', // Light Sunset Gold
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  emptyButtonText: {
    color: colors.midnightNavy,
    fontSize: 16,
    fontFamily: fonts.playfair.bold,
  },
  emptyHint: {
    color: colors.textSecondary,
    fontSize: 13,
    fontFamily: fonts.openSans.regular,
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: 14,
    fontFamily: fonts.openSans.regular,
    paddingVertical: 24,
    textAlign: 'center',
  },
});
