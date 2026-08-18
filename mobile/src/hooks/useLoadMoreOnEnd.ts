import { useCallback } from 'react';

/**
 * Standard infinite-list `onEndReached` handler: fetch the next page only
 * when one exists and no next-page fetch is already in flight.
 *
 * Referentially stable across renders unless one of the inputs changes
 * (same semantics as the inlined `useCallback` it replaces).
 */
export function useLoadMoreOnEnd(
  hasNextPage: boolean | undefined,
  isFetchingNextPage: boolean,
  fetchNextPage: () => void
): () => void {
  return useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);
}
