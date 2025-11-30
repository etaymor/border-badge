import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert } from 'react-native';

import { api } from '@services/api';
import { useAuthStore } from '@stores/authStore';
import { useOnboardingStore } from '@stores/onboardingStore';

export interface UserCountry {
  id: string;
  user_id: string;
  country_code: string;
  status: 'visited' | 'wishlist';
  created_at: string;
}

// Dynamic query key to isolate cache per user/guest session
function getUserCountriesKey(sessionId: string | null, isGuest: boolean) {
  return ['user-countries', isGuest ? 'guest' : sessionId] as const;
}

export function useUserCountries() {
  const { session, isGuest } = useAuthStore();
  const { selectedCountries, bucketListCountries } = useOnboardingStore();
  const queryKey = getUserCountriesKey(session?.user?.id ?? null, isGuest);

  return useQuery({
    queryKey,
    queryFn: async (): Promise<UserCountry[]> => {
      if (isGuest) {
        // Return mock data from onboarding store for guests
        const visited = selectedCountries.map((countryCode, index) => ({
          id: `guest-visited-${index}`,
          user_id: 'guest',
          country_code: countryCode,
          status: 'visited' as const,
          created_at: new Date().toISOString(),
        }));
        const wishlist = bucketListCountries.map((countryCode, index) => ({
          id: `guest-wishlist-${index}`,
          user_id: 'guest',
          country_code: countryCode,
          status: 'wishlist' as const,
          created_at: new Date().toISOString(),
        }));
        return [...visited, ...wishlist];
      }

      const response = await api.get('/countries/user');
      return response.data;
    },
    enabled: !!session || isGuest,
  });
}

interface AddUserCountryInput {
  country_code: string;
  status: 'visited' | 'wishlist';
}

export function useAddUserCountry() {
  const queryClient = useQueryClient();
  const { isGuest } = useAuthStore();
  const { toggleCountry, toggleBucketListCountry } = useOnboardingStore();

  return useMutation({
    mutationFn: async ({ country_code, status }: AddUserCountryInput) => {
      if (isGuest) {
        // For guests, update local store instead of API
        if (status === 'visited') {
          toggleCountry(country_code);
        } else {
          toggleBucketListCountry(country_code);
        }
        return {
          id: `guest-${Date.now()}`,
          user_id: 'guest',
          country_code,
          status,
          created_at: new Date().toISOString(),
        };
      }
      const response = await api.post('/countries/user', { country_code, status });
      return response.data;
    },
    onSuccess: () => {
      // Invalidate all user-countries queries (any session)
      queryClient.invalidateQueries({ queryKey: ['user-countries'] });
    },
    onError: (error) => {
      console.error('Failed to add country:', error);
      Alert.alert('Error', 'Failed to add country. Please try again.');
    },
  });
}

export function useRemoveUserCountry() {
  const queryClient = useQueryClient();
  const { isGuest } = useAuthStore();
  const { toggleCountry, toggleBucketListCountry, selectedCountries, bucketListCountries } =
    useOnboardingStore();

  return useMutation({
    mutationFn: async (countryCode: string) => {
      if (isGuest) {
        // For guests, update local store instead of API
        // Remove from whichever list it's in
        if (selectedCountries.includes(countryCode)) {
          toggleCountry(countryCode);
        }
        if (bucketListCountries.includes(countryCode)) {
          toggleBucketListCountry(countryCode);
        }
        return;
      }
      await api.delete(`/countries/user/${countryCode}`);
    },
    onSuccess: () => {
      // Invalidate all user-countries queries (any session)
      queryClient.invalidateQueries({ queryKey: ['user-countries'] });
    },
    onError: (error) => {
      console.error('Failed to remove country:', error);
      Alert.alert('Error', 'Failed to remove country. Please try again.');
    },
  });
}
