import { useQuery } from '@tanstack/react-query';

import { api } from '@services/api';

export interface Country {
  code: string;
  name: string;
  region: string;
}

const COUNTRIES_QUERY_KEY = ['countries'];

// Fetch all countries (for trip creation dropdown)
export function useCountries() {
  return useQuery({
    queryKey: COUNTRIES_QUERY_KEY,
    queryFn: async (): Promise<Country[]> => {
      const response = await api.get('/countries');
      return response.data;
    },
    staleTime: 1000 * 60 * 60 * 24, // Cache for 24 hours - countries don't change often
  });
}

// Get visited countries summary for the map
export function useVisitedCountries() {
  return useQuery({
    queryKey: ['visited-countries'],
    queryFn: async (): Promise<string[]> => {
      const response = await api.get('/trips/countries');
      return response.data;
    },
  });
}
