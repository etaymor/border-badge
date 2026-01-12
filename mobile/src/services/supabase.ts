import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';

import { env } from '@config/env';
import { updateCachedToken } from './api';

/**
 * Get SecureStore options for iOS to enable keychain sharing with Share Extension.
 * On Android, returns empty options (no keychain sharing needed).
 */
const getSecureStoreOptions = (): SecureStore.SecureStoreOptions => {
  return {};
};

const ExpoSecureStoreAdapter = {
  getItem: async (key: string): Promise<string | null> => {
    try {
      const options = getSecureStoreOptions();
      return await SecureStore.getItemAsync(key, options);
    } catch (error) {
      console.error(`SecureStore getItem failed for key "${key}":`, error);
      return null;
    }
  },
  setItem: async (key: string, value: string): Promise<void> => {
    try {
      const options = getSecureStoreOptions();
      await SecureStore.setItemAsync(key, value, options);
    } catch (error) {
      console.error(`SecureStore setItem failed for key "${key}":`, error);
      // Silent fail - Supabase will handle missing session gracefully
    }
  },
  removeItem: async (key: string): Promise<void> => {
    try {
      const options = getSecureStoreOptions();
      await SecureStore.deleteItemAsync(key, options);
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
    // Explicitly handles: SIGNED_IN, INITIAL_SESSION, TOKEN_REFRESHED
    // This also safely handles any future auth events that include a session
    updateCachedToken(session.access_token);
  }
});
