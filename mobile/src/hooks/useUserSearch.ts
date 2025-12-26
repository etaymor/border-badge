import { useQuery } from '@tanstack/react-query';
import { useState, useEffect } from 'react';

import { api } from '@services/api';

// User search result interface
export interface UserSearchResult {
  id: string;
  username: string;
  avatar_url: string | null;
  country_count: number;
  is_following: boolean;
}

const USER_SEARCH_KEY = ['user-search'];

// Search users by username (with debouncing)
export function useUserSearch(query: string, debounceMs = 300) {
  const [debouncedQuery, setDebouncedQuery] = useState(query);

  // Debounce the search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
    }, debounceMs);

    return () => clearTimeout(timer);
  }, [query, debounceMs]);

  return useQuery({
    queryKey: [...USER_SEARCH_KEY, debouncedQuery],
    queryFn: async (): Promise<UserSearchResult[]> => {
      if (!debouncedQuery || debouncedQuery.length < 2) {
        return [];
      }

      const response = await api.get('/users/search', {
        params: { q: debouncedQuery },
      });
      return response.data;
    },
    enabled: debouncedQuery.length >= 2,
    staleTime: 1000 * 60, // 1 minute
  });
}

// Check username availability
export function useUsernameCheck() {
  return async (username: string): Promise<{ available: boolean; suggestions: string[] }> => {
    if (!username || username.length < 3) {
      return { available: false, suggestions: [] };
    }

    try {
      const response = await api.post('/users/check-username', { username });
      return response.data;
    } catch {
      // If error, assume not available
      return { available: false, suggestions: [] };
    }
  };
}
