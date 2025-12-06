import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@services/api';
import { useAuthStore } from '@stores/authStore';
import { useOnboardingStore } from '@stores/onboardingStore';

// Note: useOnboardingStore is still used in useUserCountries for migration display

export interface UserCountry {
  id: string;
  user_id: string;
  country_code: string;
  status: 'visited' | 'wishlist';
  created_at: string;
}

// Dynamic query key to isolate cache per user session
function getUserCountriesKey(sessionId: string | null) {
  return ['user-countries', sessionId] as const;
}

export function useUserCountries() {
  const { session, isMigrating } = useAuthStore();
  const { selectedCountries, bucketListCountries } = useOnboardingStore();
  const queryKey = getUserCountriesKey(session?.user?.id ?? null);

  return useQuery({
    queryKey,
    queryFn: async (): Promise<UserCountry[]> => {
      // During migration, return onboarding store data
      // This provides instant feedback while backend sync happens in background
      if (isMigrating) {
        const visited = selectedCountries.map((countryCode, index) => ({
          id: `temp-visited-${index}`,
          user_id: session?.user?.id ?? 'temp',
          country_code: countryCode,
          status: 'visited' as const,
          created_at: new Date().toISOString(),
        }));
        const wishlist = bucketListCountries.map((countryCode, index) => ({
          id: `temp-wishlist-${index}`,
          user_id: session?.user?.id ?? 'temp',
          country_code: countryCode,
          status: 'wishlist' as const,
          created_at: new Date().toISOString(),
        }));
        return [...visited, ...wishlist];
      }

      const response = await api.get('/countries/user');
      return response.data;
    },
    enabled: !!session,
  });
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
    onSuccess: () => {
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
