/**
 * Tests for useAuth hooks (email password authentication).
 *
 * Covers:
 * - useSignUpWithPassword: signup, race condition prevention, error handling
 * - useSignOut: signing out and cleanup
 */

import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { useSignUpWithPassword, useSignOut } from '@hooks/useAuth';
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
const mockSignOut = supabase.auth.signOut as jest.Mock;
const mockSignUp = supabase.auth.signUp as jest.Mock;

// Mock API service functions that aren't in jest.setup.js
jest.mock('@services/api', () => ({
  ...jest.requireActual('@services/api'),
  api: {
    post: jest.fn().mockResolvedValue({ data: { status: 'scheduled' } }),
  },
  clearTokens: jest.fn().mockResolvedValue(undefined),
  clearOnboardingComplete: jest.fn().mockResolvedValue(undefined),
  storeTokens: jest.fn().mockResolvedValue(undefined),
}));

// Mock guestMigration service
jest.mock('@services/guestMigration', () => ({
  migrateGuestData: jest.fn().mockResolvedValue({
    success: true,
    migratedCountries: 0,
    migratedProfile: false,
    errors: [],
  }),
  captureOnboardingSnapshot: jest.fn().mockReturnValue({
    selectedCountries: [],
    bucketListCountries: [],
    dreamDestination: null,
    homeCountry: null,
    motivationTags: [],
    personaTags: [],
    trackingPreference: 'full_atlas',
  }),
}));

// Create wrapper for hooks
function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

// Mock session data
function createMockSession() {
  return {
    access_token: 'test-access-token',
    refresh_token: 'test-refresh-token',
    user: { id: 'user-123', user_metadata: {} },
  };
}

describe('useAuth', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
    jest.clearAllMocks();

    // Reset stores to real implementations so we can observe state changes
    useAuthStore.setState({
      session: null,
      hasCompletedOnboarding: false,
      needsPostSignupFlow: false,
      isMigrating: false,
    });
    useOnboardingStore.setState({
      reset: jest.fn(),
    });
  });

  // ============ useSignUpWithPassword Tests ============

  describe('useSignUpWithPassword', () => {
    const mockSession = createMockSession();

    describe('Race condition prevention', () => {
      it('sets needsPostSignupFlow before supabase.auth.signUp executes', async () => {
        const callOrder: string[] = [];

        mockSignUp.mockImplementation(async () => {
          // At this point, needsPostSignupFlow should already be true
          callOrder.push('signUp');
          const currentState = useAuthStore.getState().needsPostSignupFlow;
          callOrder.push(`needsPostSignupFlow=${currentState}`);
          return {
            data: { session: mockSession, user: mockSession.user },
            error: null,
          };
        });

        // Suppress console.warn from welcome email failure
        jest.spyOn(console, 'warn').mockImplementation();

        const { result } = renderHook(() => useSignUpWithPassword(), {
          wrapper: createWrapper(queryClient),
        });

        await act(async () => {
          result.current.mutate({
            email: 'test@example.com',
            password: 'password123',
            displayName: 'Test User',
          });
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        // needsPostSignupFlow must be true BEFORE signUp is called
        expect(callOrder).toContain('needsPostSignupFlow=true');
        expect(useAuthStore.getState().needsPostSignupFlow).toBe(true);
      });

      it('resets needsPostSignupFlow on signup error', async () => {
        mockSignUp.mockResolvedValue({
          data: {},
          error: { message: 'User already registered' },
        });

        jest.spyOn(console, 'error').mockImplementation();

        const { result } = renderHook(() => useSignUpWithPassword(), {
          wrapper: createWrapper(queryClient),
        });

        await act(async () => {
          result.current.mutate({
            email: 'test@example.com',
            password: 'password123',
          });
        });

        await waitFor(() => expect(result.current.isError).toBe(true));

        // Flag should be reset on error
        expect(useAuthStore.getState().needsPostSignupFlow).toBe(false);
      });

      it('resets needsPostSignupFlow when no session returned (email confirmation required)', async () => {
        mockSignUp.mockResolvedValue({
          data: { session: null, user: null },
          error: null,
        });

        jest.spyOn(console, 'error').mockImplementation();

        const { result } = renderHook(() => useSignUpWithPassword(), {
          wrapper: createWrapper(queryClient),
        });

        await act(async () => {
          result.current.mutate({
            email: 'test@example.com',
            password: 'password123',
          });
        });

        await waitFor(() => expect(result.current.isError).toBe(true));

        // Flag should be reset when signup doesn't return a session
        expect(useAuthStore.getState().needsPostSignupFlow).toBe(false);
      });
    });
  });

  // ============ useSignOut Tests ============

  describe('useSignOut', () => {
    beforeEach(() => {
      // useSignOut uses mock functions from the store
      useAuthStore.setState({
        signOut: jest.fn(),
      });
    });

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
