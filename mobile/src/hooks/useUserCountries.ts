import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient, UseQueryResult } from '@tanstack/react-query';

import { api } from '@services/api';
import { Analytics } from '@services/analytics';
import { getLocalUserCountries, type LocalUserCountry } from '@services/countriesDb';
import { useAuthStore } from '@stores/authStore';

export interface UserCountry {
  id: string;
  user_id: string;
  country_code: string;
  status: 'visited' | 'wishlist';
  created_at: string;
  added_during_onboarding: boolean;
}

// Dynamic query key to isolate cache per user session
function getUserCountriesKey(sessionId: string | null) {
  return ['user-countries', sessionId] as const;
}

/**
 * Convert LocalUserCountry (SQLite) to UserCountry (API format).
 */
function localToUserCountry(local: LocalUserCountry, userId: string): UserCountry {
  return {
    id: local.id,
    user_id: userId,
    country_code: local.country_code,
    status: local.status,
    created_at: local.created_at,
    added_during_onboarding: local.added_during_onboarding,
  };
}

export function useUserCountries(): UseQueryResult<UserCountry[], Error> {
  const { session, isMigrating } = useAuthStore();
  const queryKey = getUserCountriesKey(session?.user?.id ?? null);
  const userId = session?.user?.id ?? 'temp';

  // Local SQLite data - loaded on mount for immediate display
  const [localData, setLocalData] = useState<UserCountry[]>([]);
  const [localLoaded, setLocalLoaded] = useState(false);

  // Load from SQLite on mount
  // This provides instant data before any network calls
  useEffect(() => {
    let isMounted = true;

    getLocalUserCountries()
      .then((data) => {
        if (isMounted && data.length > 0) {
          setLocalData(data.map((d) => localToUserCountry(d, userId)));
        }
      })
      .catch((err) => {
        console.warn('Failed to load local user countries:', err);
      })
      .finally(() => {
        if (isMounted) {
          setLocalLoaded(true);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [userId]);

  const query = useQuery({
    queryKey,
    queryFn: async (): Promise<UserCountry[]> => {
      const response = await api.get('/countries/user');
      return response.data;
    },
    enabled: !!session && !isMigrating, // avoid premature empty responses while migration runs
  });

  // Priority order for data:
  // 1. Query data (from API/cache) - most authoritative when available
  // 2. Local SQLite data - instant display during onboarding transition
  //
  // If query is loading but we have local data, use local data immediately.
  // This prevents the empty/zero state flash after onboarding.
  const shouldUseLocal =
    localLoaded &&
    localData.length > 0 &&
    !query.isError &&
    (isMigrating || query.isLoading || query.isFetching || !query.data || query.data.length === 0);

  if (shouldUseLocal) {
    return {
      ...query,
      data: localData,
      isLoading: false,
      isFetching: query.isFetching,
      isPending: false,
      isSuccess: true,
    } as unknown as UseQueryResult<UserCountry[], Error>;
  }

  return query;
}

interface AddUserCountryInput {
  country_code: string;
  status: 'visited' | 'wishlist';
}

export function useAddUserCountry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ country_code, status }: AddUserCountryInput) => {
      const response = await api.post('/countries/user', { country_code, status });
      return response.data;
    },
    onSuccess: (_, variables) => {
      // Track country addition
      if (variables.status === 'visited') {
        Analytics.addCountryVisited(variables.country_code);
      } else {
        Analytics.addCountryWishlist(variables.country_code);
      }

      // Invalidate all user-countries queries (any session)
      queryClient.invalidateQueries({ queryKey: ['user-countries'] });
    },
    onError: (error) => {
      console.error('Failed to add country:', error);
      // Error UI is handled by the calling component via mutation options
    },
  });
}

export function useRemoveUserCountry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (countryCode: string) => {
      await api.delete(`/countries/user/by-code/${countryCode}`);
    },
    onSuccess: () => {
      // Invalidate all user-countries queries (any session)
      queryClient.invalidateQueries({ queryKey: ['user-countries'] });
    },
    onError: (error) => {
      console.error('Failed to remove country:', error);
      // Error UI is handled by the calling component via mutation options
    },
  });
}
