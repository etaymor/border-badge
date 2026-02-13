/**
 * usePhotoScan - Hook for scanning photos and building trip candidates.
 *
 * Handles photo extraction, caching, and trip segmentation.
 */

import { useCallback, useRef } from 'react';
import { Alert } from 'react-native';

import { iso1A2Code } from '@rapideditor/country-coder';

import { HomeCountryNotSetError } from '@services/photoImport/errors';
import {
  extractPhotosWithLocation,
  segmentTripsFromCache,
  photoToCachedPhoto,
  getLastImportTime,
  setLastImportTime,
  getAllCachedPhotos,
  cachePhotos,
  clearPhotoCache,
  abortBackgroundSync,
  type DiscoveredCountry,
  type ScanProgress,
  type TripCandidateDisplay,
  type LocationCluster,
  type LocationClusterDisplay,
  type PhotoWithLocation,
  type CachedPhoto,
} from '@services/photoImport';
import { Analytics } from '@services/analytics';
import { getCountryName } from '@utils/countries';
import { isAbortError, createAbortError } from './photoImportUtils';

/** Batch size for incremental cache commits during scanning */
const INCREMENTAL_CACHE_BATCH = 500;

/** Reason the scan did not succeed */
export type ScanFailureReason = 'no-photos' | 'no-trips' | 'home-country' | 'scan-error';

export interface ScanResult {
  candidates: TripCandidateDisplay[];
  photoLookup: Map<string, PhotoWithLocation>;
  clusterLookup: Map<string, LocationCluster>;
  clusterDisplays: Map<string, LocationClusterDisplay>;
  importTime: number;
  isIncremental: boolean;
}

/** Return value from startScan */
export type ScanOutcome =
  | { success: true }
  | { success: false; reason: ScanFailureReason; title: string; message: string }
  | { success: false; reason: null };

export interface UsePhotoScanOptions {
  homeCountry: string | null;
  filterCountryCode?: string;
  onScanProgress: (progress: ScanProgress | null) => void;
  onScanComplete: (result: ScanResult) => void;
  onScanError: () => void;
}

export function usePhotoScan({
  homeCountry,
  filterCountryCode,
  onScanProgress,
  onScanComplete,
  onScanError,
}: UsePhotoScanOptions) {
  const abortControllerRef = useRef<AbortController | null>(null);

  const startScan = useCallback(
    async (forceRefresh = false): Promise<ScanOutcome> => {
      if (!homeCountry) {
        Alert.alert(
          'Set Home Country',
          'Please set your home country in settings first. This helps us filter out local photos.',
          [{ text: 'OK' }]
        );
        return { success: false, reason: null };
      }

      // Abort any background sync in progress to prevent conflicts
      abortBackgroundSync();

      // Abort any previous scan before starting a new one
      abortControllerRef.current?.abort();

      const controller = new AbortController();
      abortControllerRef.current = controller;
      const scanStartTime = Date.now();
      Analytics.photoImportScanStarted();

      try {
        // Check if we have cached data and should do incremental import
        const cachedImportTime = forceRefresh ? null : await getLastImportTime();
        const doIncremental = cachedImportTime !== null;

        if (forceRefresh) {
          // Clear cache for full refresh
          await clearPhotoCache();
        }

        let allCachedPhotos: CachedPhoto[] = [];
        let newPhotos: PhotoWithLocation[] = [];

        // Track discovered countries for live progress feed
        const discoveredCountryCodes = new Set<string>();
        const discoveredCountries: DiscoveredCountry[] = [];

        // Accumulate photos for incremental caching
        let pendingCachePhotos: PhotoWithLocation[] = [];
        // Map photo ID -> pre-computed country code from iso1A2Code (avoids double lookup)
        const photoCountryCodes = new Map<string, string | null>();
        // Track fire-and-forget cache write promises to await before final read
        const cachePromises: Promise<void>[] = [];

        // Batch callback: cache incrementally and detect countries
        const handleBatch = (batchPhotos: PhotoWithLocation[]) => {
          // Detect new countries from this batch and store the computed code for reuse
          for (const photo of batchPhotos) {
            const code = iso1A2Code([photo.location.longitude, photo.location.latitude]);
            photoCountryCodes.set(photo.id, code ?? null);
            if (code && !discoveredCountryCodes.has(code)) {
              discoveredCountryCodes.add(code);
              discoveredCountries.push({ code, name: getCountryName(code) });
            }
          }

          // Accumulate for incremental caching
          pendingCachePhotos.push(...batchPhotos);

          // Commit to SQLite every INCREMENTAL_CACHE_BATCH photos
          if (pendingCachePhotos.length >= INCREMENTAL_CACHE_BATCH) {
            const toCache = pendingCachePhotos.map((p) =>
              photoToCachedPhoto(p, photoCountryCodes.get(p.id))
            );
            pendingCachePhotos = [];
            // Fire-and-forget cache write (don't block scanning)
            const promise = cachePhotos(toCache).catch((err) => {
              if (__DEV__) console.warn('[PhotoImport] Incremental cache write failed:', err);
            });
            cachePromises.push(promise);
          }
        };

        // Wrap progress to include discovered countries
        const progressWithCountries = (progress: ScanProgress) => {
          if (controller.signal.aborted) return;
          onScanProgress({
            ...progress,
            discoveredCountries:
              discoveredCountries.length > 0 ? discoveredCountries.slice(-10) : undefined,
          });
        };

        if (doIncremental) {
          // Incremental import: load cached photos and scan only new ones
          if (__DEV__) {
            console.log(
              '[PhotoImport] Incremental scan since:',
              new Date(cachedImportTime).toISOString()
            );
          }

          // Load cached photos first (fast)
          allCachedPhotos = await getAllCachedPhotos();

          // Scan only photos created after last import
          newPhotos = await extractPhotosWithLocation(
            progressWithCountries,
            controller.signal,
            new Date(cachedImportTime),
            handleBatch
          );

          if (__DEV__) {
            console.log(
              `[PhotoImport] Loaded ${allCachedPhotos.length} cached, found ${newPhotos.length} new`
            );
          }
        } else {
          // Full scan: no cache, scan all photos
          newPhotos = await extractPhotosWithLocation(
            progressWithCountries,
            controller.signal,
            undefined,
            handleBatch
          );
        }

        // Check for abort after photo extraction
        if (controller.signal.aborted) {
          // Wait for any in-flight cache writes before throwing
          await Promise.all(cachePromises).catch((err) => {
            if (__DEV__) console.error('[PhotoImport] Failed to write batch during abort:', err);
          });
          throw createAbortError('Scan aborted');
        }

        // Wait for all in-flight incremental cache writes to complete
        await Promise.all(cachePromises);

        // Re-check abort after awaiting cache writes
        if (controller.signal.aborted) {
          throw createAbortError('Scan aborted');
        }

        // Flush any remaining photos to cache
        if (pendingCachePhotos.length > 0) {
          const remainingCached = pendingCachePhotos.map((p) =>
            photoToCachedPhoto(p, photoCountryCodes.get(p.id))
          );
          await cachePhotos(remainingCached);
        }

        // Append newly cached photos in memory instead of reloading from SQLite.
        // Both paths already have the data: incremental has allCachedPhotos from
        // the initial load, full scan starts empty. Converting newPhotos avoids a
        // full table scan that grows linearly with library size.
        if (newPhotos.length > 0) {
          const newCached = newPhotos.map((p) =>
            photoToCachedPhoto(p, photoCountryCodes.get(p.id))
          );
          allCachedPhotos = [...allCachedPhotos, ...newCached];
        }

        // Check if we have any photos at all
        if (allCachedPhotos.length === 0 && newPhotos.length === 0) {
          abortControllerRef.current = null;
          return {
            success: false,
            reason: 'no-photos',
            title: 'No Photos Found',
            message:
              'No photos with location data were found in your library. Make sure location services were enabled when you took the photos.',
          };
        }

        // Update last import time using the newest photo's creationTime to avoid
        // missing photos taken during the scan. Falls back to Date.now() for
        // incremental scans where only cached photos exist (no new photos found).
        const importTime =
          newPhotos.length > 0
            ? newPhotos.reduce((max, p) => Math.max(max, p.creationTime.getTime()), 0)
            : Date.now();
        await setLastImportTime(importTime);

        // Segment trips from cached data (fast: no geocoding needed)
        const optimizedData = segmentTripsFromCache(allCachedPhotos, homeCountry);
        let candidates = optimizedData.candidates;
        if (filterCountryCode) {
          candidates = candidates.filter((c) => c.countryCode === filterCountryCode);
        }

        if (candidates.length === 0) {
          abortControllerRef.current = null;
          return {
            success: false,
            reason: 'no-trips',
            title: 'No Trips Found',
            message: filterCountryCode
              ? `No travel photos found for this country. Photos taken in your home country (${homeCountry}) are filtered out.`
              : `No travel photos found. Photos taken in your home country (${homeCountry}) are filtered out.`,
          };
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

        onScanComplete({
          candidates,
          photoLookup: optimizedData.photoLookup,
          clusterLookup: optimizedData.clusterLookup,
          clusterDisplays: optimizedData.clusterDisplays,
          importTime,
          isIncremental: doIncremental,
        });

        abortControllerRef.current = null;
        return { success: true };
      } catch (error) {
        abortControllerRef.current = null;
        if (isAbortError(error)) {
          // Scan was cancelled, not an error
          return { success: false, reason: null };
        } else if (error instanceof HomeCountryNotSetError) {
          Analytics.photoImportScanFailed({ error: 'home_country_not_set' });
          onScanError();
          return {
            success: false,
            reason: 'home-country',
            title: 'Set Home Country',
            message: 'Please set your home country in settings first.',
          };
        } else {
          if (__DEV__) console.error('[PhotoImport] Scan error:', error);
          Analytics.photoImportScanFailed({
            error: error instanceof Error ? error.message.slice(0, 100) : 'unknown',
          });
          onScanError();
          return {
            success: false,
            reason: 'scan-error',
            title: 'Scan Failed',
            message: 'Failed to scan photos. Please try again.',
          };
        }
      }
    },
    [homeCountry, filterCountryCode, onScanProgress, onScanComplete, onScanError]
  );

  const cancelScan = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    Analytics.photoImportScanCancelled();
  }, []);

  return {
    startScan,
    cancelScan,
  };
}
