import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// NOTE: iOS Simulator cannot access localhost. Use your machine's IP address instead.
// Example: http://192.168.1.100:8000
const BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000';

const TOKEN_KEY = 'auth_token';
const REFRESH_TOKEN_KEY = 'refresh_token';
const ONBOARDING_COMPLETE_KEY = 'onboarding_complete';

/**
 * SecureStore options
 *
 * IMPORTANT:
 * We intentionally do NOT set iOS `accessGroup` here.
 *
 * The main app’s default keychain access group is already:
 *   $(AppIdentifierPrefix)com.atlasi.app
 *
 * The Share Extension is granted access to that same group via entitlements and reads using
 * KeychainAccessGroup from its Info.plist. Hardcoding a TeamID in JS is brittle (preview/internal
 * builds can be signed with a different team), and leads to the extension seeing -25300.
 */
const getSecureStoreOptions = (): SecureStore.SecureStoreOptions => ({});

// In-memory token cache to avoid SecureStore I/O on every request
let cachedToken: string | null = null;
// Promise to deduplicate concurrent token fetches
let tokenFetchPromise: Promise<string | null> | null = null;

/**
 * Fetch token with a defensive fallback.
 *
 * Historically, we experimented with storing tokens in different SecureStore locations.
 * We now always use the default keychain access group (no explicit accessGroup option),
 * and fall back to a legacy read on iOS only if needed.
 */
async function fetchTokenWithMigration(key: string): Promise<string | null> {
  // Default location (recommended)
  let token = await SecureStore.getItemAsync(key, getSecureStoreOptions());
  if (token) {
    return token;
  }

  // Legacy fallback: explicitly try without options (older builds)
  if (Platform.OS === 'ios') {
    try {
      token = await SecureStore.getItemAsync(key);
      if (token) {
        return token;
      }
    } catch {
      // Ignore errors reading legacy keychain
    }
  }

  return null;
}

// Callback for sign out action - decouples API from auth store
let onSignOutCallback: (() => void) | null = null;

// Flag to suppress auto-sign-out during critical flows (e.g., migration after sign-up)
let suppressAutoSignOut = false;
// Timeout handle for auto-resetting the suppress flag
let suppressTimeout: NodeJS.Timeout | null = null;

/**
 * Register a callback to be invoked when authentication fails and user should be signed out.
 * Call this once during app initialization with your auth store's signOut method.
 */
export function setSignOutCallback(callback: () => void): void {
  onSignOutCallback = callback;
}

/**
 * Temporarily suppress automatic sign-out on 401 errors.
 * Use during critical flows like migration where a race condition could cause
 * premature sign-out before tokens are fully established.
 *
 * Safety: Automatically resets after 30 seconds to prevent stuck state.
 */
export function setSuppressAutoSignOut(suppress: boolean): void {
  // Clear any existing timeout
  if (suppressTimeout) {
    clearTimeout(suppressTimeout);
    suppressTimeout = null;
  }

  suppressAutoSignOut = suppress;

  // Auto-reset after 30 seconds as a safety net
  // This prevents the flag from getting stuck if migration fails unexpectedly
  if (suppress) {
    suppressTimeout = setTimeout(() => {
      console.warn(
        '[API] Auto-signout suppress safety timeout triggered - this may indicate a slow migration'
      );
      suppressAutoSignOut = false;
      suppressTimeout = null;
    }, 30000);
  }
}

/**
 * Update the cached token. Called when Supabase refreshes the token.
 */
export function updateCachedToken(token: string | null): void {
  cachedToken = token;
}

export const api: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000, // 30s timeout for batch operations during migration
});

// Request interceptor to add auth token
api.interceptors.request.use(
  async (config: InternalAxiosRequestConfig) => {
    // Use cached token if available, otherwise fetch from SecureStore
    let token = cachedToken;
    if (!token) {
      // Deduplicate concurrent token fetches - only one SecureStore read at a time
      if (!tokenFetchPromise) {
        tokenFetchPromise = fetchTokenWithMigration(TOKEN_KEY).then((t) => {
          cachedToken = t;
          tokenFetchPromise = null;
          return t;
        });
      }
      token = await tokenFetchPromise;
    }
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor for handling auth errors
// Note: Token refresh is handled by Supabase SDK automatically
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    // If 401, sign out the user (Supabase SDK couldn't refresh the token)
    // Skip if suppressAutoSignOut is set (during migration flow)
    if (error.response?.status === 401 && !suppressAutoSignOut) {
      console.error('Authentication failed - signing out');
      if (onSignOutCallback) {
        onSignOutCallback();
      }
      await clearTokens();
    }

    return Promise.reject(error);
  }
);

// Helper to store tokens after login/signup
// Uses accessGroup on iOS to share tokens with Share Extension
// Also cleans up any legacy tokens stored without accessGroup
export async function storeTokens(accessToken: string, refreshToken: string): Promise<void> {
  const options = getSecureStoreOptions();
  console.log('[API] Storing tokens with options:', JSON.stringify(options));

  cachedToken = accessToken; // Update in-memory cache
  await SecureStore.setItemAsync(TOKEN_KEY, accessToken, options);
  await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refreshToken, options);
  console.log('[API] Tokens stored successfully to shared keychain');
  // Note: We do NOT delete legacy tokens here; iOS keychain matching can be surprising,
  // and deleting could remove items needed by Supabase session persistence.
}

// Helper to clear tokens on logout
// Uses accessGroup on iOS to clear tokens from shared keychain
// Note: We only clear from shared keychain. Attempting to also delete from "legacy"
// location (without accessGroup) can inadvertently delete the shared keychain item
// due to iOS Keychain matching behavior.
export async function clearTokens(): Promise<void> {
  cachedToken = null; // Clear in-memory cache
  const options = getSecureStoreOptions();

  // Clear from shared keychain (with accessGroup)
  await SecureStore.deleteItemAsync(TOKEN_KEY, options);
  await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY, options);
}

// Helper to get stored token
// Uses accessGroup on iOS to read from shared keychain
// Also migrates legacy tokens stored without accessGroup
export async function getStoredToken(): Promise<string | null> {
  return fetchTokenWithMigration(TOKEN_KEY);
}

// Helper to persist onboarding completion state
export async function storeOnboardingComplete(): Promise<void> {
  await SecureStore.setItemAsync(ONBOARDING_COMPLETE_KEY, 'true');
}

// Helper to check if onboarding was completed
export async function getOnboardingComplete(): Promise<boolean> {
  const value = await SecureStore.getItemAsync(ONBOARDING_COMPLETE_KEY);
  return value === 'true';
}

// Helper to clear onboarding state (on logout)
export async function clearOnboardingComplete(): Promise<void> {
  await SecureStore.deleteItemAsync(ONBOARDING_COMPLETE_KEY);
}

// ============================================================================
// Traveler Classification API
// ============================================================================

export interface TravelerClassificationRequest {
  countries_visited: string[];
  interest_tags: string[];
  home_country?: string | null;
}

export interface TravelerClassificationResponse {
  traveler_type: string;
  signature_country: string;
  confidence: number;
  rationale_short: string;
}

/**
 * Classify a traveler based on their visited countries and interest tags.
 * Returns a creative traveler type label and signature country.
 * @param request - Classification request data
 * @param signal - Optional AbortSignal for request cancellation
 */
export async function classifyTraveler(
  request: TravelerClassificationRequest,
  signal?: AbortSignal
): Promise<TravelerClassificationResponse> {
  const response = await api.post<TravelerClassificationResponse>('/classify/traveler', request, {
    signal,
  });
  return response.data;
}
