/**
 * Integration tests for Email Authentication flow.
 * Tests: deep link callback processing, token extraction, session management.
 */

import { QueryClient } from '@tanstack/react-query';

import {
  isAuthCallbackDeepLink,
  extractAuthTokens,
  processAuthCallback,
} from '@services/authCallback';
import { supabase } from '@services/supabase';
import { storeTokens, clearTokens, storeOnboardingComplete } from '@services/api';
import { migrateGuestData } from '@services/guestMigration';
import { useAuthStore } from '@stores/authStore';
import { createTestQueryClient } from '../utils/testUtils';

// Type the mocks
const mockedStoreTokens = storeTokens as jest.MockedFunction<typeof storeTokens>;
const mockedClearTokens = clearTokens as jest.MockedFunction<typeof clearTokens>;
const mockedStoreOnboardingComplete = storeOnboardingComplete as jest.MockedFunction<
  typeof storeOnboardingComplete
>;
const mockedMigrateGuestData = migrateGuestData as jest.MockedFunction<typeof migrateGuestData>;

// Mock supabase methods
const mockSetSession = jest.fn();
const mockSupabaseFrom = supabase.from as jest.Mock;

// Mock guestMigration service
jest.mock('@services/guestMigration', () => ({
  migrateGuestData: jest.fn().mockResolvedValue({
    success: true,
    migratedCountries: 0,
    migratedProfile: false,
    errors: [],
  }),
}));

// Mock API service functions
jest.mock('@services/api', () => ({
  ...jest.requireActual('@services/api'),
  storeTokens: jest.fn().mockResolvedValue(undefined),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  storeOnboardingComplete: jest.fn().mockResolvedValue(undefined),
}));

// Mock expo-linking
jest.mock('expo-linking', () => ({
  createURL: jest.fn().mockReturnValue('atlasi://auth-callback'),
}));

// Mock session data
function createMockSession(
  overrides?: Partial<{
    access_token: string;
    refresh_token: string;
    user: { id: string; email?: string };
  }>
) {
  return {
    access_token: 'test-access-token',
    refresh_token: 'test-refresh-token',
    user: { id: 'user-123', email: 'test@example.com', ...overrides?.user },
    ...overrides,
  };
}

describe('EmailAuthFlow Integration', () => {
  let _queryClient: QueryClient;
  let consoleErrorSpy: jest.SpyInstance;
  let consoleWarnSpy: jest.SpyInstance;

  beforeEach(() => {
    // Create fresh query client for test isolation
    _queryClient = createTestQueryClient();
    jest.clearAllMocks();

    // Spy on console methods
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

    // Reset stores
    useAuthStore.setState({
      session: null,
      hasCompletedOnboarding: false,
      setSession: jest.fn(),
      setHasCompletedOnboarding: jest.fn(),
      signOut: jest.fn(),
    });

    // Default supabase mock setup
    Object.assign(supabase.auth, {
      setSession: mockSetSession,
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  // ============ Deep Link Detection Tests ============

  describe('Deep Link Detection', () => {
    it('identifies auth callback URLs', () => {
      expect(isAuthCallbackDeepLink('atlasi://auth-callback')).toBe(true);
      expect(isAuthCallbackDeepLink('atlasi://auth-callback#access_token=xyz')).toBe(true);
      expect(isAuthCallbackDeepLink('atlasi://auth-callback?code=abc')).toBe(true);
    });

    it('rejects non-auth URLs', () => {
      expect(isAuthCallbackDeepLink('atlasi://share')).toBe(false);
      expect(isAuthCallbackDeepLink('atlasi://other')).toBe(false);
      expect(isAuthCallbackDeepLink('https://example.com/auth-callback')).toBe(false);
    });

    it('handles null and empty URLs', () => {
      expect(isAuthCallbackDeepLink(null)).toBe(false);
      expect(isAuthCallbackDeepLink('')).toBe(false);
    });
  });

  // ============ Token Extraction Tests ============

  describe('Token Extraction', () => {
    it('extracts tokens from URL fragment', () => {
      const url = 'atlasi://auth-callback#access_token=abc123&refresh_token=def456';
      const tokens = extractAuthTokens(url);

      expect(tokens).toEqual({
        accessToken: 'abc123',
        refreshToken: 'def456',
      });
    });

    it('extracts tokens from query params', () => {
      const url = 'atlasi://auth-callback?access_token=xyz789&refresh_token=uvw012';
      const tokens = extractAuthTokens(url);

      expect(tokens).toEqual({
        accessToken: 'xyz789',
        refreshToken: 'uvw012',
      });
    });

    it('handles missing refresh token', () => {
      const url = 'atlasi://auth-callback#access_token=abc123';
      const tokens = extractAuthTokens(url);

      expect(tokens).toEqual({
        accessToken: 'abc123',
        refreshToken: null,
      });
    });

    it('returns null when access token is missing', () => {
      const url = 'atlasi://auth-callback#refresh_token=abc123';
      const tokens = extractAuthTokens(url);

      expect(tokens).toBeNull();
    });

    it('returns null for URL without tokens', () => {
      const url = 'atlasi://auth-callback';
      const tokens = extractAuthTokens(url);

      expect(tokens).toBeNull();
    });

    it('handles extra parameters in URL', () => {
      const url =
        'atlasi://auth-callback#access_token=abc&refresh_token=def&type=magiclink&expires_in=3600';
      const tokens = extractAuthTokens(url);

      expect(tokens).toEqual({
        accessToken: 'abc',
        refreshToken: 'def',
      });
    });
  });

  // ============ Auth Callback Processing Tests ============

  describe('Auth Callback Processing', () => {
    const mockSession = createMockSession();

    beforeEach(() => {
      mockSetSession.mockResolvedValue({
        data: { session: mockSession },
        error: null,
      });

      mockSupabaseFrom.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({ data: [], error: null }),
      });
    });

    it('processes valid callback and sets session', async () => {
      const url = 'atlasi://auth-callback#access_token=test-token&refresh_token=test-refresh';

      const result = await processAuthCallback(url);

      expect(result.success).toBe(true);
      expect(mockSetSession).toHaveBeenCalledWith({
        access_token: 'test-token',
        refresh_token: 'test-refresh',
      });
    });

    it('stores tokens on successful callback', async () => {
      const url = 'atlasi://auth-callback#access_token=test-token&refresh_token=test-refresh';

      await processAuthCallback(url);

      expect(mockedClearTokens).toHaveBeenCalled();
      expect(mockedStoreTokens).toHaveBeenCalledWith('test-access-token', 'test-refresh-token');
    });

    it('detects returning user and skips migration', async () => {
      mockSupabaseFrom.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({ data: [{ id: 'country-1' }], error: null }),
      });

      const url = 'atlasi://auth-callback#access_token=test-token&refresh_token=test-refresh';

      await processAuthCallback(url);

      expect(mockedMigrateGuestData).not.toHaveBeenCalled();
      expect(mockedStoreOnboardingComplete).toHaveBeenCalled();
    });

    it('runs migration for new users', async () => {
      const url = 'atlasi://auth-callback#access_token=test-token&refresh_token=test-refresh';

      await processAuthCallback(url);

      expect(mockedMigrateGuestData).toHaveBeenCalledWith(mockSession);
    });

    it('returns error when tokens cannot be extracted', async () => {
      const url = 'atlasi://auth-callback';

      const result = await processAuthCallback(url);

      expect(result.success).toBe(false);
      expect(result.error).toBe('no_tokens');
      expect(mockSetSession).not.toHaveBeenCalled();
    });

    it('returns error on setSession error', async () => {
      mockSetSession.mockResolvedValue({
        data: null,
        error: new Error('Session expired'),
      });

      const url = 'atlasi://auth-callback#access_token=test-token&refresh_token=test-refresh';

      const result = await processAuthCallback(url);

      expect(result.success).toBe(false);
      expect(result.error).toBe('session_error');
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('updates auth store on success', async () => {
      const setSession = jest.fn();
      useAuthStore.setState({ setSession });

      const url = 'atlasi://auth-callback#access_token=test-token&refresh_token=test-refresh';

      await processAuthCallback(url);

      expect(setSession).toHaveBeenCalledWith(mockSession);
    });
  });

  // ============ Auth Callback Flow Tests ============

  describe('Auth Callback Flow', () => {
    it('completes callback flow: tokens → session → store', async () => {
      const mockSession = createMockSession({
        user: { id: 'user-123', email: 'test@example.com' },
      });
      mockSetSession.mockResolvedValue({
        data: { session: mockSession },
        error: null,
      });

      mockSupabaseFrom.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({ data: [], error: null }),
      });

      const setSession = jest.fn();
      useAuthStore.setState({ setSession });

      const callbackUrl =
        'atlasi://auth-callback#access_token=final-token&refresh_token=final-refresh';
      const callbackResult = await processAuthCallback(callbackUrl);

      expect(callbackResult.success).toBe(true);
      expect(setSession).toHaveBeenCalledWith(mockSession);
      expect(mockedStoreTokens).toHaveBeenCalled();
    });

    it('handles returning user through callback flow', async () => {
      const mockSession = createMockSession({
        user: { id: 'returning-user', email: 'returning@example.com' },
      });
      mockSetSession.mockResolvedValue({
        data: { session: mockSession },
        error: null,
      });

      // Returning user has visited countries
      mockSupabaseFrom.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({
          data: [{ id: 'country-1' }, { id: 'country-2' }],
          error: null,
        }),
      });

      const setHasCompletedOnboarding = jest.fn();
      useAuthStore.setState({ setHasCompletedOnboarding });

      const callbackUrl =
        'atlasi://auth-callback#access_token=return-token&refresh_token=return-refresh';
      await processAuthCallback(callbackUrl);

      // Returning user should skip migration and set onboarding complete
      expect(mockedMigrateGuestData).not.toHaveBeenCalled();
      expect(setHasCompletedOnboarding).toHaveBeenCalledWith(true);
      expect(mockedStoreOnboardingComplete).toHaveBeenCalled();
    });
  });

  // ============ Error Recovery Tests ============

  describe('Error Recovery', () => {
    it('handles callback processing failure gracefully', async () => {
      mockSetSession.mockRejectedValue(new Error('Network error'));

      const url = 'atlasi://auth-callback#access_token=test&refresh_token=test';
      const result = await processAuthCallback(url);

      expect(result.success).toBe(false);
      expect(result.error).toBe('unknown_error');
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('handles migration failure without breaking auth flow', async () => {
      const mockSession = createMockSession();
      mockSetSession.mockResolvedValue({
        data: { session: mockSession },
        error: null,
      });

      mockSupabaseFrom.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({ data: [], error: null }),
      });

      mockedMigrateGuestData.mockRejectedValue(new Error('Migration failed'));

      const setSession = jest.fn();
      useAuthStore.setState({ setSession });

      const url = 'atlasi://auth-callback#access_token=test&refresh_token=test';
      const result = await processAuthCallback(url);

      // Auth should still succeed even if migration fails
      expect(result.success).toBe(true);
      expect(setSession).toHaveBeenCalledWith(mockSession);
      expect(consoleWarnSpy).toHaveBeenCalledWith('Migration failed for magic link user');
    });
  });
});
