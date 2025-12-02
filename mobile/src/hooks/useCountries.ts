import { useEffect, useState } from 'react';

import {
  getAllCountries,
  getCountriesByRegion as getCountriesByRegionFromDb,
  searchCountries as searchCountriesFromDb,
  getCountryByCode as getCountryByCodeFromDb,
  getCountriesByCodes as getCountriesByCodesFromDb,
  type Country,
} from '@services/countriesDb';

// Re-export Country type for convenience
export type { Country } from '@services/countriesDb';

/**
 * Hook to get all countries from local SQLite database.
 * Countries are synced on app launch via useCountriesSync().
 */
export function useCountries() {
  const [data, setData] = useState<Country[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadCountries() {
      try {
        const countries = await getAllCountries();
        if (isMounted) {
          setData(countries);
          setIsLoading(false);
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err : new Error('Failed to load countries'));
          setIsLoading(false);
        }
      }
    }

    loadCountries();

    return () => {
      isMounted = false;
    };
  }, []);

  return { data, isLoading, error };
}

/**
 * Hook to get countries filtered by region from local SQLite database.
 */
export function useCountriesByRegion(region: string) {
  const [data, setData] = useState<Country[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadCountries() {
      try {
        setIsLoading(true);
        const countries = await getCountriesByRegionFromDb(region);
        if (isMounted) {
          setData(countries);
          setIsLoading(false);
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err : new Error('Failed to load countries'));
          setIsLoading(false);
        }
      }
    }

    loadCountries();

    return () => {
      isMounted = false;
    };
  }, [region]);

  return { data, isLoading, error };
}

/**
 * Hook to search countries by name or code from local SQLite database.
 * Returns max 10 results for autocomplete performance.
 */
export function useSearchCountries(query: string, limit: number = 10) {
  const [data, setData] = useState<Country[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function searchCountries() {
      if (!query || query.trim().length === 0) {
        if (isMounted) {
          setData([]);
          setIsLoading(false);
        }
        return;
      }

      setIsLoading(true);
      try {
        const countries = await searchCountriesFromDb(query, limit);
        if (isMounted) {
          setData(countries);
          setIsLoading(false);
        }
      } catch {
        if (isMounted) {
          setData([]);
          setIsLoading(false);
        }
      }
    }

    searchCountries();

    return () => {
      isMounted = false;
    };
  }, [query, limit]);

  return { data, isLoading };
}

/**
 * Hook to get a single country by code.
 * Useful for displaying selected country details.
 */
export function useCountryByCode(code: string | null | undefined) {
  const [data, setData] = useState<Country | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function loadCountry() {
      if (!code) {
        if (isMounted) {
          setData(null);
          setIsLoading(false);
        }
        return;
      }

      setIsLoading(true);
      try {
        const country = await getCountryByCodeFromDb(code);
        if (isMounted) {
          setData(country);
          setIsLoading(false);
        }
      } catch {
        if (isMounted) {
          setData(null);
          setIsLoading(false);
        }
      }
    }

    loadCountry();

    return () => {
      isMounted = false;
    };
  }, [code]);

  return { data, isLoading };
}

/**
 * Function to get countries by codes (non-hook version for callbacks).
 */
export async function getCountriesByCodes(codes: string[]): Promise<Country[]> {
  return getCountriesByCodesFromDb(codes);
}

/**
 * Function to search countries (non-hook version for direct calls).
 */
export async function searchCountriesAsync(query: string, limit: number = 10): Promise<Country[]> {
  return searchCountriesFromDb(query, limit);
}
