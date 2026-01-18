/**
 * Photo import service - extracts GPS/timestamp metadata from photo library.
 *
 * Uses expo-media-library with isAccessMediaLocationEnabled for GPS access.
 * Processes in batches to handle large libraries (10,000+ photos) without crash.
 */

import * as MediaLibrary from 'expo-media-library';

import { PermissionDeniedError, ScanCancelledError } from './errors';
import type { PhotoWithLocation, ScanProgress } from './types';

// Configuration constants (extracted for testability)
export const SCAN_CONFIG = {
  BATCH_SIZE: 50, // Process 50 photos per batch
  YIELD_INTERVAL_MS: 16, // Yield to UI (~1 frame at 60fps)
} as const;

/**
 * Yield to UI thread between batches to prevent freezing.
 */
function yieldToUI(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, SCAN_CONFIG.YIELD_INTERVAL_MS));
}

/**
 * Request photo library permissions with location access.
 *
 * @returns Permission status and access privileges
 */
export async function requestPhotoPermissions(): Promise<{
  granted: boolean;
  limited: boolean;
}> {
  const { status, accessPrivileges } = await MediaLibrary.requestPermissionsAsync();

  return {
    granted: status === 'granted',
    limited: accessPrivileges === 'limited',
  };
}

/**
 * Present the iOS 14+ limited photo picker to allow user to select more photos.
 * Only works when accessPrivileges is 'limited'.
 */
export async function presentLimitedPhotoPicker(): Promise<void> {
  await MediaLibrary.presentPermissionsPickerAsync();
}

/**
 * Extract photos with GPS location from the user's photo library.
 *
 * @param onProgress - Callback for progress updates
 * @param signal - Optional AbortSignal for cancellation
 * @returns Array of photos with location data
 */
export async function extractPhotosWithLocation(
  onProgress: (progress: ScanProgress) => void,
  signal?: AbortSignal
): Promise<PhotoWithLocation[]> {
  // 1. Request permissions with location access
  const { granted, limited } = await requestPhotoPermissions();

  if (!granted) {
    throw new PermissionDeniedError('mediaLibrary');
  }

  // Handle iOS 14+ limited access - user can still proceed with selected photos
  if (limited) {
    console.log('[PhotoImport] Limited photo access - processing selected photos only');
  }

  // 2. Count total for progress reporting
  const countResult = await MediaLibrary.getAssetsAsync({
    first: 1,
    mediaType: MediaLibrary.MediaType.photo,
  });
  const totalAssets = countResult.totalCount;

  onProgress({ phase: 'counting', current: 0, total: totalAssets, percentage: 0 });

  // 3. Paginate through photo library in batches
  const photos: PhotoWithLocation[] = [];
  let cursor: string | undefined;
  let processedCount = 0;
  let hasMorePages = true;

  while (hasMorePages) {
    // Check for cancellation
    if (signal?.aborted) {
      throw new ScanCancelledError();
    }

    const result = await MediaLibrary.getAssetsAsync({
      mediaType: MediaLibrary.MediaType.photo,
      first: SCAN_CONFIG.BATCH_SIZE,
      after: cursor,
      sortBy: [MediaLibrary.SortBy.creationTime],
    });

    // Process batch in parallel (bounded by batch size)
    const batchPromises = result.assets.map(async (asset) => {
      try {
        const info = await MediaLibrary.getAssetInfoAsync(asset.id, {
          // CRITICAL: Don't download iCloud photos during scan
          shouldDownloadFromNetwork: false,
        });

        if (info.location?.latitude && info.location?.longitude) {
          return {
            id: asset.id,
            uri: asset.uri,
            filename: asset.filename,
            creationTime: new Date(asset.creationTime),
            location: {
              latitude: info.location.latitude,
              longitude: info.location.longitude,
            },
          };
        }
        return null;
      } catch {
        // Skip photos that fail to load metadata
        return null;
      }
    });

    const batchResults = await Promise.all(batchPromises);
    photos.push(...batchResults.filter((p): p is PhotoWithLocation => p !== null));

    processedCount += result.assets.length;
    onProgress({
      phase: 'scanning',
      current: processedCount,
      total: totalAssets,
      percentage: Math.round((processedCount / totalAssets) * 100),
    });

    // Yield to UI thread between batches
    await yieldToUI();

    hasMorePages = result.hasNextPage;
    cursor = result.endCursor;
  }

  onProgress({ phase: 'complete', current: totalAssets, total: totalAssets, percentage: 100 });

  console.log(`[PhotoImport] Found ${photos.length} photos with location out of ${totalAssets}`);
  return photos;
}
