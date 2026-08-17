import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { socialKeys } from '@hooks/queryKeys';
import { useDebounce } from '@hooks/useDebounce';
import { api } from '@services/api';

export interface UserSearchResult {
  id: string;
  username: string;
  avatar_url: string | null;
  country_count: number;
  is_following: boolean;
}

interface UseUserSearchOptions {
  enabled?: boolean;
  limit?: number;
  debounceMs?: number;
}

/**
 * Hook to search users by username prefix.
 * Requires at least 2 characters to search.
 */
export function useUserSearch(query: string, options: UseUserSearchOptions = {}) {
  const { enabled = true, limit = 10, debounceMs = 300 } = options;
  const debouncedQuery = useDebounce(query, debounceMs);

  return useQuery<UserSearchResult[]>({
    queryKey: socialKeys.userSearchQuery(debouncedQuery, limit),
    queryFn: async ({ signal }) => {
      const response = await api.get<UserSearchResult[]>('/users/search', {
        params: { q: debouncedQuery, limit },
        signal,
      });
      return response.data;
    },
    enabled: enabled && debouncedQuery.length >= 2,
    // Keep showing the previous results while the next query fetches so the
    // dropdown never flickers to empty mid-typing.
    placeholderData: keepPreviousData,
    staleTime: 1000 * 30, // 30 seconds
  });
}
