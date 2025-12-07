/**
 * Integration tests for the complete phone authentication flow.
 *
 * Tests the interaction between:
 * - useSendOTP hook
 * - useVerifyOTP hook
 * - Session management
 * - Migration/onboarding logic
 */

import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { useSendOTP, useVerifyOTP } from '@hooks/useAuth';
import { supabase } from '@services/supabase';
import { migrateGuestData } from '@services/guestMigration';
import { useAuthStore } from '@stores/authStore';
import { createTestQueryClient } from '../utils/testUtils';

// Type the mocks
const mockedMigrateGuestData = migrateGuestData as jest.MockedFunction<typeof migrateGuestData>;

// Helper to mock supabase auth methods (avoids type issues with jest mocks)
const mockSignInWithOtp = jest.fn();
const mockVerifyOtp = jest.fn();
const mockSupabaseFrom = supabase.from as jest.Mock;
const mockSupabaseRpc = supabase.rpc as jest.Mock;

// Mock guestMigration service
jest.mock('@services/guestMigration', () => ({
  migrateGuestData: jest.fn().mockResolvedValue({ success: true, countriesCount: 0 }),
}));

// Mock API service functions
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
function createMockSession(userId = 'user-123') {
  return {
    access_token: 'test-access-token',
    refresh_token: 'test-refresh-token',
    user: { id: userId },
  };
}

describe('Phone Auth Flow Integration', () => {
  let queryClient: QueryClient;
  let setSession: jest.Mock;
  let setHasCompletedOnboarding: jest.Mock;

  beforeEach(() => {
    queryClient = createTestQueryClient();
    jest.clearAllMocks();

    // Set up auth store spies
    setSession = jest.fn();
    setHasCompletedOnboarding = jest.fn();
    useAuthStore.setState({
      session: null,
      hasCompletedOnboarding: false,
      setSession,
      setHasCompletedOnboarding,
    });

    // Set up default supabase mocks - assign mock functions to auth object
    Object.assign(supabase.auth, {
      signInWithOtp: mockSignInWithOtp,
      verifyOtp: mockVerifyOtp,
    });
  });

  describe('complete new user flow', () => {
    it('send OTP → verify → migration runs → session set', async () => {
      const mockSession = createMockSession();
      const phone = '+15551234567';
      const otp = '123456';

      // Mock sendOTP success
      mockSignInWithOtp.mockResolvedValue({ error: null });

      // Mock verifyOTP success
      mockVerifyOtp.mockResolvedValue({
        data: { session: mockSession, user: mockSession.user },
        error: null,
      });

      // Mock user_countries check (new user - empty)
      mockSupabaseFrom.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({ data: [], error: null }),
      });

      // Step 1: Send OTP
      const { result: sendResult } = renderHook(() => useSendOTP(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        sendResult.current.mutate({ phone });
      });

      await waitFor(() => expect(sendResult.current.isSuccess).toBe(true));
      expect(mockSignInWithOtp).toHaveBeenCalledWith({ phone });

      // Step 2: Verify OTP
      const { result: verifyResult } = renderHook(() => useVerifyOTP(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        verifyResult.current.mutate({ phone, token: otp });
      });

      await waitFor(() => expect(verifyResult.current.isSuccess).toBe(true));

      // Verify migration was called for new user
      expect(mockedMigrateGuestData).toHaveBeenCalledWith(mockSession);

      // Verify session was set (triggers navigation)
      expect(setSession).toHaveBeenCalledWith(mockSession);
    });
  });

  describe('complete returning user flow', () => {
    it('send OTP → verify → migration skipped → session set', async () => {
      const mockSession = createMockSession();
      const phone = '+15551234567';
      const otp = '123456';

      // Mock sendOTP success
      mockSignInWithOtp.mockResolvedValue({ error: null });

      // Mock verifyOTP success
      mockVerifyOtp.mockResolvedValue({
        data: { session: mockSession, user: mockSession.user },
        error: null,
      });

      // Mock user_countries check (returning user - has data)
      mockSupabaseFrom.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({ data: [{ id: 'existing-country' }], error: null }),
      });

      // Step 1: Send OTP
      const { result: sendResult } = renderHook(() => useSendOTP(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        sendResult.current.mutate({ phone });
      });

      await waitFor(() => expect(sendResult.current.isSuccess).toBe(true));

      // Step 2: Verify OTP
      const { result: verifyResult } = renderHook(() => useVerifyOTP(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        verifyResult.current.mutate({ phone, token: otp });
      });

      await waitFor(() => expect(verifyResult.current.isSuccess).toBe(true));

      // Verify migration was NOT called for returning user
      expect(mockedMigrateGuestData).not.toHaveBeenCalled();

      // Verify onboarding marked complete
      expect(setHasCompletedOnboarding).toHaveBeenCalledWith(true);

      // Verify session was set
      expect(setSession).toHaveBeenCalledWith(mockSession);
    });
  });

  describe('resend OTP', () => {
    it('allows resending OTP after initial send', async () => {
      const phone = '+15551234567';

      mockSignInWithOtp.mockResolvedValue({ error: null });

      const { result } = renderHook(() => useSendOTP(), {
        wrapper: createWrapper(queryClient),
      });

      // First send
      await act(async () => {
        result.current.mutate({ phone });
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      // Reset for second send
      await act(async () => {
        result.current.reset();
      });

      // Resend
      await act(async () => {
        result.current.mutate({ phone });
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      // Verify signInWithOtp was called twice
      expect(mockSignInWithOtp).toHaveBeenCalledTimes(2);
    });
  });

  describe('invalid OTP with retry', () => {
    it('shows error on invalid OTP, allows retry with valid code', async () => {
      const mockSession = createMockSession();
      const phone = '+15551234567';
      const invalidOtp = '000000';
      const validOtp = '123456';

      // Mock sendOTP success
      mockSignInWithOtp.mockResolvedValue({ error: null });

      // First verify fails, second succeeds
      mockVerifyOtp
        .mockResolvedValueOnce({
          data: { session: null, user: null },
          error: new Error('Invalid code'),
        })
        .mockResolvedValueOnce({
          data: { session: mockSession, user: mockSession.user },
          error: null,
        });

      // Mock user_countries for successful verification
      mockSupabaseFrom.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({ data: [], error: null }),
      });

      // Step 1: Send OTP
      const { result: sendResult } = renderHook(() => useSendOTP(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        sendResult.current.mutate({ phone });
      });
      await waitFor(() => expect(sendResult.current.isSuccess).toBe(true));

      // Step 2: Try invalid OTP
      const { result: verifyResult } = renderHook(() => useVerifyOTP(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        verifyResult.current.mutate({ phone, token: invalidOtp });
      });
      await waitFor(() => expect(verifyResult.current.isError).toBe(true));

      // Verify error state
      expect(verifyResult.current.error).toEqual(new Error('Invalid code'));

      // Step 3: Reset and retry with valid OTP
      await act(async () => {
        verifyResult.current.reset();
      });

      await act(async () => {
        verifyResult.current.mutate({ phone, token: validOtp });
      });
      await waitFor(() => expect(verifyResult.current.isSuccess).toBe(true));

      // Verify session was set on successful retry
      expect(setSession).toHaveBeenCalledWith(mockSession);
    });
  });

  describe('OTP with display name', () => {
    it('passes display name through verification flow', async () => {
      const mockSession = createMockSession();
      const phone = '+15551234567';
      const otp = '123456';
      const displayName = 'John Doe';

      mockSignInWithOtp.mockResolvedValue({ error: null });
      mockVerifyOtp.mockResolvedValue({
        data: { session: mockSession, user: mockSession.user },
        error: null,
      });

      // Mock RPC call for update_display_name
      mockSupabaseRpc.mockResolvedValue({ error: null });

      // Mock user_countries (new user)
      mockSupabaseFrom.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({ data: [], error: null }),
      });

      const { result } = renderHook(() => useVerifyOTP(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        result.current.mutate({ phone, token: otp, displayName });
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      // Verify RPC was called with display name
      expect(mockSupabaseRpc).toHaveBeenCalledWith('update_display_name', {
        new_display_name: displayName,
      });
    });
  });
});
