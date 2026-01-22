import { useEffect, useState } from 'react';

import {
  getLastImportTime,
  getPhotoCountByCountry,
  getTripCandidateCountByCountry,
} from '@services/photoImport';

export interface CountryPhotoInfo {
  /** Whether this country has any cached photos */
  hasPhotos: boolean;
  /** Number of potential trip candidates for this country */
  tripCount: number;
  /** Whether the query is still loading */
  isLoading: boolean;
  /** Whether user has ever done a photo import */
  hasInitialImport: boolean;
}

/**
 * Hook to get photo availability info for a specific country.
 * Uses indexed SQLite queries - fast and safe to call frequently.
 */
export function useCountryPhotoInfo(countryCode: string | undefined): CountryPhotoInfo {
  const [hasPhotos, setHasPhotos] = useState(false);
  const [tripCount, setTripCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [hasInitialImport, setHasInitialImport] = useState(false);

  useEffect(() => {
    if (!countryCode) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    async function loadPhotoInfo() {
      setIsLoading(true);
      try {
        const [photoCount, trips, lastImport] = await Promise.all([
          getPhotoCountByCountry(countryCode),
          getTripCandidateCountByCountry(countryCode),
          getLastImportTime(),
        ]);

        if (!cancelled) {
          setHasPhotos(photoCount > 0);
          setTripCount(trips);
          setHasInitialImport(lastImport !== null);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    loadPhotoInfo();
    return () => {
      cancelled = true;
    };
  }, [countryCode]);

  return {
    hasPhotos,
    tripCount,
    isLoading,
    hasInitialImport,
  };
}
