/**
 * Hook for uploading photos from a location cluster.
 * Handles URI conversion from ph:// to file://, sequential uploads, and progress tracking.
 */

import { useState, useRef, useCallback } from 'react';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';

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

/** Result from uploadPhotos operation */
export interface UploadPhotosResult {
  mediaIds: string[];
  failedCount: number;
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
 * Extract the asset ID from a ph:// URI.
 * ph:// URIs have format: ph://ASSET-ID/L0/001 or similar
 */
function extractAssetIdFromPhUri(uri: string): string | null {
  // Remove the ph:// prefix and get the first path component (the asset ID)
  const match = uri.match(/^ph:\/\/([A-F0-9-]+)/i);
  return match ? match[1] : null;
}

/**
 * Convert a ph:// URI to a file:// URI that can be uploaded.
 * For iCloud photos, downloads them first using MediaLibrary.getAssetInfoAsync.
 * Then copies to cache directory for upload.
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

  const cacheDir = FileSystem.cacheDirectory;
  if (!cacheDir) {
    console.error('[ClusterUpload] ❌ No cache directory available');
    return null;
  }

  const targetUri = `${cacheDir}upload_${Date.now()}_${photo.filename}`;

  try {
    // Extract asset ID from ph:// URI to use MediaLibrary
    const assetId = extractAssetIdFromPhUri(photo.uri);
    if (!assetId) {
      console.error('[ClusterUpload] ❌ Could not extract asset ID from URI:', photo.uri);
      return null;
    }

    console.log('[ClusterUpload] 📷 Requesting photo from library (may download from iCloud)...');

    // Use MediaLibrary to get the photo, allowing iCloud download
    // This is the key fix: shouldDownloadFromNetwork: true will download iCloud photos
    const assetInfo = await MediaLibrary.getAssetInfoAsync(assetId, {
      shouldDownloadFromNetwork: true,
    });

    if (signal.aborted) {
      return null;
    }

    // Prefer localUri (file://) which should now be available after download
    const sourceUri = assetInfo.localUri ?? assetInfo.uri;

    if (!sourceUri) {
      console.error('[ClusterUpload] ❌ No URI available after asset info fetch');
      return null;
    }

    console.log('[ClusterUpload] 📂 Got source URI:', sourceUri.substring(0, 60));

    // If we got a file:// URI directly, copy it to cache
    if (sourceUri.startsWith('file://')) {
      await FileSystem.copyAsync({ from: sourceUri, to: targetUri });
    } else {
      // Still a ph:// URI - try copyAsync as fallback (should work now that it's downloaded)
      await FileSystem.copyAsync({ from: sourceUri, to: targetUri });
    }

    if (signal.aborted) {
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
      console.error('[ClusterUpload] ❌ Copied file is empty or missing:', targetUri);
      return null;
    }

    console.log('[ClusterUpload] ✅ Photo ready for upload, size:', info.size);

    return {
      uri: targetUri,
      name: photo.filename,
      type: getMimeType(photo.filename),
    };
  } catch (error) {
    console.error('[ClusterUpload] ❌ Failed to prepare photo:', error);
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
   * Returns object with successfully uploaded media IDs and failed count.
   */
  const uploadPhotos = useCallback(
    async (photos: PhotoWithLocation[], tripId: string): Promise<UploadPhotosResult> => {
      console.log(
        '[ClusterUpload] 🚀 Starting upload for',
        photos.length,
        'photos to trip',
        tripId
      );

      // Limit to max photos per entry
      const photosToUpload = photos.slice(0, MAX_PHOTOS_PER_ENTRY);

      if (photosToUpload.length === 0) {
        console.log('[ClusterUpload] No photos to upload');
        return { mediaIds: [], failedCount: 0 };
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

      // Track temp files for cleanup after upload
      const tempFilesToCleanup: string[] = [];
      const cacheDir = FileSystem.cacheDirectory;

      // Helper to check if a URI is a temp file we created
      const isTempFile = (uri: string) => cacheDir && uri.startsWith(cacheDir);

      // Helper to clean up a single temp file
      const cleanupTempFile = async (uri: string) => {
        if (isTempFile(uri)) {
          try {
            await FileSystem.deleteAsync(uri, { idempotent: true });
          } catch {
            // Ignore cleanup errors
          }
        }
      };

      try {
        for (let i = 0; i < photosToUpload.length; i++) {
          if (signal.aborted) {
            break;
          }

          // Update current photo index
          setState((prev) => ({
            ...prev,
            currentPhotoIndex: i,
          }));

          let currentTempUri: string | null = null;

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
              console.error('[ClusterUpload] ❌ FAILED to convert photo URI:', photo.uri);
              failedCount++;
              setState((prev) => ({ ...prev, failedCount }));
              continue;
            }

            // Track temp file for cleanup
            if (isTempFile(localFile.uri)) {
              currentTempUri = localFile.uri;
              tempFilesToCleanup.push(localFile.uri);
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
              console.error(
                '[ClusterUpload] ❌ BUG: localFile still has photo library URI after conversion:',
                localFile.uri
              );
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
            console.error('[ClusterUpload] ❌ Failed to upload photo:', {
              error,
              message: error instanceof Error ? error.message : String(error),
              stack: error instanceof Error ? error.stack : undefined,
            });
            failedCount++;
            setState((prev) => ({ ...prev, failedCount }));
            // Continue with next photo
          } finally {
            // Clean up temp file after each photo (success or failure)
            if (currentTempUri) {
              await cleanupTempFile(currentTempUri);
            }
          }
        }
      } finally {
        // Batch cleanup: remove any remaining temp files (handles edge cases)
        await Promise.all(tempFilesToCleanup.map(cleanupTempFile));
      }

      // Final state update
      setState((prev) => ({
        ...prev,
        isUploading: false,
        overallProgress: 100,
      }));

      abortControllerRef.current = null;
      return { mediaIds, failedCount };
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
