import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient, UseQueryResult } from '@tanstack/react-query';

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

export function useUserCountries(): UseQueryResult<UserCountry[], Error> {
  const { session } = useAuthStore();
  const { selectedCountries, bucketListCountries } = useOnboardingStore();
  const queryKey = getUserCountriesKey(session?.user?.id ?? null);
  const userId = session?.user?.id;

  // Build fallback data from onboarding store for use during migration
  // This provides instant feedback before the query runs
  // Memoized to avoid unnecessary array creation on every render
  const onboardingFallbackData = useMemo<UserCountry[] | undefined>(() => {
    // If there's no onboarding data, don't create fallback
    if (selectedCountries.length === 0 && bucketListCountries.length === 0) {
      return undefined;
    }
    // Create fallback data from onboarding store regardless of isMigrating flag
    // This ensures data is available even if component renders before isMigrating is set
    return [
      ...selectedCountries.map((countryCode, index) => ({
        id: `temp-visited-${index}`,
        user_id: userId ?? 'temp',
        country_code: countryCode,
        status: 'visited' as const,
        created_at: new Date().toISOString(),
        added_during_onboarding: true,
      })),
      ...bucketListCountries.map((countryCode, index) => ({
        id: `temp-wishlist-${index}`,
        user_id: userId ?? 'temp',
        country_code: countryCode,
        status: 'wishlist' as const,
        created_at: new Date().toISOString(),
        added_during_onboarding: true,
      })),
    ];
  }, [selectedCountries, bucketListCountries, userId]);

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

  // During migration or initial load, if query has no data but we have onboarding data,
  // return that data immediately to prevent empty state flash.
  //
  // Migration lifecycle (see guestMigration.ts):
  // 1. User completes onboarding → migrateGuestData() called
  // 2. isMigrating set to true
  // 3. Countries migrated to backend via API
  // 4. Query cache populated directly with migrated data (queryClient.setQueryData)
  // 5. isMigrating set to false in finally block
  //
  // This means by the time isMigrating is cleared, real data is already in the cache.
  // We only show fallback data during the brief window between account creation
  // and cache population. If there's an actual API error, we preserve that state
  // so the user sees the error rather than stale placeholder data.
  if (!query.data && onboardingFallbackData && !query.isError) {
    return {
      ...query,
      data: onboardingFallbackData,
      isLoading: false,
      isFetching: true, // Still fetching real data in background
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
