import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';

import { env } from '@config/env';
import { updateCachedToken } from './api';

const ExpoSecureStoreAdapter = {
  getItem: async (key: string): Promise<string | null> => {
    try {
      return await SecureStore.getItemAsync(key);
    } catch (error) {
      console.error(`SecureStore getItem failed for key "${key}":`, error);
      return null;
    }
  },
  setItem: async (key: string, value: string): Promise<void> => {
    try {
      await SecureStore.setItemAsync(key, value);
    } catch (error) {
      console.error(`SecureStore setItem failed for key "${key}":`, error);
      // Silent fail - Supabase will handle missing session gracefully
    }
  },
  removeItem: async (key: string): Promise<void> => {
    try {
      await SecureStore.deleteItemAsync(key);
    } catch (error) {
      console.error(`SecureStore removeItem failed for key "${key}":`, error);
      // Silent fail - item may already not exist
    }
  },
};

export const supabase = createClient(env.supabaseUrl, env.supabaseAnonKey, {
  auth: {
    storage: ExpoSecureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Keep API token cache in sync with Supabase auth state
supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_OUT') {
    updateCachedToken(null);
  } else if (session?.access_token) {
    // Handle SIGNED_IN, INITIAL_SESSION, TOKEN_REFRESHED, and any future events
    updateCachedToken(session.access_token);
  }
});
