import { useQuery } from '@tanstack/react-query';

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
}

/**
 * Hook to search users by username prefix.
 * Requires at least 2 characters to search.
 */
export function useUserSearch(query: string, options: UseUserSearchOptions = {}) {
  const { enabled = true, limit = 10 } = options;

  return useQuery<UserSearchResult[]>({
    queryKey: ['users', 'search', query, limit],
    queryFn: async () => {
      const response = await api.get<UserSearchResult[]>('/users/search', {
        params: { q: query, limit },
      });
      return response.data;
    },
    enabled: enabled && query.length >= 2,
    staleTime: 1000 * 30, // 30 seconds
  });
}
