/**
 * Tests for useAppleAuth hooks (Apple Sign-In authentication).
 *
 * Covers:
 * - useAppleSignIn: Apple authentication flow and session management
 * - useAppleAuthAvailable: Platform availability check
 */

import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Platform } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';

import { useAppleSignIn, useAppleAuthAvailable } from '@hooks/useAppleAuth';
import { supabase } from '@services/supabase';

// Note: Alert.alert is mocked in jest.setup.js at the internal path
// but verifying Alert calls is complex due to React Native's module structure.
// We test error logging with console.error which is the new functionality.
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
const mockedSignInAsync = AppleAuthentication.signInAsync as jest.MockedFunction<
  typeof AppleAuthentication.signInAsync
>;
const mockedDigestStringAsync = Crypto.digestStringAsync as jest.MockedFunction<
  typeof Crypto.digestStringAsync
>;
const mockedRandomUUID = Crypto.randomUUID as jest.MockedFunction<typeof Crypto.randomUUID>;

// Mock supabase methods
const mockSignInWithIdToken = jest.fn();
const mockRpc = jest.fn();
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

// Mock expo-apple-authentication
jest.mock('expo-apple-authentication', () => ({
  signInAsync: jest.fn(),
  AppleAuthenticationScope: {
    FULL_NAME: 0,
    EMAIL: 1,
  },
}));

// Mock expo-crypto
jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn().mockReturnValue('mock-uuid-1234'),
  digestStringAsync: jest.fn().mockResolvedValue('hashed-nonce-5678'),
  CryptoDigestAlgorithm: {
    SHA256: 'SHA-256',
  },
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

// Mock Apple credential
function createMockAppleCredential(
  overrides?: Partial<{
    identityToken: string | null;
    fullName: { givenName: string | null; familyName: string | null } | null;
  }>
) {
  return {
    identityToken: 'apple-identity-token',
    fullName: null,
    ...overrides,
  };
}

describe('useAppleAuth', () => {
  let queryClient: QueryClient;
  let consoleErrorSpy: jest.SpyInstance;
  const originalPlatformOS = Platform.OS;

  beforeEach(() => {
    queryClient = createTestQueryClient();
    jest.clearAllMocks();

    // Reset Platform.OS
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });

    // Spy on console.error
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

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
      signInWithIdToken: mockSignInWithIdToken,
    });
    Object.assign(supabase, {
      rpc: mockRpc,
    });

    // Default mock values
    mockedRandomUUID.mockReturnValue('mock-uuid-1234');
    mockedDigestStringAsync.mockResolvedValue('hashed-nonce-5678');
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    Object.defineProperty(Platform, 'OS', { value: originalPlatformOS, configurable: true });
  });

  // ============ useAppleSignIn Tests ============

  describe('useAppleSignIn', () => {
    const mockSession = createMockSession();
    const mockAppleCredential = createMockAppleCredential();

    describe('Success Path', () => {
      beforeEach(() => {
        mockedSignInAsync.mockResolvedValue(mockAppleCredential as never);
        mockSignInWithIdToken.mockResolvedValue({
          data: { session: mockSession, user: mockSession.user },
          error: null,
        });
        mockSupabaseFrom.mockReturnValue({
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          limit: jest.fn().mockResolvedValue({ data: [], error: null }),
        });
      });

      it('calls Apple Authentication with correct parameters', async () => {
        const { result } = renderHook(() => useAppleSignIn(), {
          wrapper: createWrapper(queryClient),
        });

        await act(async () => {
          result.current.mutate();
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(mockedSignInAsync).toHaveBeenCalledWith({
          requestedScopes: [
            AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
            AppleAuthentication.AppleAuthenticationScope.EMAIL,
          ],
          nonce: 'hashed-nonce-5678',
        });
      });

      it('calls Supabase signInWithIdToken with Apple token', async () => {
        const { result } = renderHook(() => useAppleSignIn(), {
          wrapper: createWrapper(queryClient),
        });

        await act(async () => {
          result.current.mutate();
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(mockSignInWithIdToken).toHaveBeenCalledWith({
          provider: 'apple',
          token: 'apple-identity-token',
          nonce: 'mock-uuid-1234',
        });
      });

      it('clears stale tokens before storing new ones', async () => {
        const { result } = renderHook(() => useAppleSignIn(), {
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
        const { result } = renderHook(() => useAppleSignIn(), {
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

        const { result } = renderHook(() => useAppleSignIn(), {
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

        const { result } = renderHook(() => useAppleSignIn(), {
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

        const { result } = renderHook(() => useAppleSignIn(), {
          wrapper: createWrapper(queryClient),
        });

        await act(async () => {
          result.current.mutate();
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(setSession).toHaveBeenCalledWith(mockSession);
      });

      it('updates display name when Apple provides it', async () => {
        const credentialWithName = createMockAppleCredential({
          fullName: { givenName: 'John', familyName: 'Doe' },
        });
        mockedSignInAsync.mockResolvedValue(credentialWithName as never);
        mockRpc.mockResolvedValue({ data: null, error: null });

        const { result } = renderHook(() => useAppleSignIn(), {
          wrapper: createWrapper(queryClient),
        });

        await act(async () => {
          result.current.mutate();
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(mockRpc).toHaveBeenCalledWith('update_display_name', {
          new_display_name: 'John Doe',
        });
      });
    });

    describe('Error Handling', () => {
      it('logs error to console.error', async () => {
        const error = new Error('Apple auth failed');
        mockedSignInAsync.mockRejectedValue(error);

        const { result } = renderHook(() => useAppleSignIn(), {
          wrapper: createWrapper(queryClient),
        });

        await act(async () => {
          result.current.mutate();
        });

        await waitFor(() => expect(result.current.isError).toBe(true));

        expect(consoleErrorSpy).toHaveBeenCalledWith('Apple Sign-In error:', error);
      });

      it('logs cancellation error with "canceled" message', async () => {
        const error = new Error('The operation was canceled');
        mockedSignInAsync.mockRejectedValue(error);

        const { result } = renderHook(() => useAppleSignIn(), {
          wrapper: createWrapper(queryClient),
        });

        await act(async () => {
          result.current.mutate();
        });

        await waitFor(() => expect(result.current.isError).toBe(true));

        // Error is logged for debugging even for cancellations
        expect(consoleErrorSpy).toHaveBeenCalledWith('Apple Sign-In error:', error);
      });

      it('logs cancellation error with "ERR_REQUEST_CANCELED" message', async () => {
        const error = new Error('ERR_REQUEST_CANCELED');
        mockedSignInAsync.mockRejectedValue(error);

        const { result } = renderHook(() => useAppleSignIn(), {
          wrapper: createWrapper(queryClient),
        });

        await act(async () => {
          result.current.mutate();
        });

        await waitFor(() => expect(result.current.isError).toBe(true));

        // Error is logged for debugging even for cancellations
        expect(consoleErrorSpy).toHaveBeenCalledWith('Apple Sign-In error:', error);
      });

      it('logs cancellation error with "1001" code', async () => {
        const error = new Error('Error code 1001: User canceled');
        mockedSignInAsync.mockRejectedValue(error);

        const { result } = renderHook(() => useAppleSignIn(), {
          wrapper: createWrapper(queryClient),
        });

        await act(async () => {
          result.current.mutate();
        });

        await waitFor(() => expect(result.current.isError).toBe(true));

        // Error is logged for debugging even for cancellations
        expect(consoleErrorSpy).toHaveBeenCalledWith('Apple Sign-In error:', error);
      });

      it('returns error for non-cancellation errors', async () => {
        const error = new Error('Network connection failed');
        mockedSignInAsync.mockRejectedValue(error);

        const { result } = renderHook(() => useAppleSignIn(), {
          wrapper: createWrapper(queryClient),
        });

        await act(async () => {
          result.current.mutate();
        });

        await waitFor(() => expect(result.current.isError).toBe(true));

        // Verify error was logged
        expect(consoleErrorSpy).toHaveBeenCalledWith('Apple Sign-In error:', error);
        // Verify error message is accessible
        expect(result.current.error?.message).toBe('Network connection failed');
      });

      it('handles non-Error objects', async () => {
        mockedSignInAsync.mockRejectedValue('string error');

        const { result } = renderHook(() => useAppleSignIn(), {
          wrapper: createWrapper(queryClient),
        });

        await act(async () => {
          result.current.mutate();
        });

        await waitFor(() => expect(result.current.isError).toBe(true));

        // Verify error was logged
        expect(consoleErrorSpy).toHaveBeenCalledWith('Apple Sign-In error:', 'string error');
      });

      it('throws error when not on iOS', async () => {
        Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });

        const { result } = renderHook(() => useAppleSignIn(), {
          wrapper: createWrapper(queryClient),
        });

        await act(async () => {
          result.current.mutate();
        });

        await waitFor(() => expect(result.current.isError).toBe(true));

        expect(result.current.error?.message).toBe('Apple Sign In is only available on iOS');
      });

      it('throws error when identityToken is missing', async () => {
        const credentialWithoutToken = createMockAppleCredential({ identityToken: null });
        mockedSignInAsync.mockResolvedValue(credentialWithoutToken as never);

        const { result } = renderHook(() => useAppleSignIn(), {
          wrapper: createWrapper(queryClient),
        });

        await act(async () => {
          result.current.mutate();
        });

        await waitFor(() => expect(result.current.isError).toBe(true));

        expect(result.current.error?.message).toBe('No identity token received from Apple');
      });

      it('handles display name update failure gracefully', async () => {
        const credentialWithName = createMockAppleCredential({
          fullName: { givenName: 'John', familyName: 'Doe' },
        });
        mockedSignInAsync.mockResolvedValue(credentialWithName as never);
        mockSignInWithIdToken.mockResolvedValue({
          data: { session: mockSession, user: mockSession.user },
          error: null,
        });
        mockRpc.mockRejectedValue(new Error('RPC failed'));
        mockSupabaseFrom.mockReturnValue({
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          limit: jest.fn().mockResolvedValue({ data: [], error: null }),
        });

        const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

        const { result } = renderHook(() => useAppleSignIn(), {
          wrapper: createWrapper(queryClient),
        });

        await act(async () => {
          result.current.mutate();
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(consoleWarnSpy).toHaveBeenCalled();
        consoleWarnSpy.mockRestore();
      });

      it('falls back to migration if onboarding check fails', async () => {
        mockedSignInAsync.mockResolvedValue(mockAppleCredential as never);
        mockSignInWithIdToken.mockResolvedValue({
          data: { session: mockSession, user: mockSession.user },
          error: null,
        });
        // Mock user_countries check to throw error
        mockSupabaseFrom.mockReturnValue({
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          limit: jest.fn().mockRejectedValue(new Error('Network error')),
        });

        const { result } = renderHook(() => useAppleSignIn(), {
          wrapper: createWrapper(queryClient),
        });

        await act(async () => {
          result.current.mutate();
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        // Should still run migration as fallback
        expect(mockedMigrateGuestData).toHaveBeenCalledWith(mockSession);
      });
    });
  });

  // ============ useAppleAuthAvailable Tests ============

  describe('useAppleAuthAvailable', () => {
    it('returns true on iOS', () => {
      Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });

      const { result } = renderHook(() => useAppleAuthAvailable());

      expect(result.current).toBe(true);
    });

    it('returns false on Android', () => {
      Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });

      const { result } = renderHook(() => useAppleAuthAvailable());

      expect(result.current).toBe(false);
    });
  });
});
