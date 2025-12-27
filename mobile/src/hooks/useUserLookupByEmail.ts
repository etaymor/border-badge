import { useQuery } from '@tanstack/react-query';

import { api } from '@services/api';

import type { UserSearchResult } from './useUserSearch';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface UseUserLookupByEmailOptions {
  enabled?: boolean;
}

/**
 * Hook to look up a user by their exact email address.
 * Only triggers when a valid email format is provided.
 *
 * Returns the user if found, null if not found.
 */
export function useUserLookupByEmail(email: string, options: UseUserLookupByEmailOptions = {}) {
  const { enabled = true } = options;
  const trimmedEmail = email.trim().toLowerCase();
  const isValidEmail = EMAIL_REGEX.test(trimmedEmail);

  return useQuery<UserSearchResult | null>({
    queryKey: ['users', 'lookup-by-email', trimmedEmail],
    queryFn: async () => {
      const response = await api.get<UserSearchResult | null>('/users/lookup-by-email', {
        params: { email: trimmedEmail },
      });
      return response.data;
    },
    enabled: enabled && isValidEmail,
    staleTime: 1000 * 30, // 30 seconds
  });
}
