/**
 * Background photo sync - silently updates the photo cache when the app foregrounds.
 *
 * Called opportunistically to keep the SQLite photo cache fresh.
 * Only runs when permissions are granted, a previous import exists,
 * and enough time has passed since the last sync.
 *
 * Errors are swallowed silently - this is a convenience feature.
 */

import {
  getLastImportTime,
  setLastImportTime,
  cachePhotos,
  getMetadata,
  setMetadata,
} from './photoCacheDb';

// Lazy imports to avoid circular dependency
// These are only used by performBackgroundPhotoSync
let _extractPhotosWithLocation: typeof import('./photoImportService').extractPhotosWithLocation;
let _photoToCachedPhoto: typeof import('./photoClusteringCache').photoToCachedPhoto;
let _MediaLibrary: typeof import('expo-media-library');

async function getBackgroundSyncDeps() {
  if (!_extractPhotosWithLocation) {
    const { extractPhotosWithLocation } = await import('./photoImportService');
    _extractPhotosWithLocation = extractPhotosWithLocation;
  }
  if (!_photoToCachedPhoto) {
    const { photoToCachedPhoto } = await import('./photoClusteringCache');
    _photoToCachedPhoto = photoToCachedPhoto;
  }
  if (!_MediaLibrary) {
    _MediaLibrary = await import('expo-media-library');
  }
  return {
    extractPhotosWithLocation: _extractPhotosWithLocation,
    photoToCachedPhoto: _photoToCachedPhoto,
    MediaLibrary: _MediaLibrary,
  };
}

// Module-level state for background sync coordination
let backgroundSyncController: AbortController | null = null;
let backgroundSyncInProgress = false;

// Minimum interval between background syncs (1 hour)
const BACKGROUND_SYNC_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Check if a background sync is currently in progress.
 */
export function isBackgroundSyncInProgress(): boolean {
  return backgroundSyncInProgress;
}

/**
 * Abort any in-progress background sync.
 * Call this before starting a manual scan to prevent conflicts.
 */
export function abortBackgroundSync(): void {
  if (backgroundSyncController) {
    backgroundSyncController.abort();
    backgroundSyncController = null;
    backgroundSyncInProgress = false;
  }
}

/**
 * Get the timestamp of the last background sync.
 */
export async function getLastBackgroundSyncTime(): Promise<number | null> {
  const value = await getMetadata('last_background_sync_time');
  return value ? parseInt(value, 10) : null;
}

/**
 * Set the timestamp of the last background sync.
 */
async function setLastBackgroundSyncTime(timestamp: number): Promise<void> {
  await setMetadata('last_background_sync_time', timestamp.toString());
}

/**
 * Perform a silent background photo sync.
 *
 * Called when app comes to foreground to keep the photo cache fresh.
 * Only runs if:
 * 1. Home country is set (required for filtering)
 * 2. Photo permissions are granted (checked without prompting)
 * 3. Enough time has passed since last sync (1 hour)
 * 4. A previous import exists (user has used photo import)
 *
 * Errors are swallowed silently - this is a convenience feature.
 */
export async function performBackgroundPhotoSync(
  homeCountry: string | null
): Promise<{ newPhotos: number } | null> {
  // Skip if no home country set
  if (!homeCountry) {
    return null;
  }

  // Atomically check and acquire lock before any async operations to prevent race conditions.
  // In JavaScript's single-threaded event loop, synchronous code runs to completion,
  // so this check-and-set is atomic as long as it happens before any `await`.
  // This is sufficient for our use case: preventing duplicate background syncs from
  // concurrent UI events (e.g., rapid button presses). True thread-safety is not needed
  // since React Native runs on a single JS thread.
  if (backgroundSyncInProgress) {
    return null;
  }
  backgroundSyncInProgress = true;
  backgroundSyncController = new AbortController();

  // Capture controller locally to avoid race condition where abortBackgroundSync()
  // sets backgroundSyncController to null before we check the aborted signal.
  // The captured localController will still reflect the aborted signal even after
  // the global reference is cleared.
  const localController = backgroundSyncController;

  try {
    // Lazy load dependencies to avoid circular imports
    const { extractPhotosWithLocation, photoToCachedPhoto, MediaLibrary } =
      await getBackgroundSyncDeps();

    // Check permissions without prompting
    const { status } = await MediaLibrary.getPermissionsAsync();
    if (status !== 'granted') {
      return null;
    }

    // Check if we have a previous import (cache exists)
    const lastImportTime = await getLastImportTime();
    if (!lastImportTime) {
      // No previous import - user hasn't used photo import yet
      return null;
    }

    // Check if enough time has passed since last background sync
    const lastBackgroundSync = await getLastBackgroundSyncTime();
    const now = Date.now();
    if (lastBackgroundSync && now - lastBackgroundSync < BACKGROUND_SYNC_INTERVAL_MS) {
      return null;
    }

    // Perform incremental scan (only photos since last import)
    const newPhotos = await extractPhotosWithLocation(
      () => {}, // No-op progress callback
      localController.signal,
      new Date(lastImportTime)
    );

    // Check if aborted (use local controller to avoid race with abortBackgroundSync)
    if (localController.signal.aborted) {
      return null;
    }

    // Cache new photos if found
    if (newPhotos.length > 0) {
      const newCachedPhotos = newPhotos.map((p) => photoToCachedPhoto(p));
      await cachePhotos(newCachedPhotos);
    }

    // Update timestamps (skip if aborted to avoid updating state after cancellation)
    if (localController.signal.aborted) {
      return null;
    }

    // Update last_import_time to the newest photo's creation time (not wall-clock).
    // This prevents skipping photos created during the scan window.
    // Only update if we processed photos; otherwise keep the previous value.
    if (newPhotos.length > 0) {
      const newestPhotoTime = Math.max(...newPhotos.map((p) => p.creationTime.getTime()));
      await setLastImportTime(newestPhotoTime);
    }

    // Background sync time uses wall-clock to throttle sync frequency
    await setLastBackgroundSyncTime(Date.now());

    if (__DEV__) {
      console.log(`[PhotoSync] Background sync complete: ${newPhotos.length} new photos`);
    }

    return { newPhotos: newPhotos.length };
  } catch (error) {
    // Swallow all errors - this is a convenience feature
    if (__DEV__) {
      console.log('[PhotoSync] Background sync failed:', error);
    }
    return null;
  } finally {
    backgroundSyncInProgress = false;
    backgroundSyncController = null;
  }
}
