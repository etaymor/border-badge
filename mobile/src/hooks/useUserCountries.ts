import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@services/api';
import { Analytics } from '@services/analytics';
import { useAuthStore } from '@stores/authStore';
import { useOnboardingStore } from '@stores/onboardingStore';

// Note: useOnboardingStore is still used in useUserCountries for migration display

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

export function useUserCountries(): import('@tanstack/react-query').UseQueryResult<UserCountry[], Error> {
  const { session, isMigrating } = useAuthStore();
  const { selectedCountries, bucketListCountries } = useOnboardingStore();
  const queryKey = getUserCountriesKey(session?.user?.id ?? null);

  // Build fallback data from onboarding store for use during migration
  // This provides instant feedback before the query runs
  const onboardingFallbackData: UserCountry[] | undefined =
    isMigrating && (selectedCountries.length > 0 || bucketListCountries.length > 0)
      ? [
          ...selectedCountries.map((countryCode, index) => ({
            id: `temp-visited-${index}`,
            user_id: session?.user?.id ?? 'temp',
            country_code: countryCode,
            status: 'visited' as const,
            created_at: new Date().toISOString(),
            added_during_onboarding: true,
          })),
          ...bucketListCountries.map((countryCode, index) => ({
            id: `temp-wishlist-${index}`,
            user_id: session?.user?.id ?? 'temp',
            country_code: countryCode,
            status: 'wishlist' as const,
            created_at: new Date().toISOString(),
            added_during_onboarding: true,
          })),
        ]
      : undefined;

  const query = useQuery({
    queryKey,
    queryFn: async (): Promise<UserCountry[]> => {
      const response = await api.get('/countries/user');
      return response.data;
    },
    enabled: !!session,
    // Use onboarding data as placeholder during migration
    placeholderData: onboardingFallbackData,
  });

  // During migration, if query hasn't fetched yet but we have onboarding data,
  // return that data immediately to prevent empty state flash
  // Use isFetched instead of !query.data to avoid race conditions where the query
  // has completed but returned empty/different data
  if (isMigrating && !query.isFetched && onboardingFallbackData) {
    return {
      ...query,
      data: onboardingFallbackData,
      isLoading: false,
      isFetching: false,
    } as import('@tanstack/react-query').UseQueryResult<UserCountry[], Error>;
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
