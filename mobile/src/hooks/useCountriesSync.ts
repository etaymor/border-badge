/**
 * Hook to sync countries from Supabase to local SQLite database.
 * Fetches countries only if local data is empty or stale (>24 hours).
 */

import { useEffect, useState } from 'react';

import { supabase } from '@services/supabase';
import { needsSync, saveCountries, getCountriesCount, type Country } from '@services/countriesDb';

interface SyncState {
  isLoading: boolean;
  isSynced: boolean;
  error: string | null;
  countriesCount: number;
}

/**
 * Fetches countries from Supabase
 */
async function fetchCountriesFromSupabase(): Promise<Country[]> {
  const { data, error } = await supabase.from('country').select('code, name, region').order('name');

  if (error) {
    throw new Error(error.message);
  }

  return data || [];
}

/**
 * Hook to ensure countries are synced to local database.
 * Call this at app initialization.
 */
export function useCountriesSync(): SyncState {
  const [state, setState] = useState<SyncState>({
    isLoading: true,
    isSynced: false,
    error: null,
    countriesCount: 0,
  });

  useEffect(() => {
    let isMounted = true;

    async function syncCountries() {
      try {
        // Check if sync is needed
        const shouldSync = await needsSync();

        if (shouldSync) {
          // Fetch from Supabase
          const countries = await fetchCountriesFromSupabase();

          if (!isMounted) return;

          if (countries.length === 0) {
            setState({
              isLoading: false,
              isSynced: false,
              error: 'No countries found in database',
              countriesCount: 0,
            });
            return;
          }

          // Save to local SQLite
          await saveCountries(countries);

          if (!isMounted) return;

          setState({
            isLoading: false,
            isSynced: true,
            error: null,
            countriesCount: countries.length,
          });
        } else {
          // Already synced, just get the count
          const count = await getCountriesCount();

          if (!isMounted) return;

          setState({
            isLoading: false,
            isSynced: true,
            error: null,
            countriesCount: count,
          });
        }
      } catch (error) {
        if (!isMounted) return;

        const message = error instanceof Error ? error.message : 'Failed to sync countries';
        setState({
          isLoading: false,
          isSynced: false,
          error: message,
          countriesCount: 0,
        });
      }
    }

    syncCountries();

    return () => {
      isMounted = false;
    };
  }, []);

  return state;
}

/**
 * Force a fresh sync of countries data.
 * Useful for pull-to-refresh or manual sync button.
 */
export async function forceCountriesSync(): Promise<{ success: boolean; error?: string }> {
  try {
    const countries = await fetchCountriesFromSupabase();

    if (countries.length === 0) {
      return { success: false, error: 'No countries found in database' };
    }

    await saveCountries(countries);
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to sync countries';
    return { success: false, error: message };
  }
}
