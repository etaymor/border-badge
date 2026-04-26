/**
 * photoScanService - Module-level singleton that owns the photo library scan loop.
 *
 * Scan ownership lives here, not in the screen, so the scan survives in-app
 * navigation and auto-resumes on next foreground after iOS suspends the JS runtime.
 * Subscribers (`PhotoImportScreen`, `PersistentScanBanner`, `useAppStateTracking`,
 * `performBackgroundPhotoSync`) read state via `photoScanStore`.
 *
 * Heavyweight result Maps (5–10MB for large libraries) live on a module-level ref
 * here, NOT in Zustand. Callers retrieve them via `consumeResult()` which atomically
 * returns and clears.
 *
 * Mirrors the lock + scanId + localController pattern from `photoBackgroundSync.ts`.
 */

import { iso1A2Code } from '@rapideditor/country-coder';

import { Analytics } from '@services/analytics';
import { getCountryName } from '@utils/countries';

import { HomeCountryNotSetError } from './errors';
import { abortBackgroundSync } from './photoBackgroundSync';
import {
  cachePhotos,
  clearPhotoCache,
  getAllCachedPhotos,
  getLastImportTime,
  getMetadata,
  saveTripSegments,
  setLastImportTime,
  setMetadata,
} from './photoCacheDb';
import { photoToCachedPhoto, segmentTripsFromCache } from './photoClusteringCache';
import { extractPhotosWithLocation } from './photoImportService';
import type {
  CachedPhoto,
  DiscoveredCountry,
  LocationCluster,
  LocationClusterDisplay,
  PhotoWithLocation,
  ScanProgress,
  TripCandidateDisplay,
} from './types';

import {
  resetPhotoScanStore,
  usePhotoScanStore,
  type PhotoScanFailure,
} from '@stores/photoScanStore';

/** Batch size for incremental cache commits during scanning. */
const INCREMENTAL_CACHE_BATCH = 500;

/** Metadata keys for durable scan-in-progress tracking across launches. */
const SCAN_IN_PROGRESS_KEY = 'scan_in_progress';
const SCAN_STARTED_AT_KEY = 'scan_started_at';

export interface PhotoScanResult {
  candidates: TripCandidateDisplay[];
  photoLookup: Map<string, PhotoWithLocation>;
  clusterLookup: Map<string, LocationCluster>;
  clusterDisplays: Map<string, LocationClusterDisplay>;
  importTime: number;
  isIncremental: boolean;
}

export interface PhotoScanStartOptions {
  homeCountry: string | null;
  filterCountryCode?: string;
  forceRefresh?: boolean;
  /** True when invoked by the foreground auto-resume path. Disables `forceRefresh`. */
  resumed?: boolean;
}

export type PhotoScanStartResult =
  | { status: 'started' }
  | { status: 'already-running' }
  | {
      status: 'rejected';
      reason: 'no-home-country' | 'no-permission' | 'not-premium';
    };

// ---------------------------------------------------------------------------
// Module-level state (mirrors photoBackgroundSync pattern)
// ---------------------------------------------------------------------------

let scanController: AbortController | null = null;
let scanInProgress = false;
let scanId = 0;
let lastResult: PhotoScanResult | null = null;
let lastProgressAt = 0;
let foregroundEventInFlight: Promise<void> | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function isScanRunning(): boolean {
  return scanInProgress;
}

export function hasResult(): boolean {
  return lastResult !== null;
}

export function getLastProgressAt(): number {
  return lastProgressAt;
}

/**
 * Atomically take ownership of the last scan result and clear the service ref.
 * Idempotent: a second call returns null.
 */
export function consumeResult(): PhotoScanResult | null {
  const result = lastResult;
  lastResult = null;
  if (result) {
    usePhotoScanStore.setState({ hasResult: false });
  }
  return result;
}

/**
 * Cancel the running scan, if any. Clears scan-in-progress metadata and
 * resets the store to idle.
 */
export function cancelScan(): void {
  if (scanController) {
    scanController.abort();
    scanController = null;
  }
  scanInProgress = false;
  Analytics.photoImportScanCancelled();
  void clearScanMetadata();
  resetPhotoScanStore();
}

/**
 * Mark the current scan as failed without aborting the controller.
 * Used by stuck-scan detection and gate failures during auto-resume.
 */
export function markFailed(failure: PhotoScanFailure): void {
  // If a scan is in flight, abort it; the abort handler in the loop will
  // skip publishing a result. We still want the failure surfaced.
  if (scanController) {
    scanController.abort();
    scanController = null;
  }
  scanInProgress = false;
  void clearScanMetadata();
  usePhotoScanStore.setState({
    phase: 'failed',
    progress: null,
    scanFailure: failure,
    hasResult: false,
  });
}

/**
 * Start a scan. Synchronous lock check before any await prevents races.
 * On `resumed: true`, foreground events are serialized to prevent double-fire
 * during rapid app-switcher bounces.
 */
export async function startScan(opts: PhotoScanStartOptions): Promise<PhotoScanStartResult> {
  if (opts.resumed) {
    if (foregroundEventInFlight) {
      await foregroundEventInFlight;
      // After awaiting an in-flight resume, treat as "already-running" if the
      // service is still active. Otherwise fall through to start fresh.
      if (scanInProgress) {
        return { status: 'already-running' };
      }
    }
    let resolveForeground: () => void = () => {};
    foregroundEventInFlight = new Promise<void>((resolve) => {
      resolveForeground = resolve;
    });
    try {
      return await runStart(opts);
    } finally {
      resolveForeground();
      foregroundEventInFlight = null;
    }
  }

  return runStart(opts);
}

async function runStart(opts: PhotoScanStartOptions): Promise<PhotoScanStartResult> {
  if (!opts.homeCountry) {
    return { status: 'rejected', reason: 'no-home-country' };
  }

  // Atomic check-and-acquire: synchronous block before first await is race-safe
  // in JS's single-threaded event loop.
  if (scanInProgress) {
    return { status: 'already-running' };
  }
  scanInProgress = true;
  scanController = new AbortController();
  const mySyncId = ++scanId;
  const localController = scanController;

  // Stop any background sync to avoid interleaved cache writes.
  abortBackgroundSync();

  // Initial store + metadata writes happen inside `runScan` so any rejection
  // here doesn't leave stale state.
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  runScan(opts, mySyncId, localController).catch((error) => {
    if (__DEV__) console.warn('[PhotoScanService] Unhandled scan error:', error);
  });

  return { status: 'started' };
}

// ---------------------------------------------------------------------------
// Internal scan loop
// ---------------------------------------------------------------------------

async function runScan(
  opts: PhotoScanStartOptions,
  mySyncId: number,
  localController: AbortController
): Promise<void> {
  const scanStartTime = Date.now();
  Analytics.photoImportScanStarted();

  try {
    await setMetadata(SCAN_IN_PROGRESS_KEY, 'true');
    await setMetadata(SCAN_STARTED_AT_KEY, scanStartTime.toString());

    // Reset store to scanning state. discoveredCountries and progress get
    // populated as the scan runs.
    usePhotoScanStore.setState({
      phase: 'scanning',
      progress: null,
      discoveredCountries: [],
      isIncremental: false,
      scanFailure: null,
      hasResult: false,
    });
    lastProgressAt = Date.now();

    // resumed: never force-refresh on auto-resume; treat as continuation.
    const cachedImportTime = opts.forceRefresh && !opts.resumed ? null : await getLastImportTime();
    const doIncremental = cachedImportTime !== null;

    if (opts.forceRefresh && !opts.resumed) {
      await clearPhotoCache();
    }

    usePhotoScanStore.setState({ isIncremental: doIncremental });

    let allCachedPhotos: CachedPhoto[] = [];
    let newPhotos: PhotoWithLocation[] = [];

    const discoveredCountryCodes = new Set<string>();
    const discoveredCountries: DiscoveredCountry[] = [];
    let pendingCachePhotos: PhotoWithLocation[] = [];
    const photoCountryCodes = new Map<string, string | null>();
    const cachePromises: Promise<void>[] = [];

    const handleBatch = (batchPhotos: PhotoWithLocation[]) => {
      if (localController.signal.aborted) return;

      let countriesChanged = false;
      for (const photo of batchPhotos) {
        const code = iso1A2Code([photo.location.longitude, photo.location.latitude]);
        photoCountryCodes.set(photo.id, code ?? null);
        if (code && !discoveredCountryCodes.has(code)) {
          discoveredCountryCodes.add(code);
          discoveredCountries.push({ code, name: getCountryName(code) });
          countriesChanged = true;
        }
      }

      if (countriesChanged) {
        usePhotoScanStore.setState({
          discoveredCountries: discoveredCountries.slice(-10),
        });
      }

      pendingCachePhotos.push(...batchPhotos);
      if (pendingCachePhotos.length >= INCREMENTAL_CACHE_BATCH) {
        const toCache = pendingCachePhotos.map((p) =>
          photoToCachedPhoto(p, photoCountryCodes.get(p.id))
        );
        pendingCachePhotos = [];
        if (localController.signal.aborted) return;
        const promise = cachePhotos(toCache).catch((err) => {
          if (__DEV__) console.warn('[PhotoScanService] Incremental cache write failed:', err);
        });
        cachePromises.push(promise);
      }
    };

    const onProgress = (progress: ScanProgress) => {
      if (localController.signal.aborted) return;
      lastProgressAt = Date.now();
      usePhotoScanStore.setState({
        progress: {
          ...progress,
          discoveredCountries:
            discoveredCountries.length > 0 ? discoveredCountries.slice(-10) : undefined,
        },
      });
    };

    if (doIncremental) {
      allCachedPhotos = await getAllCachedPhotos();
      newPhotos = await extractPhotosWithLocation(
        onProgress,
        localController.signal,
        new Date(cachedImportTime),
        handleBatch
      );
    } else {
      newPhotos = await extractPhotosWithLocation(
        onProgress,
        localController.signal,
        undefined,
        handleBatch
      );
    }

    if (localController.signal.aborted) {
      photoCountryCodes.clear();
      await Promise.all(cachePromises).catch(() => undefined);
      return;
    }

    await Promise.all(cachePromises);
    if (localController.signal.aborted) {
      photoCountryCodes.clear();
      return;
    }

    if (pendingCachePhotos.length > 0) {
      const remainingCached = pendingCachePhotos.map((p) =>
        photoToCachedPhoto(p, photoCountryCodes.get(p.id))
      );
      await cachePhotos(remainingCached);
    }

    if (newPhotos.length > 0) {
      const newCached = newPhotos.map((p) => photoToCachedPhoto(p, photoCountryCodes.get(p.id)));
      allCachedPhotos = [...allCachedPhotos, ...newCached];
    }
    photoCountryCodes.clear();

    if (allCachedPhotos.length === 0 && newPhotos.length === 0) {
      Analytics.photoImportScanFailed({ error: 'no_photos' });
      publishFailure({
        reason: 'no-photos',
        title: 'No Photos Found',
        message:
          'No photos with location data were found in your library. Make sure location services were enabled when you took the photos.',
      });
      return;
    }

    const importTime =
      newPhotos.length > 0
        ? newPhotos.reduce((max, p) => Math.max(max, p.creationTime.getTime()), 0)
        : Date.now();
    await setLastImportTime(importTime);

    // Honor cancel right before segmentation — cheap, avoids surprise where a
    // late tap still finishes the scan.
    if (localController.signal.aborted) return;

    const optimizedData = segmentTripsFromCache(allCachedPhotos, opts.homeCountry!);

    if (localController.signal.aborted) return;

    saveTripSegments(
      optimizedData.candidates.map((c) => ({
        id: c.id,
        countryCode: c.countryCode,
        startTime: c.dateRange.start.getTime(),
        endTime: c.dateRange.end.getTime(),
        photoCount: c.photoCount,
        clusterCount: c.locationClusterIds.length,
        previewUris: c.previewUris,
        clusterIds: c.locationClusterIds,
        photoIds: c.photoIds,
      }))
    ).catch((err) => {
      if (__DEV__) console.warn('[PhotoScanService] Failed to save trip segments:', err);
    });

    let candidates = optimizedData.candidates;
    if (opts.filterCountryCode) {
      candidates = candidates.filter((c) => c.countryCode === opts.filterCountryCode);
    }

    if (candidates.length === 0) {
      Analytics.photoImportScanFailed({ error: 'no_trips' });
      publishFailure({
        reason: 'no-trips',
        title: 'No Trips Found',
        message: opts.filterCountryCode
          ? `No travel photos found for this country. Photos taken in your home country (${opts.homeCountry}) are filtered out.`
          : `No travel photos found. Photos taken in your home country (${opts.homeCountry}) are filtered out.`,
      });
      return;
    }

    const totalPhotoCount = candidates.reduce((sum, c) => sum + c.photoCount, 0);
    const scanDurationMs = Date.now() - scanStartTime;
    Analytics.photoImportScanCompleted({
      photoCount: totalPhotoCount,
      tripCandidateCount: candidates.length,
      scanDurationMs,
      isIncremental: doIncremental,
      newPhotosCount: doIncremental ? newPhotos.length : undefined,
    });

    // Publish result. Maps land on the service ref; the store only sees `hasResult`.
    lastResult = {
      candidates,
      photoLookup: optimizedData.photoLookup,
      clusterLookup: optimizedData.clusterLookup,
      clusterDisplays: optimizedData.clusterDisplays,
      importTime,
      isIncremental: doIncremental,
    };

    usePhotoScanStore.setState({
      phase: 'completed',
      hasResult: true,
      scanFailure: null,
    });
  } catch (error) {
    if (isAbortLike(error)) {
      // Cancellation: store and metadata are reset by `cancelScan`. Nothing else to do.
      return;
    }
    if (error instanceof HomeCountryNotSetError) {
      Analytics.photoImportScanFailed({ error: 'home_country_not_set' });
      publishFailure({
        reason: 'home-country',
        title: 'Set Home Country',
        message: 'Please set your home country in settings first.',
      });
      return;
    }
    if (__DEV__) console.error('[PhotoScanService] Scan error:', error);
    Analytics.photoImportScanFailed({
      error: error instanceof Error ? error.message.slice(0, 100) : 'unknown',
    });
    publishFailure({
      reason: 'scan-error',
      title: 'Scan Failed',
      message: 'Failed to scan photos. Please try again.',
    });
  } finally {
    // Only release the lock if we still own it. If `cancelScan()` was called and a
    // new scan started, `scanId` will have advanced past `mySyncId`.
    if (scanId === mySyncId) {
      scanInProgress = false;
      scanController = null;
      // Clear scan-in-progress metadata atomically with the terminal store write.
      // Failure paths above already wrote `phase: 'failed'`; the cleanup here
      // catches the success path and any stray cancellation that didn't go through
      // `cancelScan`.
      await clearScanMetadata().catch(() => undefined);
    }
  }
}

function publishFailure(failure: PhotoScanFailure): void {
  lastResult = null;
  usePhotoScanStore.setState({
    phase: 'failed',
    progress: null,
    scanFailure: failure,
    hasResult: false,
  });
}

async function clearScanMetadata(): Promise<void> {
  await setMetadata(SCAN_IN_PROGRESS_KEY, 'false');
  // Leave scan_started_at as a forensic trail; staleness comparisons read scan_in_progress first.
}

function isAbortLike(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  const name = (error as { name?: string }).name;
  return name === 'AbortError' || name === 'ScanCancelledError';
}

// ---------------------------------------------------------------------------
// Resume support — read durable scan-in-progress flag set by an earlier launch.
// ---------------------------------------------------------------------------

export async function readScanInProgressMetadata(): Promise<{
  inProgress: boolean;
  startedAt: number | null;
}> {
  const [flag, started] = await Promise.all([
    getMetadata(SCAN_IN_PROGRESS_KEY),
    getMetadata(SCAN_STARTED_AT_KEY),
  ]);
  return {
    inProgress: flag === 'true',
    startedAt: started ? parseInt(started, 10) : null,
  };
}

export async function clearScanInProgressMetadata(): Promise<void> {
  await clearScanMetadata();
}

/**
 * Test-only helper: reset all module-level state. NOT exported from the package
 * index; tests reach in via the file path.
 */
export function __resetForTesting(): void {
  scanController = null;
  scanInProgress = false;
  scanId = 0;
  lastResult = null;
  lastProgressAt = 0;
  foregroundEventInFlight = null;
  resetPhotoScanStore();
}
