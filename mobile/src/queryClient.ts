import { QueryClient } from '@tanstack/react-query';

// Stale time constants for different data types
// Use these in individual hooks for optimal caching behavior
export const STALE_TIMES = {
  /** Static reference data that rarely changes (countries list) */
  STATIC: 1000 * 60 * 60 * 24, // 24 hours
  /** User profile data that may change in other sessions */
  PROFILE: 1000 * 60 * 30, // 30 minutes
  /** User-editable data (trips, entries) - default staleTime */
  USER_DATA: 1000 * 60 * 5, // 5 minutes
} as const;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: STALE_TIMES.USER_DATA, // 5 minutes default for user-editable data
      gcTime: 1000 * 60 * 30, // 30 minutes - keep unused data in cache longer
      retry: 2,
      refetchOnWindowFocus: false, // Don't refetch when app comes to foreground
      refetchOnReconnect: true, // Refetch when network reconnects
    },
    mutations: {
      retry: 1,
    },
  },
});
