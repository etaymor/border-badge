/**
 * usePhotoScan - Hook for scanning photos and building trip candidates.
 *
 * Handles photo extraction, caching, and trip segmentation.
 */

import { useCallback, useRef } from 'react';
import { Alert } from 'react-native';

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
            (progress) => {
              if (controller.signal.aborted) return;
              onScanProgress(progress);
            },
            controller.signal,
            new Date(cachedImportTime)
          );

          if (__DEV__) {
            console.log(
              `[PhotoImport] Loaded ${allCachedPhotos.length} cached, found ${newPhotos.length} new`
            );
          }
        } else {
          // Full scan: no cache, scan all photos
          newPhotos = await extractPhotosWithLocation((progress) => {
            if (controller.signal.aborted) return;
            onScanProgress(progress);
          }, controller.signal);
        }

        // Check for abort after photo extraction
        if (controller.signal.aborted) {
          throw createAbortError('Scan aborted');
        }

        // Cache new photos if we found any
        if (newPhotos.length > 0) {
          const newCachedPhotos = newPhotos.map(photoToCachedPhoto);
          await cachePhotos(newCachedPhotos);
          allCachedPhotos = [...allCachedPhotos, ...newCachedPhotos];
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
        Analytics.photoImportScanCompleted({
          photoCount: totalPhotoCount,
          tripCandidateCount: candidates.length,
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
