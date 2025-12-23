/**
 * Tests for useGoogleAuth hooks (Google Sign-In authentication).
 *
 * Covers:
 * - useGoogleSignIn: Google OAuth flow and session management
 * - useGoogleAuthAvailable: Platform availability check
 */

import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as WebBrowser from 'expo-web-browser';

import { useGoogleSignIn, useGoogleAuthAvailable } from '@hooks/useGoogleAuth';
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
const mockSignInWithOAuth = jest.fn();
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

// Mock expo-web-browser
jest.mock('expo-web-browser', () => ({
  maybeCompleteAuthSession: jest.fn(),
  openAuthSessionAsync: jest.fn(),
}));

// Mock expo-linking
jest.mock('expo-linking', () => ({
  createURL: jest.fn().mockReturnValue('atlasi://auth-callback'),
}));

// Create wrapper for hooks
function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

// Mock session data
function createMockSession(
  overrides?: Partial<{
    access_token: string;
    refresh_token: string;
    user: { id: string };
  }>
) {
  return {
    access_token: 'test-access-token',
    refresh_token: 'test-refresh-token',
    user: { id: 'user-123', ...overrides?.user },
    ...overrides,
  };
}

describe('useGoogleAuth', () => {
  let queryClient: QueryClient;
  let consoleErrorSpy: jest.SpyInstance;
  let consoleWarnSpy: jest.SpyInstance;

  beforeEach(() => {
    queryClient = createTestQueryClient();
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
      signInWithOAuth: mockSignInWithOAuth,
      setSession: mockSetSession,
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  // ============ useGoogleSignIn Tests ============

  describe('useGoogleSignIn', () => {
    const mockSession = createMockSession();

    describe('Success Path', () => {
      beforeEach(() => {
        // Mock OAuth flow
        mockSignInWithOAuth.mockResolvedValue({
          data: { url: 'https://accounts.google.com/oauth' },
          error: null,
        });

        // Mock browser session with successful callback
        (WebBrowser.openAuthSessionAsync as jest.Mock).mockResolvedValue({
          type: 'success',
          url: 'atlasi://auth-callback#access_token=test-access-token&refresh_token=test-refresh-token',
        });

        // Mock session set
        mockSetSession.mockResolvedValue({
          data: { session: mockSession, user: mockSession.user },
          error: null,
        });

        // Mock user_countries check (new user)
        mockSupabaseFrom.mockReturnValue({
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          limit: jest.fn().mockResolvedValue({ data: [], error: null }),
        });
      });

      it('initiates OAuth flow with correct parameters', async () => {
        const { result } = renderHook(() => useGoogleSignIn(), {
          wrapper: createWrapper(queryClient),
        });

        await act(async () => {
          result.current.mutate();
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(mockSignInWithOAuth).toHaveBeenCalledWith({
          provider: 'google',
          options: {
            redirectTo: 'atlasi://auth-callback',
            skipBrowserRedirect: true,
          },
        });
      });

      it('opens browser with OAuth URL', async () => {
        const { result } = renderHook(() => useGoogleSignIn(), {
          wrapper: createWrapper(queryClient),
        });

        await act(async () => {
          result.current.mutate();
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(WebBrowser.openAuthSessionAsync).toHaveBeenCalledWith(
          'https://accounts.google.com/oauth',
          'atlasi://auth-callback'
        );
      });

      it('sets session with tokens from callback URL', async () => {
        const { result } = renderHook(() => useGoogleSignIn(), {
          wrapper: createWrapper(queryClient),
        });

        await act(async () => {
          result.current.mutate();
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(mockSetSession).toHaveBeenCalledWith({
          access_token: 'test-access-token',
          refresh_token: 'test-refresh-token',
        });
      });

      it('clears stale tokens before storing new ones', async () => {
        const { result } = renderHook(() => useGoogleSignIn(), {
          wrapper: createWrapper(queryClient),
        });

        await act(async () => {
          result.current.mutate();
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        // Verify clearTokens was called before storeTokens
        const clearCallOrder = mockedClearTokens.mock.invocationCallOrder[0];
        const storeCallOrder = mockedStoreTokens.mock.invocationCallOrder[0];
        expect(clearCallOrder).toBeLessThan(storeCallOrder);
      });

      it('stores new tokens on successful authentication', async () => {
        const { result } = renderHook(() => useGoogleSignIn(), {
          wrapper: createWrapper(queryClient),
        });

        await act(async () => {
          result.current.mutate();
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(mockedStoreTokens).toHaveBeenCalledWith('test-access-token', 'test-refresh-token');
      });

      it('detects returning user and skips migration', async () => {
        // Mock user_countries to return data (returning user)
        mockSupabaseFrom.mockReturnValue({
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          limit: jest.fn().mockResolvedValue({ data: [{ id: 'country-1' }], error: null }),
        });

        const setHasCompletedOnboarding = jest.fn();
        useAuthStore.setState({ setHasCompletedOnboarding });

        const { result } = renderHook(() => useGoogleSignIn(), {
          wrapper: createWrapper(queryClient),
        });

        await act(async () => {
          result.current.mutate();
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(mockedMigrateGuestData).not.toHaveBeenCalled();
        expect(setHasCompletedOnboarding).toHaveBeenCalledWith(true);
        expect(mockedStoreOnboardingComplete).toHaveBeenCalled();
      });

      it('runs migration for new users', async () => {
        // Mock user_countries to return empty (new user)
        mockSupabaseFrom.mockReturnValue({
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          limit: jest.fn().mockResolvedValue({ data: [], error: null }),
        });

        const { result } = renderHook(() => useGoogleSignIn(), {
          wrapper: createWrapper(queryClient),
        });

        await act(async () => {
          result.current.mutate();
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(mockedMigrateGuestData).toHaveBeenCalledWith(mockSession);
      });

      it('sets session last to trigger navigation', async () => {
        const setSession = jest.fn();
        useAuthStore.setState({ setSession });

        const { result } = renderHook(() => useGoogleSignIn(), {
          wrapper: createWrapper(queryClient),
        });

        await act(async () => {
          result.current.mutate();
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(setSession).toHaveBeenCalledWith(mockSession);
      });

      it('handles tokens in query params instead of fragment', async () => {
        (WebBrowser.openAuthSessionAsync as jest.Mock).mockResolvedValue({
          type: 'success',
          url: 'atlasi://auth-callback?access_token=query-token&refresh_token=query-refresh',
        });

        mockSetSession.mockResolvedValue({
          data: {
            session: {
              ...mockSession,
              access_token: 'query-token',
              refresh_token: 'query-refresh',
            },
            user: mockSession.user,
          },
          error: null,
        });

        const { result } = renderHook(() => useGoogleSignIn(), {
          wrapper: createWrapper(queryClient),
        });

        await act(async () => {
          result.current.mutate();
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(mockSetSession).toHaveBeenCalledWith({
          access_token: 'query-token',
          refresh_token: 'query-refresh',
        });
      });
    });

    describe('Error Handling', () => {
      beforeEach(() => {
        mockSignInWithOAuth.mockResolvedValue({
          data: { url: 'https://accounts.google.com/oauth' },
          error: null,
        });
      });

      it('logs error to console.error', async () => {
        const error = new Error('OAuth failed');
        mockSignInWithOAuth.mockResolvedValue({ data: null, error });

        const { result } = renderHook(() => useGoogleSignIn(), {
          wrapper: createWrapper(queryClient),
        });

        await act(async () => {
          result.current.mutate();
        });

        await waitFor(() => expect(result.current.isError).toBe(true));

        expect(consoleErrorSpy).toHaveBeenCalledWith('Google Sign-In failed:', 'OAuth failed');
      });

      it('handles user cancellation gracefully', async () => {
        (WebBrowser.openAuthSessionAsync as jest.Mock).mockResolvedValue({
          type: 'cancel',
        });

        const { result } = renderHook(() => useGoogleSignIn(), {
          wrapper: createWrapper(queryClient),
        });

        await act(async () => {
          result.current.mutate();
        });

        await waitFor(() => expect(result.current.isError).toBe(true));

        // Error is logged but no alert shown for cancellation
        expect(consoleErrorSpy).toHaveBeenCalled();
        expect(result.current.error?.message).toBe('ERR_REQUEST_CANCELED');
      });

      it('handles browser dismiss gracefully', async () => {
        (WebBrowser.openAuthSessionAsync as jest.Mock).mockResolvedValue({
          type: 'dismiss',
        });

        const { result } = renderHook(() => useGoogleSignIn(), {
          wrapper: createWrapper(queryClient),
        });

        await act(async () => {
          result.current.mutate();
        });

        await waitFor(() => expect(result.current.isError).toBe(true));

        expect(result.current.error?.message).toBe('ERR_REQUEST_CANCELED');
      });

      it('throws error when no OAuth URL received', async () => {
        mockSignInWithOAuth.mockResolvedValue({
          data: { url: null },
          error: null,
        });

        const { result } = renderHook(() => useGoogleSignIn(), {
          wrapper: createWrapper(queryClient),
        });

        await act(async () => {
          result.current.mutate();
        });

        await waitFor(() => expect(result.current.isError).toBe(true));

        expect(result.current.error?.message).toBe('No OAuth URL received from Supabase');
      });

      it('throws error when no access token in callback', async () => {
        (WebBrowser.openAuthSessionAsync as jest.Mock).mockResolvedValue({
          type: 'success',
          url: 'atlasi://auth-callback#refresh_token=only-refresh',
        });

        const { result } = renderHook(() => useGoogleSignIn(), {
          wrapper: createWrapper(queryClient),
        });

        await act(async () => {
          result.current.mutate();
        });

        await waitFor(() => expect(result.current.isError).toBe(true));

        expect(result.current.error?.message).toBe('No access token received from Google');
      });

      it('handles setSession error', async () => {
        (WebBrowser.openAuthSessionAsync as jest.Mock).mockResolvedValue({
          type: 'success',
          url: 'atlasi://auth-callback#access_token=test-token&refresh_token=test-refresh',
        });

        const sessionError = new Error('Session error');
        mockSetSession.mockResolvedValue({
          data: null,
          error: sessionError,
        });

        const { result } = renderHook(() => useGoogleSignIn(), {
          wrapper: createWrapper(queryClient),
        });

        await act(async () => {
          result.current.mutate();
        });

        await waitFor(() => expect(result.current.isError).toBe(true));

        expect(result.current.error?.message).toBe('Session error');
      });

      it('handles non-Error objects in onError', async () => {
        mockSignInWithOAuth.mockRejectedValue('string error');

        const { result } = renderHook(() => useGoogleSignIn(), {
          wrapper: createWrapper(queryClient),
        });

        await act(async () => {
          result.current.mutate();
        });

        await waitFor(() => expect(result.current.isError).toBe(true));

        expect(consoleErrorSpy).toHaveBeenCalledWith(
          'Google Sign-In failed:',
          'Unknown error type'
        );
      });

      it('falls back to migration if onboarding check fails', async () => {
        const mockSession = createMockSession();

        (WebBrowser.openAuthSessionAsync as jest.Mock).mockResolvedValue({
          type: 'success',
          url: 'atlasi://auth-callback#access_token=test-token&refresh_token=test-refresh',
        });

        mockSetSession.mockResolvedValue({
          data: { session: mockSession, user: mockSession.user },
          error: null,
        });

        // Mock user_countries check to throw error
        mockSupabaseFrom.mockReturnValue({
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          limit: jest.fn().mockRejectedValue(new Error('Network error')),
        });

        const { result } = renderHook(() => useGoogleSignIn(), {
          wrapper: createWrapper(queryClient),
        });

        await act(async () => {
          result.current.mutate();
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        // Should still run migration as fallback
        expect(mockedMigrateGuestData).toHaveBeenCalledWith(mockSession);
      });

      it('handles migration failure gracefully', async () => {
        const mockSession = createMockSession();

        (WebBrowser.openAuthSessionAsync as jest.Mock).mockResolvedValue({
          type: 'success',
          url: 'atlasi://auth-callback#access_token=test-token&refresh_token=test-refresh',
        });

        mockSetSession.mockResolvedValue({
          data: { session: mockSession, user: mockSession.user },
          error: null,
        });

        mockSupabaseFrom.mockReturnValue({
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          limit: jest.fn().mockResolvedValue({ data: [], error: null }),
        });

        mockedMigrateGuestData.mockRejectedValue(new Error('Migration failed'));

        const { result } = renderHook(() => useGoogleSignIn(), {
          wrapper: createWrapper(queryClient),
        });

        await act(async () => {
          result.current.mutate();
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        // Should still succeed, just log warning (no error object in message)
        expect(consoleWarnSpy).toHaveBeenCalledWith('Migration failed for Google user');
      });
    });
  });

  // ============ useGoogleAuthAvailable Tests ============

  describe('useGoogleAuthAvailable', () => {
    it('returns true (Google auth available on all platforms)', () => {
      const { result } = renderHook(() => useGoogleAuthAvailable());

      expect(result.current).toBe(true);
    });
  });
});
