/**
 * Hook to find cached photos near a selected place's coordinates.
 *
 * Uses the SQLite geohash-indexed photo cache for fast spatial queries.
 * Returns empty results when coordinates are null or cache is empty.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { SelectedPlace } from '@components/places';
import { getPhotosNearLocation, hasCachedPhotos } from '@services/photoImport/photoCacheDb';
import type { CachedPhoto } from '@services/photoImport/types';

interface UseNearbyPhotosResult {
  photos: CachedPhoto[];
  isLoading: boolean;
  cacheExists: boolean;
}

export function useNearbyPhotos(place: SelectedPlace | null): UseNearbyPhotosResult {
  const [photos, setPhotos] = useState<CachedPhoto[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [cacheExists, setCacheExists] = useState(false);

  // Track the current request to discard stale results when place changes
  const requestIdRef = useRef(0);

  // Check cache existence once on mount
  useEffect(() => {
    hasCachedPhotos()
      .then(setCacheExists)
      .catch(() => setCacheExists(false));
  }, []);

  const search = useCallback(async (lat: number, lon: number, reqId: number) => {
    setIsLoading(true);
    try {
      const results = await getPhotosNearLocation(lat, lon);
      // Only apply results if this is still the current request
      if (reqId === requestIdRef.current) {
        setPhotos(results);
      }
    } catch {
      if (reqId === requestIdRef.current) {
        setPhotos([]);
      }
    } finally {
      if (reqId === requestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const lat = place?.latitude;
    const lon = place?.longitude;

    if (lat == null || lon == null) {
      setPhotos([]);
      setIsLoading(false);
      return;
    }

    const reqId = ++requestIdRef.current;
    search(lat, lon, reqId);
  }, [place?.latitude, place?.longitude, search]);

  return { photos, isLoading, cacheExists };
}
