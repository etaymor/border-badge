import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Crypto from 'expo-crypto';
import { BlurView } from 'expo-blur';
import { File as ExpoFile } from 'expo-file-system';
import { fetch as expoFetch } from 'expo/fetch';

import { env } from '@config/env';
import { supabase } from '@services/supabase';
import {
  pickImages,
  resizeImageForUpload,
  takePhoto,
  validateFile,
  type LocalFile,
  MediaUploadError,
} from '@services/mediaUpload';
import { resolveLoadableUri } from '@services/photoImport/resolveLoadableUri';
import type { CachedPhoto } from '@services/photoImport/types';
import { useCoverPhotoSuggestions } from '@hooks/useCoverPhotoSuggestions';
import { Analytics } from '@services/analytics';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { logger } from '@utils/logger';

import { CoverSuggestionStrip } from './CoverSuggestionStrip';

/**
 * Bound on the native calls a suggested cover goes through (asset re-resolve,
 * resize). An iCloud-evicted original can leave either pending forever; the
 * caller falls back to the URI/file it already had rather than hanging the
 * form. Same idiom as `withNativeTimeout` in visionPhoto.ts.
 */
const NATIVE_STEP_TIMEOUT_MS = 15_000;

function withNativeTimeout<T>(work: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const watchdog = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${NATIVE_STEP_TIMEOUT_MS}ms`)),
      NATIVE_STEP_TIMEOUT_MS
    );
  });
  return Promise.race([work, watchdog]).finally(() => clearTimeout(timer)) as Promise<T>;
}

function mimeTypeForName(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'heic') return 'image/heic';
  if (ext === 'heif') return 'image/heif';
  return 'image/jpeg';
}

interface CoverImagePickerProps {
  value?: string;
  onChange: (url: string | undefined) => void;
  disabled?: boolean;
  /**
   * ISO 3166-1 alpha-2 for the trip's country. Omit (or pass undefined) and the
   * component is exactly what it was before suggestions existed.
   */
  suggestionCountryCode?: string | null;
  /** Trip window (epoch ms). Applied only when BOTH bounds are present. */
  suggestionStartDateMs?: number | null;
  suggestionEndDateMs?: number | null;
}

export function CoverImagePicker({
  value,
  onChange,
  disabled = false,
  suggestionCountryCode,
  suggestionStartDateMs,
  suggestionEndDateMs,
}: CoverImagePickerProps) {
  const [localUri, setLocalUri] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  /**
   * Which control started the upload that is currently running, read once when
   * it succeeds (U5).
   *
   * A ref rather than state because nothing renders from it, and it is only
   * ever written from an event handler — never during render (CLAUDE.md 10).
   * Success is the only thing worth counting here: `uploadImage` swallows its
   * own failures into the error banner, so awaiting it says nothing.
   */
  const uploadSourceRef = useRef<{
    source: 'suggested' | 'picker' | 'camera';
    chosenIndex: number | null;
  } | null>(null);

  // On-device cover candidates. Empty (and the strip absent) without a country,
  // without a photo cache, or without tags.
  const { photos: suggestions } = useCoverPhotoSuggestions(
    suggestionCountryCode,
    suggestionStartDateMs,
    suggestionEndDateMs
  );

  // Cleanup: abort any in-flight upload on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const uploadImage = useCallback(
    async (file: LocalFile) => {
      // Cancel any in-flight upload and create new controller
      abortControllerRef.current?.abort();
      abortControllerRef.current = new AbortController();
      const signal = abortControllerRef.current.signal;

      setUploading(true);
      setProgress(0);
      setError(null);
      setLocalUri(file.uri);

      try {
        // Validate file
        const validation = validateFile(file);
        if (!validation.valid) {
          throw new MediaUploadError(validation.error!, 'VALIDATION');
        }

        // Get current user
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
          throw new MediaUploadError('Please sign in to upload images', 'PERMISSION');
        }

        setProgress(10);

        // Generate unique file path
        // Path format must be {user_id}/... to satisfy RLS policy
        const fileId = Crypto.randomUUID();
        const ext = file.name.split('.').pop() || 'jpg';
        const filePath = `${user.id}/covers/${fileId}.${ext}`;

        setProgress(20);

        // Create ExpoFile for efficient streaming upload
        const expoFile = new ExpoFile(file.uri);

        // Get session for auth header
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) {
          throw new MediaUploadError('Please sign in to upload images', 'PERMISSION');
        }

        setProgress(30);

        // Upload directly to Supabase storage
        // Using fetch with auth header since supabase-js upload has issues with expo File
        const uploadUrl = `${env.supabaseUrl}/storage/v1/object/media/${filePath}`;

        const response = await expoFetch(uploadUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': file.type,
            'x-upsert': 'true',
          },
          body: expoFile,
          signal,
        });

        if (!response.ok) {
          const errorText = await response.text();
          logger.error('Upload failed:', response.status, errorText);
          throw new MediaUploadError('Failed to upload image', 'UPLOAD');
        }

        // Check if aborted before updating state
        if (signal.aborted) return;

        setProgress(90);

        // Get public URL
        const { data: urlData } = supabase.storage.from('media').getPublicUrl(filePath);

        if (signal.aborted) return;

        setProgress(100);
        setLocalUri(null);
        const started = uploadSourceRef.current;
        uploadSourceRef.current = null;
        if (started) {
          // `candidateCount` of 0 means the strip was never offered (no
          // country, no cache, no tags) — the difference between "not offered"
          // and "offered and ignored" is what this event exists to answer.
          Analytics.tripCoverSuggestionUsed({
            source: started.source,
            candidateCount: suggestions.length,
            chosenIndex: started.chosenIndex,
          });
        }
        onChange(urlData.publicUrl);
      } catch (err) {
        // Silently ignore aborted requests (component unmounted or new upload started)
        if ((err as Error).name === 'AbortError') return;

        logger.error('Cover image upload failed:', err);
        const message =
          err instanceof MediaUploadError
            ? err.message
            : 'Failed to upload image. Please try again.';
        setError(message);
        setLocalUri(null);
      } finally {
        // Only update state if not aborted
        if (!signal.aborted) {
          setUploading(false);
        }
      }
    },
    [onChange, suggestions.length]
  );

  const handlePickImage = useCallback(async () => {
    try {
      const files = await pickImages({ maxCount: 1, allowsEditing: true });
      if (files.length > 0) {
        uploadSourceRef.current = { source: 'picker', chosenIndex: null };
        await uploadImage(files[0]);
      }
    } catch (err) {
      if (err instanceof MediaUploadError) {
        Alert.alert('Error', err.message);
      }
    }
  }, [uploadImage]);

  const handleTakePhoto = useCallback(async () => {
    try {
      const file = await takePhoto();
      if (file) {
        uploadSourceRef.current = { source: 'camera', chosenIndex: null };
        await uploadImage(file);
      }
    } catch (err) {
      if (err instanceof MediaUploadError) {
        Alert.alert('Error', err.message);
      }
    }
  }, [uploadImage]);

  const handleSuggestionSelect = useCallback(
    async (photo: CachedPhoto, index: number) => {
      uploadSourceRef.current = { source: 'suggested', chosenIndex: index };
      try {
        // Cover candidates are old photos - exactly the ones iCloud offloads -
        // so re-resolve a loadable URI before handing it to the manipulator or
        // the streaming upload. Bounded: an evicted original can hang forever.
        let uri = photo.uri;
        try {
          const fresh = await withNativeTimeout(resolveLoadableUri(photo.id), 'resolveLoadableUri');
          if (fresh) uri = fresh;
        } catch {
          // Keep the scan-time URI; the upload may still succeed with it.
        }

        const name = photo.filename || `${photo.id}.jpg`;
        let size = 0;
        try {
          size = new ExpoFile(uri).size ?? 0;
        } catch {
          // Unknown size: validateFile's 10MB cap can't judge it, and the
          // resize below usually replaces this file anyway.
        }

        const original: LocalFile = { uri, name, type: mimeTypeForName(name), size };

        // Cover suggestions are full-resolution originals; downscale before
        // upload. Falls back to the original on failure OR timeout.
        let file = original;
        try {
          file = await withNativeTimeout(resizeImageForUpload(original), 'resizeImageForUpload');
        } catch (err) {
          logger.warn('Cover suggestion resize failed, uploading original:', err);
        }

        await uploadImage(file);
      } catch (err) {
        if (err instanceof MediaUploadError) {
          Alert.alert('Error', err.message);
        }
      }
    },
    [uploadImage]
  );

  const handleRemove = useCallback(() => {
    Alert.alert('Remove Cover Image', 'Are you sure you want to remove this image?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          onChange(undefined);
          setLocalUri(null);
          setError(null);
        },
      },
    ]);
  }, [onChange]);

  const showOptions = useCallback(() => {
    if (disabled || uploading) return;

    const options = value
      ? ['Choose from Library', 'Take Photo', 'Remove Image', 'Cancel']
      : ['Choose from Library', 'Take Photo', 'Cancel'];
    const destructiveIndex = value ? 2 : undefined;
    const cancelIndex = value ? 3 : 2;

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options,
          destructiveButtonIndex: destructiveIndex,
          cancelButtonIndex: cancelIndex,
        },
        (buttonIndex) => {
          if (buttonIndex === 0) handlePickImage();
          else if (buttonIndex === 1) handleTakePhoto();
          else if (buttonIndex === 2 && value) handleRemove();
        }
      );
    } else {
      // Android fallback - simple alert with buttons
      Alert.alert('Cover Image', 'Choose an option', [
        { text: 'Choose from Library', onPress: handlePickImage },
        { text: 'Take Photo', onPress: handleTakePhoto },
        ...(value
          ? [{ text: 'Remove Image', style: 'destructive' as const, onPress: handleRemove }]
          : []),
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  }, [disabled, uploading, value, handlePickImage, handleTakePhoto, handleRemove]);

  const handleRetry = useCallback(() => {
    setError(null);
    showOptions();
  }, [showOptions]);

  // Determine which image to show
  const displayUri = localUri || value;

  return (
    <View style={styles.container}>
      <CoverSuggestionStrip
        photos={suggestions}
        onSelect={handleSuggestionSelect}
        disabled={disabled || uploading}
      />

      <Pressable
        style={[styles.picker, disabled && styles.pickerDisabled]}
        onPress={showOptions}
        disabled={disabled || uploading}
        accessibilityRole="button"
        accessibilityLabel={value ? 'Change cover image' : 'Add cover image'}
        accessibilityHint={
          value
            ? 'Tap to change or remove the cover image'
            : 'Tap to select an image from your gallery'
        }
      >
        {displayUri ? (
          <View style={styles.imageContainer}>
            <Image source={{ uri: displayUri }} style={styles.image} resizeMode="cover" />

            {/* Upload progress overlay */}
            {uploading && (
              <View style={styles.overlay}>
                <ActivityIndicator size="large" color="#fff" />
                <Text style={styles.progressText}>{Math.round(progress)}%</Text>
              </View>
            )}

            {/* Change button */}
            {!uploading && !error && (
              <View style={styles.changeIndicator}>
                <Ionicons name="camera" size={16} color="#fff" />
                <Text style={styles.changeText}>Change</Text>
              </View>
            )}
          </View>
        ) : (
          <View style={styles.glassContainer}>
            <BlurView intensity={20} tint="light" style={styles.blurView}>
              <View style={styles.placeholderContent}>
                <View style={styles.iconCircle}>
                  <Ionicons name="image-outline" size={24} color={colors.midnightNavy} />
                </View>
                <View style={styles.placeholderTextContainer}>
                  <Text style={styles.placeholderText}>Add Cover Image</Text>
                  <Text style={styles.placeholderHint}>Tap to select</Text>
                </View>
              </View>
            </BlurView>
          </View>
        )}
      </Pressable>

      {/* Error state */}
      {error && (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable onPress={handleRetry}>
            <Text style={styles.retryText}>Tap to retry</Text>
          </Pressable>
        </View>
      )}

      <Text style={styles.hint}>Optional: Add a photo to represent this trip</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
  },
  picker: {
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: 'transparent',
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  pickerDisabled: {
    opacity: 0.6,
  },
  imageContainer: {
    width: '100%',
    height: 200,
    position: 'relative',
    backgroundColor: colors.backgroundMuted,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  glassContainer: {
    height: 80,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.05)',
  },
  blurView: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  placeholderContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(244, 194, 78, 0.1)', // Light Sunset Gold
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderTextContainer: {
    flex: 1,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  progressText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginTop: 8,
  },
  changeIndicator: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    gap: 4,
  },
  changeText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
  placeholderText: {
    fontSize: 16,
    color: colors.midnightNavy,
    fontFamily: fonts.playfair.bold,
  },
  placeholderHint: {
    fontSize: 13,
    color: colors.textSecondary,
    fontFamily: fonts.openSans.regular,
  },
  errorContainer: {
    marginTop: 8,
    alignItems: 'center',
  },
  errorText: {
    fontSize: 13,
    color: colors.adobeBrick,
    textAlign: 'center',
    fontFamily: fonts.openSans.regular,
  },
  retryText: {
    fontSize: 13,
    color: colors.midnightNavy,
    fontWeight: '500',
    marginTop: 4,
    textDecorationLine: 'underline',
  },
  hint: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 8,
    fontFamily: fonts.openSans.regular,
    textAlign: 'center',
  },
});
