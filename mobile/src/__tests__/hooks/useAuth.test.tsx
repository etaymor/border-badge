/**
 * Tests for useAuth hooks (email magic link authentication).
 *
 * Covers:
 * - useSendMagicLink: sending magic link emails
 * - useSignOut: signing out and cleanup
 */

import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { useSendMagicLink, useSignOut } from '@hooks/useAuth';
import { supabase } from '@services/supabase';
import { clearTokens, clearOnboardingComplete } from '@services/api';
import { useAuthStore } from '@stores/authStore';
import { useOnboardingStore } from '@stores/onboardingStore';
import { createTestQueryClient } from '../utils/testUtils';

// Type the mocks
const mockedClearTokens = clearTokens as jest.MockedFunction<typeof clearTokens>;
const mockedClearOnboardingComplete = clearOnboardingComplete as jest.MockedFunction<
  typeof clearOnboardingComplete
>;

// Helper to mock supabase auth methods
const mockSignInWithOtp = jest.fn();
const mockSignOut = supabase.auth.signOut as jest.Mock;

// Mock API service functions that aren't in jest.setup.js
jest.mock('@services/api', () => ({
  ...jest.requireActual('@services/api'),
  clearTokens: jest.fn().mockResolvedValue(undefined),
  clearOnboardingComplete: jest.fn().mockResolvedValue(undefined),
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

    // Default supabase mock setup
    Object.assign(supabase.auth, {
      signInWithOtp: mockSignInWithOtp,
    });
  });

  // ============ useSendMagicLink Tests ============

  describe('useSendMagicLink', () => {
    it('calls supabase.auth.signInWithOtp with email and redirect URL', async () => {
      mockSignInWithOtp.mockResolvedValue({ error: null });

      const { result } = renderHook(() => useSendMagicLink(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        result.current.mutate({ email: 'test@example.com' });
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockSignInWithOtp).toHaveBeenCalledWith({
        email: 'test@example.com',
        options: {
          emailRedirectTo: 'atlasi://auth-callback',
          data: undefined,
        },
      });
    });

    it('includes display name in user metadata when provided', async () => {
      mockSignInWithOtp.mockResolvedValue({ error: null });

      const { result } = renderHook(() => useSendMagicLink(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        result.current.mutate({ email: 'test@example.com', displayName: 'John Doe' });
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockSignInWithOtp).toHaveBeenCalledWith({
        email: 'test@example.com',
        options: {
          emailRedirectTo: 'atlasi://auth-callback',
          data: { display_name: 'John Doe' },
        },
      });
    });

    it('returns success state when magic link sent', async () => {
      mockSignInWithOtp.mockResolvedValue({ error: null });

      const { result } = renderHook(() => useSendMagicLink(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        result.current.mutate({ email: 'test@example.com' });
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.isError).toBe(false);
    });

    it('returns error state on failure', async () => {
      const error = new Error('Rate limit exceeded');
      mockSignInWithOtp.mockResolvedValue({ error });

      const { result } = renderHook(() => useSendMagicLink(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        result.current.mutate({ email: 'test@example.com' });
      });

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.error).toEqual(error);
    });

    it('handles network errors gracefully', async () => {
      mockSignInWithOtp.mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useSendMagicLink(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        result.current.mutate({ email: 'test@example.com' });
      });

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.error?.message).toBe('Network error');
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
