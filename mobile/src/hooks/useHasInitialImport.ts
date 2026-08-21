/**
 * useHasInitialImport - has this device ever completed a photo library scan?
 *
 * Reads only the `last_import_time` watermark. `usePhotoTrips()` exposes the
 * same flag, but it also loads every trip segment (and can fall back to
 * clustering the whole photo cache), which is far too heavy for surfaces that
 * just need the yes/no - e.g. deciding whether the passport home shows Guess
 * Where or the photo-sync callout.
 *
 * The app has no React Query AppState focus manager, so callers that can be
 * away while an import completes should call `refresh()` from useFocusEffect.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { getLastImportTime } from '@services/photoImport/photoCacheDb';

export const LAST_IMPORT_TIME_KEY = ['photoLastImportTime'];

export interface UseHasInitialImportResult {
  /** True once any scan has written the watermark. */
  hasInitialImport: boolean;
  isLoading: boolean;
  /**
   * The watermark could not be read, so `hasInitialImport` is the safe
   * fallback rather than an observation. Analytics has to say so, or the
   * card-impression denominator quietly lies.
   */
  isError: boolean;
  /** Refetch the watermark (e.g. on returning from PhotoImport). */
  refresh: () => void;
}

export function useHasInitialImport(): UseHasInitialImportResult {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: LAST_IMPORT_TIME_KEY,
    queryFn: getLastImportTime,
    staleTime: 30_000,
  });

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: LAST_IMPORT_TIME_KEY });
  }, [queryClient]);

  return {
    // An unreadable cache is NOT evidence of a fresh install: react-query gives
    // up after its retries with `data === undefined`, and defaulting that to
    // false would pitch "Sync Your Photos" at someone whose library is already
    // synced. On error, fall back to the pre-existing behaviour instead.
    hasInitialImport: query.data != null || query.isError,
    isLoading: query.isLoading,
    isError: query.isError,
    refresh,
  };
}
