/**
 * Tests for useAuth hooks (phone OTP authentication).
 *
 * Covers:
 * - useSendOTP: sending OTP codes
 * - useVerifyOTP: verifying codes and session management
 * - useSignOut: signing out and cleanup
 */

import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { useSendOTP, useVerifyOTP, useSignOut } from '@hooks/useAuth';
import { supabase } from '@services/supabase';
import {
  storeTokens,
  clearTokens,
  storeOnboardingComplete,
  clearOnboardingComplete,
} from '@services/api';
import { migrateGuestData } from '@services/guestMigration';
import { useAuthStore } from '@stores/authStore';
import { useOnboardingStore } from '@stores/onboardingStore';
import { createTestQueryClient } from '../utils/testUtils';

// Type the mocks
const mockedStoreTokens = storeTokens as jest.MockedFunction<typeof storeTokens>;
const mockedClearTokens = clearTokens as jest.MockedFunction<typeof clearTokens>;
const mockedStoreOnboardingComplete = storeOnboardingComplete as jest.MockedFunction<
  typeof storeOnboardingComplete
>;
const mockedClearOnboardingComplete = clearOnboardingComplete as jest.MockedFunction<
  typeof clearOnboardingComplete
>;
const mockedMigrateGuestData = migrateGuestData as jest.MockedFunction<typeof migrateGuestData>;

// Helper to mock supabase auth methods (avoids type issues with jest mocks)
const mockSignInWithOtp = jest.fn();
const mockVerifyOtp = jest.fn();
const mockUpdateUser = jest.fn();
const mockSignOut = supabase.auth.signOut as jest.Mock;
const mockSupabaseFrom = supabase.from as jest.Mock;

// Mock guestMigration service
jest.mock('@services/guestMigration', () => ({
  migrateGuestData: jest.fn().mockResolvedValue({ success: true, countriesCount: 0 }),
}));

// Mock API service functions that aren't in jest.setup.js
jest.mock('@services/api', () => ({
  ...jest.requireActual('@services/api'),
  storeTokens: jest.fn().mockResolvedValue(undefined),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  storeOnboardingComplete: jest.fn().mockResolvedValue(undefined),
  clearOnboardingComplete: jest.fn().mockResolvedValue(undefined),
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

describe('useAuth', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
    jest.clearAllMocks();

    // Reset stores
    useAuthStore.setState({
      session: null,
      hasCompletedOnboarding: false,
      setSession: jest.fn(),
      setHasCompletedOnboarding: jest.fn(),
      signOut: jest.fn(),
    });
    useOnboardingStore.setState({
      reset: jest.fn(),
    });

    // Default supabase mock setup - assign mock functions to auth object
    Object.assign(supabase.auth, {
      signInWithOtp: mockSignInWithOtp,
      verifyOtp: mockVerifyOtp,
      updateUser: mockUpdateUser,
    });
  });

  // ============ useSendOTP Tests ============

  describe('useSendOTP', () => {
    it('calls supabase.auth.signInWithOtp with correct phone number', async () => {
      mockSignInWithOtp.mockResolvedValue({ error: null });

      const { result } = renderHook(() => useSendOTP(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        result.current.mutate({ phone: '+15551234567' });
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockSignInWithOtp).toHaveBeenCalledWith({
        phone: '+15551234567',
      });
    });

    it('returns success state when OTP sent', async () => {
      mockSignInWithOtp.mockResolvedValue({ error: null });

      const { result } = renderHook(() => useSendOTP(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        result.current.mutate({ phone: '+15551234567' });
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });

    it('returns error state on failure', async () => {
      const error = new Error('Rate limit exceeded');
      mockSignInWithOtp.mockResolvedValue({ error });

      const { result } = renderHook(() => useSendOTP(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        result.current.mutate({ phone: '+15551234567' });
      });

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.error).toEqual(error);
    });
  });

  // ============ useVerifyOTP Tests ============

  describe('useVerifyOTP', () => {
    const mockSession = createMockSession();

    it('calls supabase.auth.verifyOtp with phone, token, type sms', async () => {
      mockVerifyOtp.mockResolvedValue({
        data: { session: mockSession, user: mockSession.user },
        error: null,
      });
      // Mock user_countries check to return empty (new user)
      mockSupabaseFrom.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({ data: [], error: null }),
      });

      const { result } = renderHook(() => useVerifyOTP(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        result.current.mutate({ phone: '+15551234567', token: '123456' });
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockVerifyOtp).toHaveBeenCalledWith({
        phone: '+15551234567',
        token: '123456',
        type: 'sms',
      });
    });

    it('clears stale tokens before storing new ones', async () => {
      mockVerifyOtp.mockResolvedValue({
        data: { session: mockSession, user: mockSession.user },
        error: null,
      });
      mockSupabaseFrom.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({ data: [], error: null }),
      });

      const { result } = renderHook(() => useVerifyOTP(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        result.current.mutate({ phone: '+15551234567', token: '123456' });
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      // Verify clearTokens was called before storeTokens
      const clearCallOrder = mockedClearTokens.mock.invocationCallOrder[0];
      const storeCallOrder = mockedStoreTokens.mock.invocationCallOrder[0];
      expect(clearCallOrder).toBeLessThan(storeCallOrder);
    });

    it('stores new tokens on successful verification', async () => {
      mockVerifyOtp.mockResolvedValue({
        data: { session: mockSession, user: mockSession.user },
        error: null,
      });
      mockSupabaseFrom.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({ data: [], error: null }),
      });

      const { result } = renderHook(() => useVerifyOTP(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        result.current.mutate({ phone: '+15551234567', token: '123456' });
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockedStoreTokens).toHaveBeenCalledWith('test-access-token', 'test-refresh-token');
    });

    it('detects returning user (has user_countries data) and skips migration', async () => {
      mockVerifyOtp.mockResolvedValue({
        data: { session: mockSession, user: mockSession.user },
        error: null,
      });
      // Mock user_countries to return data (returning user)
      mockSupabaseFrom.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({ data: [{ id: 'country-1' }], error: null }),
      });

      const setHasCompletedOnboarding = jest.fn();
      useAuthStore.setState({ setHasCompletedOnboarding });

      const { result } = renderHook(() => useVerifyOTP(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        result.current.mutate({ phone: '+15551234567', token: '123456' });
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockedMigrateGuestData).not.toHaveBeenCalled();
      expect(setHasCompletedOnboarding).toHaveBeenCalledWith(true);
    });

    it('marks onboarding complete for returning users', async () => {
      mockVerifyOtp.mockResolvedValue({
        data: { session: mockSession, user: mockSession.user },
        error: null,
      });
      mockSupabaseFrom.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({ data: [{ id: 'country-1' }], error: null }),
      });

      const { result } = renderHook(() => useVerifyOTP(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        result.current.mutate({ phone: '+15551234567', token: '123456' });
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockedStoreOnboardingComplete).toHaveBeenCalled();
    });

    it('runs migration for new users (no existing data)', async () => {
      mockVerifyOtp.mockResolvedValue({
        data: { session: mockSession, user: mockSession.user },
        error: null,
      });
      // Mock user_countries to return empty (new user)
      mockSupabaseFrom.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({ data: [], error: null }),
      });

      const { result } = renderHook(() => useVerifyOTP(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        result.current.mutate({ phone: '+15551234567', token: '123456' });
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockedMigrateGuestData).toHaveBeenCalledWith(mockSession);
    });

    it('calls onMigrationComplete callback after migration', async () => {
      const migrationResult = { success: true, countriesCount: 5 };
      mockedMigrateGuestData.mockResolvedValue(migrationResult);

      mockVerifyOtp.mockResolvedValue({
        data: { session: mockSession, user: mockSession.user },
        error: null,
      });
      mockSupabaseFrom.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({ data: [], error: null }),
      });

      const onMigrationComplete = jest.fn();
      const { result } = renderHook(() => useVerifyOTP({ onMigrationComplete }), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        result.current.mutate({ phone: '+15551234567', token: '123456' });
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(onMigrationComplete).toHaveBeenCalledWith(migrationResult);
    });

    it('sets session last to trigger navigation', async () => {
      mockVerifyOtp.mockResolvedValue({
        data: { session: mockSession, user: mockSession.user },
        error: null,
      });
      mockSupabaseFrom.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({ data: [], error: null }),
      });

      const setSession = jest.fn();
      useAuthStore.setState({ setSession });

      const { result } = renderHook(() => useVerifyOTP(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        result.current.mutate({ phone: '+15551234567', token: '123456' });
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(setSession).toHaveBeenCalledWith(mockSession);
    });

    it('returns error state on invalid OTP', async () => {
      const error = new Error('Invalid OTP code');
      mockVerifyOtp.mockResolvedValue({
        data: { session: null, user: null },
        error,
      });

      const { result } = renderHook(() => useVerifyOTP(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        result.current.mutate({ phone: '+15551234567', token: '000000' });
      });

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.error).toEqual(error);
    });

    it('falls back to migration if returning user check fails', async () => {
      mockVerifyOtp.mockResolvedValue({
        data: { session: mockSession, user: mockSession.user },
        error: null,
      });
      // Mock user_countries check to throw error
      mockSupabaseFrom.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        limit: jest.fn().mockRejectedValue(new Error('Network error')),
      });

      const { result } = renderHook(() => useVerifyOTP(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        result.current.mutate({ phone: '+15551234567', token: '123456' });
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      // Should still run migration as fallback
      expect(mockedMigrateGuestData).toHaveBeenCalledWith(mockSession);
    });
  });

  // ============ useSignOut Tests ============

  describe('useSignOut', () => {
    it('calls supabase.auth.signOut', async () => {
      mockSignOut.mockResolvedValue({ error: null });

      const { result } = renderHook(() => useSignOut(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        result.current.mutate();
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockSignOut).toHaveBeenCalled();
    });

    it('calls signOut on auth store', async () => {
      mockSignOut.mockResolvedValue({ error: null });

      const signOut = jest.fn();
      useAuthStore.setState({ signOut });

      const { result } = renderHook(() => useSignOut(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        result.current.mutate();
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(signOut).toHaveBeenCalled();
    });

    it('resets onboarding store', async () => {
      mockSignOut.mockResolvedValue({ error: null });

      const reset = jest.fn();
      useOnboardingStore.setState({ reset });

      const { result } = renderHook(() => useSignOut(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        result.current.mutate();
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(reset).toHaveBeenCalled();
    });

    it('clears tokens and onboarding complete flag', async () => {
      mockSignOut.mockResolvedValue({ error: null });

      const { result } = renderHook(() => useSignOut(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        result.current.mutate();
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockedClearTokens).toHaveBeenCalled();
      expect(mockedClearOnboardingComplete).toHaveBeenCalled();
    });

    it('returns error state on failure', async () => {
      const error = new Error('Network error');
      mockSignOut.mockResolvedValue({ error });

      const { result } = renderHook(() => useSignOut(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        result.current.mutate();
      });

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.error).toEqual(error);
    });
  });
});
