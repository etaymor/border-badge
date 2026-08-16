/**
 * Photo-library cache refresh - the ONE incremental-refresh implementation
 * (P1), plus the silent background sync built on top of it.
 *
 * `ensureFreshLibrary` is the public "one flow" entry point: check freshness
 * (photoLibrarySyncStatus), and only run the incremental extract when the
 * cache is actually stale. Background sync, quiz creation, and manual
 * re-scans all funnel through the same locked loop, so there is exactly one
 * writer at a time and every attempt/success/error is recorded in the
 * persisted sync status - silence stays in the UX, never in the state.
 *
 * Never prompts for permission: prompting is owned exclusively by screens
 * (usePhotoPermissionStatus). The trip-import scan keeps its own richer
 * pipeline in photoScanService; it shares the cache and records into the
 * same sync status, but its loop is deliberately not unified here.
 */

import {
  getLastImportTime,
  setLastImportTime,
  cachePhotos,
  getMetadata,
  setMetadata,
} from './photoCacheDb';
import {
  getLibraryFreshness,
  recordSyncAttempt,
  recordSyncError,
  recordSyncSuccess,
  LIBRARY_FRESHNESS_MS,
  type LibraryFreshness,
  type SyncSource,
} from './photoLibrarySyncStatus';
import { isScanRunning, _setBackgroundSyncFlag } from './photoScanState';

// Lazy imports to avoid circular dependency
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

// Module-level state for refresh coordination (shared by background sync and
// ensureFreshLibrary - one lock, one controller, so a trip scan's
// abortBackgroundSync() aborts EITHER kind of refresh).
let backgroundSyncController: AbortController | null = null;
let backgroundSyncInProgress = false;
let backgroundSyncId = 0;

// Minimum interval between background syncs (1 hour)
const BACKGROUND_SYNC_INTERVAL_MS = 60 * 60 * 1000;

export interface RefreshProgress {
  current: number;
  total: number;
}

/**
 * Check if a background sync is currently in progress.
 */
export function isBackgroundSyncInProgress(): boolean {
  return backgroundSyncInProgress;
}

/**
 * Abort any in-progress refresh (background sync or ensureFreshLibrary).
 * Call this before starting a manual scan to prevent conflicts.
 */
export function abortBackgroundSync(): void {
  if (backgroundSyncController) {
    backgroundSyncController.abort();
    backgroundSyncController = null;
    backgroundSyncInProgress = false;
    _setBackgroundSyncFlag(false);
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
 * The one incremental-refresh loop: extract photos newer than the watermark
 * (or everything on a cold cache), cache them, and advance the watermark.
 * Assumes the caller HOLDS the refresh lock. Throws on failure; the caller
 * records status.
 */
async function runExtractLoop(
  onProgress: ((progress: RefreshProgress) => void) | undefined,
  signal: AbortSignal
): Promise<{ newPhotos: number }> {
  const { extractPhotosWithLocation, photoToCachedPhoto } = await getBackgroundSyncDeps();

  const lastImportTime = await getLastImportTime();
  const newPhotos = await extractPhotosWithLocation(
    (progress) => onProgress?.({ current: progress.current, total: progress.total }),
    signal,
    lastImportTime ? new Date(lastImportTime) : undefined
  );

  if (signal.aborted) return { newPhotos: 0 };

  if (newPhotos.length > 0) {
    await cachePhotos(newPhotos.map((photo) => photoToCachedPhoto(photo)));
    if (signal.aborted) return { newPhotos: newPhotos.length };
    // The watermark is the newest photo's CREATION time (not wall-clock), so
    // photos created during the scan window are never skipped.
    const newestPhotoTime = Math.max(...newPhotos.map((p) => p.creationTime.getTime()));
    await setLastImportTime(newestPhotoTime);
  }

  return { newPhotos: newPhotos.length };
}

/** Acquire the shared refresh lock; null when another refresh holds it. */
function acquireRefreshLock(): { controller: AbortController; syncId: number } | null {
  // Atomic in JS's single-threaded model as long as no await intervenes.
  if (backgroundSyncInProgress) return null;
  backgroundSyncInProgress = true;
  _setBackgroundSyncFlag(true);
  backgroundSyncController = new AbortController();
  return { controller: backgroundSyncController, syncId: ++backgroundSyncId };
}

function releaseRefreshLock(syncId: number): void {
  // Only clear the lock if we still own it: abortBackgroundSync() followed by
  // a new refresh advances backgroundSyncId past ours.
  if (backgroundSyncId === syncId) {
    backgroundSyncInProgress = false;
    backgroundSyncController = null;
    _setBackgroundSyncFlag(false);
  }
}

export type EnsureFreshLibraryResult =
  | { status: 'fresh'; freshness: LibraryFreshness }
  | { status: 'refreshed'; newPhotos: number; freshness: LibraryFreshness }
  /** Another writer owns the cache right now; use it as-is. */
  | { status: 'deferred'; reason: 'scan-running' | 'sync-running' }
  /** NEVER prompts; screens own prompting. */
  | { status: 'no-permission' }
  | { status: 'failed'; error: unknown };

/**
 * The P1 "one flow" entry point: resolve instantly when the cache is fresh,
 * otherwise run one locked incremental refresh. `maxStalenessMs: 0` forces a
 * refresh (the manual re-scan affordance).
 */
export async function ensureFreshLibrary(
  options: {
    maxStalenessMs?: number;
    source?: SyncSource;
    onProgress?: (progress: RefreshProgress) => void;
    signal?: AbortSignal;
  } = {}
): Promise<EnsureFreshLibraryResult> {
  const { maxStalenessMs = LIBRARY_FRESHNESS_MS, source = 'manual', onProgress, signal } = options;

  const freshness = await getLibraryFreshness(maxStalenessMs);
  if (freshness.reason === 'no-permission') {
    return { status: 'no-permission' };
  }
  if (freshness.reason === 'writer-active') {
    return { status: 'deferred', reason: isScanRunning() ? 'scan-running' : 'sync-running' };
  }
  if (freshness.fresh) {
    return { status: 'fresh', freshness };
  }

  const lock = acquireRefreshLock();
  if (!lock) {
    return { status: 'deferred', reason: 'sync-running' };
  }

  // A caller-provided signal (e.g. the quiz creation AbortController) aborts
  // the shared controller so both cancel paths converge.
  const onExternalAbort = () => lock.controller.abort();
  signal?.addEventListener('abort', onExternalAbort);
  if (signal?.aborted) lock.controller.abort();

  try {
    await recordSyncAttempt(source);
    const { newPhotos } = await runExtractLoop(onProgress, lock.controller.signal);
    if (!lock.controller.signal.aborted) {
      await recordSyncSuccess(source, newPhotos);
    }
    return { status: 'refreshed', newPhotos, freshness: await getLibraryFreshness(maxStalenessMs) };
  } catch (error) {
    await recordSyncError(source, error).catch(() => {});
    return { status: 'failed', error };
  } finally {
    signal?.removeEventListener('abort', onExternalAbort);
    releaseRefreshLock(lock.syncId);
  }
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
 * Never throws and never alerts - but failures are now RECORDED in the
 * persisted sync status (photoLibrarySyncStatus) instead of vanishing, so
 * the UI can surface "last sync failed" with a manual re-scan escape hatch.
 */
export async function performBackgroundPhotoSync(
  homeCountry: string | null
): Promise<{ newPhotos: number } | null> {
  // Skip if no home country set
  if (!homeCountry) {
    return null;
  }

  // Skip if the singleton scan service is already doing real work — bg sync
  // and the service share the same SQLite cache and would otherwise interleave.
  if (isScanRunning()) {
    return null;
  }

  const lock = acquireRefreshLock();
  if (!lock) {
    return null;
  }

  try {
    const { MediaLibrary } = await getBackgroundSyncDeps();

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

    await recordSyncAttempt('background');
    const { newPhotos } = await runExtractLoop(undefined, lock.controller.signal);

    if (lock.controller.signal.aborted) {
      return null;
    }

    // Background sync time uses wall-clock to throttle sync frequency
    await setLastBackgroundSyncTime(Date.now());
    await recordSyncSuccess('background', newPhotos);

    if (__DEV__) {
      console.log(`[PhotoSync] Background sync complete: ${newPhotos} new photos`);
    }

    return { newPhotos };
  } catch (error) {
    // Never throw - but leave a trace the UI can read.
    await recordSyncError('background', error).catch(() => {});
    if (__DEV__) {
      console.log('[PhotoSync] Background sync failed:', error);
    }
    return null;
  } finally {
    releaseRefreshLock(lock.syncId);
  }
}
