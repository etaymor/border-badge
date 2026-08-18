import { useQuery } from '@tanstack/react-query';

import { api } from '@services/api';

interface UsernameCheckResponse {
  available: boolean;
  reason: string | null;
  suggestions: string[];
}

/**
 * Hook to check username availability.
 *
 * @param username - The username to check
 * @param enabled - Whether to enable the query (default: true when username is valid)
 * @returns Query result with availability status and suggestions
 */
export function useUsernameCheck(username: string, enabled?: boolean) {
  // Only enable when username is at least 3 chars
  const shouldEnable = enabled ?? username.length >= 3;

  return useQuery<UsernameCheckResponse>({
    queryKey: ['username-check', username],
    queryFn: async () => {
      const response = await api.get<UsernameCheckResponse>('/users/check-username', {
        params: { username },
      });
      return response.data;
    },
    enabled: shouldEnable,
    staleTime: 1000 * 60, // Cache for 1 minute
    retry: false, // Don't retry on failure
  });
}
