/**
 * photoScanSteps - The body of the trip scan, as one unit of runtime work.
 *
 * Split out of `photoScanService` when the scan moved onto the library job
 * runtime. The service now owns only the descriptor and the public API; this
 * module owns the pass itself and talks to the runtime exclusively through
 * `JobRunContext` — `ctx.signal` for cancellation, `ctx.emit` for progress and
 * the store's `trip-scan` detail slice, `ctx.heartbeat` for the stuck detector.
 *
 * It NEVER writes the store directly. Every terminal state (a result, a
 * user-facing failure, a cancellation) comes back as a return value and the
 * descriptor publishes it, so there is exactly one place that decides what the
 * slice says.
 *
 * The pass is not internally checkpointed: `extractPhotosWithLocation` and
 * `segmentTripsFromCache` have no resumable midpoint, and the SQLite photo
 * cache already makes a re-run of an interrupted scan cheap (it picks up from
 * the last incremental commit). So a suspend costs the current pass, not the
 * library.
 */

import { Analytics } from '@services/analytics';
import { getCountryName } from '@utils/countries';

import type { JobFailure, JobRunContext } from '@services/jobs/jobTypes';
import type { TripScanDetail } from '@stores/libraryJobStore';

import { iso1A2Code } from './countryCoder';
import { HomeCountryNotSetError } from './errors';
import {
  cachePhotos,
  clearPhotoCache,
  getAllCachedPhotos,
  getLastImportTime,
  saveTripSegments,
  setLastImportTime,
} from './photoCacheDb';
import {
  photoToCachedPhoto,
  rankTripSegmentPreviews,
  segmentTripsFromCache,
} from './photoClusteringCache';
import { applyPersistedSplits, applySavedPhotoFilter } from './photoClusteringDisplay';
import { getAllSavedPhotoIds, getClusterSplitsForParents } from './photoCacheDbSuggestions';
import { extractPhotosWithLocation } from './photoImportService';
import { maybeRunTaggingPass } from './photoTaggingService';
import type { CachedPhoto, DiscoveredCountry, PhotoWithLocation, ScanProgress } from './types';
import type { PhotoScanResult, PhotoScanStartOptions } from './photoScanTypes';

/** Batch size for incremental cache commits during scanning. */
const INCREMENTAL_CACHE_BATCH = 500;

/**
 * How the pass ended. `cancelled` is distinct from `failed`: the runtime and
 * `cancelScan` already reset the slice for a cancellation, so the descriptor
 * must not paint a failure over it.
 */
export type ScanPassOutcome =
  | { status: 'completed'; result: PhotoScanResult }
  | { status: 'failed'; failure: JobFailure }
  | { status: 'cancelled' };

export async function runScanPass(
  ctx: JobRunContext,
  opts: PhotoScanStartOptions
): Promise<ScanPassOutcome> {
  const scanStartTime = Date.now();
  const detail: TripScanDetail = { discoveredCountries: [], isIncremental: false };

  try {
    Analytics.photoImportScanStarted();

    // resumed: never force-refresh on auto-resume; treat as continuation.
    const cachedImportTime = opts.forceRefresh && !opts.resumed ? null : await getLastImportTime();
    const doIncremental = cachedImportTime !== null;

    if (opts.forceRefresh && !opts.resumed) {
      await clearPhotoCache();
    }

    detail.isIncremental = doIncremental;
    ctx.emit(null, { ...detail });

    let allCachedPhotos: CachedPhoto[] = [];
    let newPhotos: PhotoWithLocation[] = [];

    const discoveredCountryCodes = new Set<string>();
    const discoveredCountries: DiscoveredCountry[] = [];
    let pendingCachePhotos: PhotoWithLocation[] = [];
    const photoCountryCodes = new Map<string, string | null>();
    const cachePromises: Promise<void>[] = [];
    let lastProgress: ScanProgress | null = null;

    const handleBatch = (batchPhotos: PhotoWithLocation[]) => {
      if (ctx.signal.aborted) return;

      let countriesChanged = false;
      for (const photo of batchPhotos) {
        const code = iso1A2Code([photo.location.longitude, photo.location.latitude], {
          level: 'territory',
        });
        photoCountryCodes.set(photo.id, code ?? null);
        if (code && !discoveredCountryCodes.has(code)) {
          discoveredCountryCodes.add(code);
          discoveredCountries.push({ code, name: getCountryName(code) });
          countriesChanged = true;
        }
      }

      if (countriesChanged) {
        detail.discoveredCountries = discoveredCountries.slice(-10);
        ctx.emit(lastProgress, { ...detail });
      }

      pendingCachePhotos.push(...batchPhotos);
      if (pendingCachePhotos.length >= INCREMENTAL_CACHE_BATCH) {
        const toCache = pendingCachePhotos.map((p) =>
          photoToCachedPhoto(p, photoCountryCodes.get(p.id))
        );
        pendingCachePhotos = [];
        if (ctx.signal.aborted) return;
        const promise = cachePhotos(toCache).catch((err) => {
          if (__DEV__) console.warn('[PhotoScanSteps] Incremental cache write failed:', err);
        });
        cachePromises.push(promise);
      }
    };

    const onProgress = (progress: ScanProgress) => {
      if (ctx.signal.aborted) return;
      const next: ScanProgress = {
        ...progress,
        discoveredCountries:
          discoveredCountries.length > 0 ? discoveredCountries.slice(-10) : undefined,
      };
      lastProgress = next;
      ctx.emit(next, { ...detail });
    };

    if (doIncremental) {
      allCachedPhotos = await getAllCachedPhotos();
      newPhotos = await extractPhotosWithLocation(
        onProgress,
        ctx.signal,
        new Date(cachedImportTime),
        handleBatch
      );
    } else {
      newPhotos = await extractPhotosWithLocation(onProgress, ctx.signal, undefined, handleBatch);
    }

    if (ctx.signal.aborted) {
      photoCountryCodes.clear();
      await Promise.all(cachePromises).catch(() => undefined);
      return { status: 'cancelled' };
    }

    await Promise.all(cachePromises);
    if (ctx.signal.aborted) {
      photoCountryCodes.clear();
      return { status: 'cancelled' };
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
      return {
        status: 'failed',
        failure: {
          reason: 'no-photos',
          title: 'No Photos Found',
          message:
            'No photos with location data were found in your library. Make sure location services were enabled when you took the photos.',
        },
      };
    }

    const importTime =
      newPhotos.length > 0
        ? newPhotos.reduce((max, p) => Math.max(max, p.creationTime.getTime()), 0)
        : Date.now();
    await setLastImportTime(importTime);

    // Honor cancel right before segmentation — cheap, avoids surprise where a
    // late tap still finishes the scan.
    if (ctx.signal.aborted) return { status: 'cancelled' };

    // Heartbeat right before segmentation so the stuck detector (5min no
    // progress) gets a fresh checkpoint. Mitigates false-positives for huge
    // libraries where segmentation alone exceeds the threshold; a proper fix
    // requires periodic heartbeats inside segmentTripsFromCache.
    ctx.heartbeat();
    const segmented = segmentTripsFromCache(allCachedPhotos, opts.homeCountry!);

    if (ctx.signal.aborted) return { status: 'cancelled' };

    // Re-apply persisted manual splits: re-segmentation from cached photos
    // rebuilds the parent geohash IDs, so without this the user's split
    // disappears every time they return to suggestions.
    const allClusterIds = Array.from(segmented.clusterLookup.keys());
    const [splitsByParent, savedPhotoIds] = await Promise.all([
      getClusterSplitsForParents(allClusterIds).catch(() => new Map()),
      getAllSavedPhotoIds().catch(() => new Set<string>()),
    ]);
    if (ctx.signal.aborted) return { status: 'cancelled' };

    const splitApplied = applyPersistedSplits(segmented, splitsByParent);
    const { data: optimizedData, autoDismissed } = applySavedPhotoFilter(
      splitApplied,
      savedPhotoIds
    );

    // Best-first preview strips for the trip segment cards (flag-gated inside;
    // degrades to the chronological previews on any failure). Cluster displays
    // stay chronological — their order feeds gallery selection and splitting.
    const rankedCandidates = await rankTripSegmentPreviews(
      optimizedData.candidates,
      optimizedData.photoLookup
    );
    if (ctx.signal.aborted) return { status: 'cancelled' };

    saveTripSegments(
      rankedCandidates.map((c) => ({
        id: c.id,
        countryCode: c.countryCode,
        startTime: c.dateRange.start.getTime(),
        endTime: c.dateRange.end.getTime(),
        photoCount: c.photoCount,
        clusterCount: c.locationClusterIds.length,
        previewUris: c.previewUris,
        previewAssetIds: c.previewAssetIds,
        clusterIds: c.locationClusterIds,
        photoIds: c.photoIds,
      }))
    ).catch((err) => {
      if (__DEV__) console.warn('[PhotoScanSteps] Failed to save trip segments:', err);
    });

    let candidates = rankedCandidates;
    if (opts.filterCountryCode) {
      candidates = candidates.filter((c) => c.countryCode === opts.filterCountryCode);
    }

    if (candidates.length === 0) {
      Analytics.photoImportScanFailed({ error: 'no_trips' });
      return {
        status: 'failed',
        failure: {
          reason: 'no-trips',
          title: 'No Trips Found',
          message: opts.filterCountryCode
            ? `No travel photos found for this country. Photos taken in your home country (${opts.homeCountry}) are filtered out.`
            : `No travel photos found. Photos taken in your home country (${opts.homeCountry}) are filtered out.`,
        },
      };
    }

    const totalPhotoCount = candidates.reduce((sum, c) => sum + c.photoCount, 0);
    Analytics.photoImportScanCompleted({
      photoCount: totalPhotoCount,
      tripCandidateCount: candidates.length,
      scanDurationMs: Date.now() - scanStartTime,
      isIncremental: doIncremental,
      newPhotosCount: doIncremental ? newPhotos.length : undefined,
    });

    // The initial big import lands here, so this is the trigger that gets a
    // brand-new library its first tag coverage. Fire-and-forget.
    void maybeRunTaggingPass();

    return {
      status: 'completed',
      result: {
        candidates,
        photoLookup: optimizedData.photoLookup,
        clusterLookup: optimizedData.clusterLookup,
        clusterDisplays: optimizedData.clusterDisplays,
        importTime,
        isIncremental: doIncremental,
        autoDismissedClusterIds: autoDismissed,
        newPhotosCount: newPhotos.length,
      },
    };
  } catch (error) {
    if (isAbortLike(error)) {
      return { status: 'cancelled' };
    }
    if (error instanceof HomeCountryNotSetError) {
      Analytics.photoImportScanFailed({ error: 'home_country_not_set' });
      return {
        status: 'failed',
        failure: {
          reason: 'home-country',
          title: 'Set Home Country',
          message: 'Please set your home country in settings first.',
        },
      };
    }
    if (__DEV__) console.error('[PhotoScanSteps] Scan error:', error);
    Analytics.photoImportScanFailed({
      error: error instanceof Error ? error.message.slice(0, 100) : 'unknown',
    });
    return {
      status: 'failed',
      failure: {
        reason: 'scan-error',
        title: 'Scan Failed',
        message: 'Failed to scan photos. Please try again.',
      },
    };
  }
}

function isAbortLike(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  const name = (error as { name?: string }).name;
  return name === 'AbortError' || name === 'ScanCancelledError';
}
