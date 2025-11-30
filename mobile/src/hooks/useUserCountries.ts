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

const USER_COUNTRIES_KEY = ['user-countries'];

export function useUserCountries() {
  const { session, isGuest } = useAuthStore();
  const { selectedCountries } = useOnboardingStore();

  return useQuery({
    queryKey: USER_COUNTRIES_KEY,
    queryFn: async (): Promise<UserCountry[]> => {
      if (isGuest) {
        // Return mock data from onboarding store for guests
        return selectedCountries.map((countryCode, index) => ({
          id: `guest-${index}`,
          user_id: 'guest',
          country_code: countryCode,
          status: 'visited' as const,
          created_at: new Date().toISOString(),
        }));
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

  return useMutation({
    mutationFn: async ({ country_code, status }: AddUserCountryInput) => {
      const response = await api.post('/countries/user', { country_code, status });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: USER_COUNTRIES_KEY });
    },
    onError: (error) => {
      console.error('Failed to add country:', error);
      Alert.alert('Error', 'Failed to add country. Please try again.');
    },
  });
}

export function useRemoveUserCountry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (countryCode: string) => {
      await api.delete(`/countries/user/${countryCode}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: USER_COUNTRIES_KEY });
    },
    onError: (error) => {
      console.error('Failed to remove country:', error);
      Alert.alert('Error', 'Failed to remove country. Please try again.');
    },
  });
}
