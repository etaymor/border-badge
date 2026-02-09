/**
 * usePhotoScan - Hook for scanning photos and building trip candidates.
 *
 * Handles photo extraction, caching, and trip segmentation.
 */

import { useCallback, useRef } from 'react';
import { Alert } from 'react-native';

import { iso1A2Code } from '@rapideditor/country-coder';

import {
  extractPhotosWithLocation,
  segmentTripsFromCache,
  photoToCachedPhoto,
  HomeCountryNotSetError,
  getLastImportTime,
  setLastImportTime,
  getAllCachedPhotos,
  cachePhotos,
  clearPhotoCache,
  abortBackgroundSync,
  type ScanProgress,
  type TripCandidateDisplay,
  type LocationCluster,
  type LocationClusterDisplay,
  type PhotoWithLocation,
  type CachedPhoto,
} from '@services/photoImport';
import { Analytics } from '@services/analytics';
import { isAbortError, createAbortError } from './photoImportUtils';

/** Batch size for incremental cache commits during scanning */
const INCREMENTAL_CACHE_BATCH = 500;

/** Resolve country code to display name */
const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
function getCountryName(code: string): string {
  try {
    return regionNames.of(code) ?? code;
  } catch {
    return code;
  }
}

export interface ScanResult {
  candidates: TripCandidateDisplay[];
  photoLookup: Map<string, PhotoWithLocation>;
  clusterLookup: Map<string, LocationCluster>;
  clusterDisplays: Map<string, LocationClusterDisplay>;
  importTime: number;
  isIncremental: boolean;
}

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
    async (forceRefresh = false) => {
      if (!homeCountry) {
        Alert.alert(
          'Set Home Country',
          'Please set your home country in settings first. This helps us filter out local photos.',
          [{ text: 'OK' }]
        );
        return false;
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
        const discoveredCountries: Array<{ code: string; name: string }> = [];

        // Accumulate photos for incremental caching
        let pendingCachePhotos: PhotoWithLocation[] = [];

        // Batch callback: cache incrementally and detect countries
        const handleBatch = (batchPhotos: PhotoWithLocation[]) => {
          // Detect new countries from this batch
          for (const photo of batchPhotos) {
            const code = iso1A2Code([photo.location.longitude, photo.location.latitude]);
            if (code && !discoveredCountryCodes.has(code)) {
              discoveredCountryCodes.add(code);
              discoveredCountries.push({ code, name: getCountryName(code) });
            }
          }

          // Accumulate for incremental caching
          pendingCachePhotos.push(...batchPhotos);

          // Commit to SQLite every INCREMENTAL_CACHE_BATCH photos
          if (pendingCachePhotos.length >= INCREMENTAL_CACHE_BATCH) {
            const toCache = pendingCachePhotos.map(photoToCachedPhoto);
            pendingCachePhotos = [];
            // Fire-and-forget cache write (don't block scanning)
            cachePhotos(toCache).catch((err) => {
              if (__DEV__) console.warn('[PhotoImport] Incremental cache write failed:', err);
            });
          }
        };

        // Wrap progress to include discovered countries
        const progressWithCountries = (progress: ScanProgress) => {
          if (controller.signal.aborted) return;
          onScanProgress({
            ...progress,
            discoveredCountries: discoveredCountries.length > 0 ? discoveredCountries : undefined,
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
          throw createAbortError('Scan aborted');
        }

        // Flush any remaining photos to cache
        if (pendingCachePhotos.length > 0) {
          const remainingCached = pendingCachePhotos.map(photoToCachedPhoto);
          await cachePhotos(remainingCached);
        }

        // Reload all cached photos to get the full set (including incrementally cached ones)
        if (newPhotos.length > 0) {
          allCachedPhotos = await getAllCachedPhotos();
        }

        // Update last import time using the newest photo's creationTime to avoid
        // missing photos taken during the scan. Falls back to Date.now() if no photos.
        const importTime =
          newPhotos.length > 0
            ? Math.max(...newPhotos.map((p) => p.creationTime.getTime()))
            : Date.now();
        await setLastImportTime(importTime);

        // Check if we have any photos at all
        if (allCachedPhotos.length === 0 && newPhotos.length === 0) {
          Alert.alert(
            'No Photos Found',
            'No photos with location data were found in your library. Make sure location services were enabled when you took the photos.',
            [{ text: 'OK' }]
          );
          abortControllerRef.current = null;
          return false;
        }

        // Segment trips from cached data (fast: no geocoding needed)
        const optimizedData = segmentTripsFromCache(allCachedPhotos, homeCountry);
        let candidates = optimizedData.candidates;
        if (filterCountryCode) {
          candidates = candidates.filter((c) => c.countryCode === filterCountryCode);
        }

        if (candidates.length === 0) {
          Alert.alert(
            'No Trips Found',
            filterCountryCode
              ? `No travel photos found for this country. Photos taken in your home country (${homeCountry}) are filtered out.`
              : `No travel photos found. Photos taken in your home country (${homeCountry}) are filtered out.`,
            [{ text: 'OK' }]
          );
          abortControllerRef.current = null;
          return false;
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
        return true;
      } catch (error) {
        abortControllerRef.current = null;
        if (isAbortError(error)) {
          // Scan was cancelled, not an error
          return false;
        } else if (error instanceof HomeCountryNotSetError) {
          Alert.alert('Set Home Country', 'Please set your home country in settings first.');
          Analytics.photoImportScanFailed({ error: 'home_country_not_set' });
        } else {
          if (__DEV__) console.error('[PhotoImport] Scan error:', error);
          Alert.alert('Scan Failed', 'Failed to scan photos. Please try again.');
          Analytics.photoImportScanFailed({
            error: error instanceof Error ? error.message.slice(0, 100) : 'unknown',
          });
        }
        onScanError();
        return false;
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
