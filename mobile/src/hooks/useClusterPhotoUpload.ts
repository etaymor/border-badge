/**
 * Hook for uploading photos from a location cluster.
 * Handles URI conversion from ph:// to file://, sequential uploads, and progress tracking.
 */

import { useState, useRef, useCallback } from 'react';
import * as FileSystem from 'expo-file-system/legacy';

import { useUploadMedia, MAX_PHOTOS_PER_ENTRY } from './useMedia';
import type { LocalFile } from './useMedia';
import type { PhotoWithLocation } from '@services/photoImport';

/** State for cluster photo upload progress */
export interface ClusterUploadState {
  isUploading: boolean;
  currentPhotoIndex: number;
  totalPhotos: number;
  overallProgress: number;
  uploadedMediaIds: string[];
  failedCount: number;
  error: string | null;
}

const initialState: ClusterUploadState = {
  isUploading: false,
  currentPhotoIndex: 0,
  totalPhotos: 0,
  overallProgress: 0,
  uploadedMediaIds: [],
  failedCount: 0,
  error: null,
};

/** MIME type mapping for common image extensions */
const MIME_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  heic: 'image/heic',
  heif: 'image/heif',
};

/**
 * Get MIME type from filename extension.
 */
function getMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return MIME_TYPES[ext] ?? 'image/jpeg';
}

/**
 * Check if a URI is a photo library URI that needs conversion.
 * iOS photo library can return various URI schemes: ph://, ph-upload://, assets-library://
 */
function isPhotoLibraryUri(uri: string): boolean {
  return (
    uri.startsWith('ph://') || uri.startsWith('ph-upload://') || uri.startsWith('assets-library://')
  );
}

/**
 * Convert a ph:// URI to a file:// URI that can be uploaded.
 * Uses FileSystem.copyAsync which natively supports ph:// URIs on iOS.
 * For photos stored in iCloud, iOS will download them during the copy.
 */
async function convertPhotoUri(
  photo: PhotoWithLocation,
  signal: AbortSignal
): Promise<LocalFile | null> {
  // Check if already a file:// URI (already local)
  if (!isPhotoLibraryUri(photo.uri)) {
    return {
      uri: photo.uri,
      name: photo.filename,
      type: getMimeType(photo.filename),
    };
  }

  // Copy the photo library URI to cache directory using FileSystem.copyAsync
  // This uses native iOS APIs that can read from the Photos framework
  const cacheDir = FileSystem.cacheDirectory;
  if (!cacheDir) {
    if (__DEV__) {
      console.warn('[ClusterUpload] No cache directory available');
    }
    return null;
  }

  const targetUri = `${cacheDir}upload_${Date.now()}_${photo.filename}`;

  try {
    if (__DEV__) {
      console.log('[ClusterUpload] Copying photo to cache:', {
        from: photo.uri,
        to: targetUri,
      });
    }

    await FileSystem.copyAsync({ from: photo.uri, to: targetUri });

    if (signal.aborted) {
      // Clean up the copied file if aborted
      try {
        await FileSystem.deleteAsync(targetUri, { idempotent: true });
      } catch {
        // Ignore cleanup errors
      }
      return null;
    }

    // Verify the copy succeeded
    const info = await FileSystem.getInfoAsync(targetUri);
    if (!info.exists || info.size === 0) {
      if (__DEV__) {
        console.warn('[ClusterUpload] Copied file is empty or missing:', targetUri);
      }
      return null;
    }

    if (__DEV__) {
      console.log('[ClusterUpload] Successfully copied photo:', {
        original: photo.uri,
        copied: targetUri,
        size: info.size,
      });
    }

    return {
      uri: targetUri,
      name: photo.filename,
      type: getMimeType(photo.filename),
    };
  } catch (error) {
    if (__DEV__) {
      console.warn('[ClusterUpload] FileSystem.copyAsync failed:', error);
    }
    return null;
  }
}

/**
 * Hook for uploading photos from a location cluster.
 */
export function useClusterPhotoUpload() {
  const [state, setState] = useState<ClusterUploadState>(initialState);
  const abortControllerRef = useRef<AbortController | null>(null);
  const uploadMedia = useUploadMedia();

  /**
   * Upload photos from a cluster.
   * Returns array of successfully uploaded media IDs.
   */
  const uploadPhotos = useCallback(
    async (photos: PhotoWithLocation[], tripId: string): Promise<string[]> => {
      // Limit to max photos per entry
      const photosToUpload = photos.slice(0, MAX_PHOTOS_PER_ENTRY);

      if (photosToUpload.length === 0) {
        return [];
      }

      // Initialize state
      abortControllerRef.current = new AbortController();
      const signal = abortControllerRef.current.signal;

      setState({
        isUploading: true,
        currentPhotoIndex: 0,
        totalPhotos: photosToUpload.length,
        overallProgress: 0,
        uploadedMediaIds: [],
        failedCount: 0,
        error: null,
      });

      const mediaIds: string[] = [];
      let failedCount = 0;

      for (let i = 0; i < photosToUpload.length; i++) {
        if (signal.aborted) {
          break;
        }

        // Update current photo index
        setState((prev) => ({
          ...prev,
          currentPhotoIndex: i,
        }));

        try {
          const photo = photosToUpload[i];

          if (__DEV__) {
            console.log('[ClusterUpload] Processing photo', i, {
              originalUri: photo.uri,
              filename: photo.filename,
            });
          }

          // Convert ph:// URI to file:// URI
          const localFile = await convertPhotoUri(photo, signal);

          if (signal.aborted) {
            break;
          }

          if (!localFile) {
            if (__DEV__) {
              console.warn('[ClusterUpload] Failed to convert photo URI:', photo.uri);
            }
            failedCount++;
            setState((prev) => ({ ...prev, failedCount }));
            continue;
          }

          if (__DEV__) {
            console.log('[ClusterUpload] Converted URI:', {
              original: photo.uri,
              converted: localFile.uri,
              name: localFile.name,
              type: localFile.type,
            });
          }

          // Double-check the URI is valid before attempting upload
          if (isPhotoLibraryUri(localFile.uri)) {
            if (__DEV__) {
              console.error(
                '[ClusterUpload] BUG: localFile still has photo library URI after conversion:',
                localFile.uri
              );
            }
            failedCount++;
            setState((prev) => ({ ...prev, failedCount }));
            continue;
          }

          // Upload the file
          const result = await uploadMedia.mutateAsync({
            tripId,
            file: localFile,
            onProgress: (progress) => {
              if (!signal.aborted) {
                const overallProgress =
                  ((i + progress.percentage / 100) / photosToUpload.length) * 100;
                setState((prev) => ({
                  ...prev,
                  overallProgress,
                }));
              }
            },
          });

          mediaIds.push(result.id);
          setState((prev) => ({
            ...prev,
            uploadedMediaIds: [...prev.uploadedMediaIds, result.id],
          }));
        } catch (error) {
          if (__DEV__) {
            console.warn('[ClusterUpload] Failed to upload photo:', error);
          }
          failedCount++;
          setState((prev) => ({ ...prev, failedCount }));
          // Continue with next photo
        }
      }

      // Final state update
      setState((prev) => ({
        ...prev,
        isUploading: false,
        overallProgress: 100,
      }));

      abortControllerRef.current = null;
      return mediaIds;
    },
    [uploadMedia]
  );

  /**
   * Cancel the current upload operation.
   */
  const cancel = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setState((prev) => ({
      ...prev,
      isUploading: false,
      error: 'Upload cancelled',
    }));
  }, []);

  /**
   * Reset state to initial values.
   */
  const reset = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setState(initialState);
  }, []);

  return {
    state,
    uploadPhotos,
    cancel,
    reset,
  };
}
