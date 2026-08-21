/**
 * useLibrarySyncStatus - the photo-library sync record + freshness, for UI
 * (P1 observability). Background sync failures used to vanish silently; this
 * hook is how screens surface "synced N min ago", "last sync failed", and
 * the manual re-scan escape hatch.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import {
  getLibraryFreshness,
  getLibrarySyncStatus,
  type LibraryFreshness,
  type LibrarySyncStatus,
} from '@services/photoImport/photoLibrarySyncStatus';

export const LIBRARY_SYNC_STATUS_KEY = ['photoLibrarySyncStatus'];

export interface UseLibrarySyncStatusResult {
  status: LibrarySyncStatus | undefined;
  freshness: LibraryFreshness | undefined;
  isLoading: boolean;
  /** Refetch the record (e.g. after a manual re-scan completes). */
  refresh: () => void;
}

export function useLibrarySyncStatus(): UseLibrarySyncStatusResult {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: LIBRARY_SYNC_STATUS_KEY,
    queryFn: async () => {
      const [status, freshness] = await Promise.all([
        getLibrarySyncStatus(),
        getLibraryFreshness(),
      ]);
      return { status, freshness };
    },
    staleTime: 30_000,
  });

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: LIBRARY_SYNC_STATUS_KEY });
  }, [queryClient]);

  return {
    status: query.data?.status,
    freshness: query.data?.freshness,
    isLoading: query.isLoading,
    refresh,
  };
}
