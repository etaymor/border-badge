/**
 * Hook for managing multiple concurrent photo uploads from location clusters.
 * Each cluster has its own upload state and can be cancelled independently.
 */

import { useState, useRef, useCallback, useMemo } from 'react';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';

import { useUploadMedia, MAX_PHOTOS_PER_ENTRY } from './useMedia';
import type { LocalFile } from './useMedia';
import type { PhotoWithLocation } from '@services/photoImport';

/** State for a single cluster's photo upload progress */
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

const initialClusterState: ClusterUploadState = {
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
 */
function isPhotoLibraryUri(uri: string): boolean {
  return (
    uri.startsWith('ph://') || uri.startsWith('ph-upload://') || uri.startsWith('assets-library://')
  );
}

/**
 * Extract the asset ID from a ph:// URI.
 */
function extractAssetIdFromPhUri(uri: string): string | null {
  const match = uri.match(/^ph:\/\/([A-F0-9-]+)/i);
  return match ? match[1] : null;
}

/**
 * Convert a ph:// URI to a file:// URI that can be uploaded.
 */
async function convertPhotoUri(
  photo: PhotoWithLocation,
  signal: AbortSignal
): Promise<LocalFile | null> {
  if (!isPhotoLibraryUri(photo.uri)) {
    return {
      uri: photo.uri,
      name: photo.filename,
      type: getMimeType(photo.filename),
    };
  }

  const cacheDir = FileSystem.cacheDirectory;
  if (!cacheDir) {
    console.error('[MultiClusterUpload] No cache directory available');
    return null;
  }

  const targetUri = `${cacheDir}upload_${Date.now()}_${photo.filename}`;

  const assetId = extractAssetIdFromPhUri(photo.uri);
  if (!assetId) {
    console.error('[MultiClusterUpload] Could not extract asset ID from URI:', photo.uri);
    return null;
  }

  // Get asset info - can fail if permissions change or asset is deleted
  let assetInfo;
  try {
    assetInfo = await MediaLibrary.getAssetInfoAsync(assetId, {
      shouldDownloadFromNetwork: true,
    });
  } catch (error) {
    console.error('[MultiClusterUpload] Failed to get asset info:', error);
    return null;
  }

  if (signal.aborted) return null;

  const sourceUri = assetInfo.localUri ?? assetInfo.uri;
  if (!sourceUri) {
    console.error('[MultiClusterUpload] No URI available after asset info fetch');
    return null;
  }

  try {
    await FileSystem.copyAsync({ from: sourceUri, to: targetUri });

    // Check abort immediately after copy - file exists at targetUri now
    if (signal.aborted) {
      try {
        await FileSystem.deleteAsync(targetUri, { idempotent: true });
      } catch {
        // Ignore cleanup errors
      }
      return null;
    }

    const info = await FileSystem.getInfoAsync(targetUri);
    if (!info.exists || info.size === 0) {
      console.error('[MultiClusterUpload] Copied file is empty or missing');
      try {
        await FileSystem.deleteAsync(targetUri, { idempotent: true });
      } catch {
        // Ignore cleanup errors
      }
      return null;
    }

    return {
      uri: targetUri,
      name: photo.filename,
      type: getMimeType(photo.filename),
    };
  } catch (error) {
    console.error('[MultiClusterUpload] Failed to prepare photo:', error);
    // Clean up any partial file that may have been created
    try {
      await FileSystem.deleteAsync(targetUri, { idempotent: true });
    } catch {
      // Ignore cleanup errors
    }
    return null;
  }
}

/**
 * Hook for managing multiple concurrent photo uploads from location clusters.
 */
export function useMultiClusterUpload() {
  const [uploads, setUploads] = useState<Map<string, ClusterUploadState>>(new Map());
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());
  const uploadMedia = useUploadMedia();

  /**
   * Update state for a specific cluster.
   */
  const updateClusterState = useCallback(
    (clusterId: string, updater: (prev: ClusterUploadState) => ClusterUploadState) => {
      setUploads((prev) => {
        const current = prev.get(clusterId) ?? initialClusterState;
        const next = new Map(prev);
        next.set(clusterId, updater(current));
        return next;
      });
    },
    []
  );

  /**
   * Upload photos for a specific cluster.
   * Multiple clusters can upload concurrently.
   */
  const uploadPhotos = useCallback(
    async (
      clusterId: string,
      photos: PhotoWithLocation[],
      tripId: string
    ): Promise<UploadPhotosResult> => {
      console.log(
        '[MultiClusterUpload] Starting upload for cluster',
        clusterId,
        'with',
        photos.length,
        'photos'
      );

      const photosToUpload = photos.slice(0, MAX_PHOTOS_PER_ENTRY);

      if (photosToUpload.length === 0) {
        console.log('[MultiClusterUpload] No photos to upload for cluster', clusterId);
        return { mediaIds: [], failedCount: 0 };
      }

      // Create abort controller for this cluster
      const abortController = new AbortController();
      abortControllersRef.current.set(clusterId, abortController);
      const signal = abortController.signal;

      // Initialize state for this cluster
      setUploads((prev) => {
        const next = new Map(prev);
        next.set(clusterId, {
          isUploading: true,
          currentPhotoIndex: 0,
          totalPhotos: photosToUpload.length,
          overallProgress: 0,
          uploadedMediaIds: [],
          failedCount: 0,
          error: null,
        });
        return next;
      });

      const mediaIds: string[] = [];
      let failedCount = 0;

      const cacheDir = FileSystem.cacheDirectory;
      const isTempFile = (uri: string) => cacheDir && uri.startsWith(cacheDir);
      const cleanupTempFile = async (uri: string) => {
        if (isTempFile(uri)) {
          try {
            await FileSystem.deleteAsync(uri, { idempotent: true });
          } catch {
            // Ignore cleanup errors
          }
        }
      };

      const tempFilesToCleanup: string[] = [];

      try {
        for (let i = 0; i < photosToUpload.length; i++) {
          if (signal.aborted) break;

          updateClusterState(clusterId, (prev) => ({
            ...prev,
            currentPhotoIndex: i,
          }));

          let currentTempUri: string | null = null;

          try {
            const photo = photosToUpload[i];
            const localFile = await convertPhotoUri(photo, signal);

            if (signal.aborted) break;

            if (!localFile) {
              failedCount++;
              updateClusterState(clusterId, (prev) => ({ ...prev, failedCount }));
              continue;
            }

            if (isTempFile(localFile.uri)) {
              currentTempUri = localFile.uri;
              tempFilesToCleanup.push(localFile.uri);
            }

            if (isPhotoLibraryUri(localFile.uri)) {
              failedCount++;
              updateClusterState(clusterId, (prev) => ({ ...prev, failedCount }));
              continue;
            }

            const result = await uploadMedia.mutateAsync({
              tripId,
              file: localFile,
              onProgress: (progress) => {
                if (!signal.aborted) {
                  const overallProgress =
                    ((i + progress.percentage / 100) / photosToUpload.length) * 100;
                  updateClusterState(clusterId, (prev) => ({
                    ...prev,
                    overallProgress,
                  }));
                }
              },
            });

            mediaIds.push(result.id);
            updateClusterState(clusterId, (prev) => ({
              ...prev,
              uploadedMediaIds: [...prev.uploadedMediaIds, result.id],
            }));
          } catch (error) {
            console.error('[MultiClusterUpload] Failed to upload photo:', error);
            failedCount++;
            updateClusterState(clusterId, (prev) => ({ ...prev, failedCount }));
          } finally {
            if (currentTempUri) {
              await cleanupTempFile(currentTempUri);
            }
          }
        }
      } finally {
        // Always clean up temp files and abort controller, even if an error bubbles up
        await Promise.all(tempFilesToCleanup.map(cleanupTempFile));
        abortControllersRef.current.delete(clusterId);
      }

      // Final state update
      updateClusterState(clusterId, (prev) => ({
        ...prev,
        isUploading: false,
        overallProgress: 100,
      }));

      return { mediaIds, failedCount };
    },
    [uploadMedia, updateClusterState]
  );

  /**
   * Cancel upload for a specific cluster.
   */
  const cancel = useCallback(
    (clusterId: string) => {
      const controller = abortControllersRef.current.get(clusterId);
      if (controller) {
        controller.abort();
        abortControllersRef.current.delete(clusterId);
      }
      updateClusterState(clusterId, (prev) => ({
        ...prev,
        isUploading: false,
        error: 'Upload cancelled',
      }));
    },
    [updateClusterState]
  );

  /**
   * Reset state for a specific cluster.
   */
  const reset = useCallback((clusterId: string) => {
    const controller = abortControllersRef.current.get(clusterId);
    if (controller) {
      controller.abort();
      abortControllersRef.current.delete(clusterId);
    }
    setUploads((prev) => {
      const next = new Map(prev);
      next.delete(clusterId);
      return next;
    });
  }, []);

  /**
   * Get upload state for a specific cluster.
   */
  const getUploadState = useCallback(
    (clusterId: string): ClusterUploadState | null => {
      return uploads.get(clusterId) ?? null;
    },
    [uploads]
  );

  /**
   * Check if any cluster is currently uploading.
   */
  const hasActiveUploads = useMemo(() => {
    for (const state of uploads.values()) {
      if (state.isUploading) return true;
    }
    return false;
  }, [uploads]);

  /**
   * Cancel all active uploads.
   */
  const cancelAll = useCallback(() => {
    for (const [clusterId, controller] of abortControllersRef.current.entries()) {
      controller.abort();
      updateClusterState(clusterId, (prev) => ({
        ...prev,
        isUploading: false,
        error: 'Upload cancelled',
      }));
    }
    abortControllersRef.current.clear();
  }, [updateClusterState]);

  return {
    uploads,
    getUploadState,
    hasActiveUploads,
    uploadPhotos,
    cancel,
    reset,
    cancelAll,
  };
}
