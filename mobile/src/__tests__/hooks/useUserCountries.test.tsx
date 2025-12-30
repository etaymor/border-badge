/**
 * Tests for useUserCountries hook migration behavior.
 *
 * Covers:
 * - Placeholder data is returned during migration before fetch
 * - Real data replaces placeholder after fetch completes
 * - Empty state is not shown when migrating with onboarding data
 * - Error states are preserved (not masked by placeholder data)
 * - Loading state correctly reflects data availability
 */

import React from 'react';
import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';

import { useUserCountries } from '@hooks/useUserCountries';
import { api } from '@services/api';
import { useAuthStore } from '@stores/authStore';
import { useOnboardingStore } from '@stores/onboardingStore';
import { createTestQueryClient } from '../utils/testUtils';

// Mock API
const mockedApi = api as jest.Mocked<typeof api>;

// Create wrapper for hooks
function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

// Mock session for authenticated user - cast to Session to satisfy type checking
const mockSession = {
  user: {
    id: 'test-user-123',
    email: 'test@example.com',
    app_metadata: {},
    user_metadata: {},
    aud: 'authenticated',
    created_at: '2024-01-01T00:00:00Z',
  },
  access_token: 'test-access-token',
  refresh_token: 'test-refresh-token',
  expires_in: 3600,
  token_type: 'bearer' as const,
  expires_at: Date.now() / 1000 + 3600,
} as unknown as Session;

// Sample API response data
const mockApiCountries = [
  {
    id: 'real-1',
    user_id: 'test-user-123',
    country_code: 'US',
    status: 'visited' as const,
    created_at: '2024-01-01T00:00:00Z',
    added_during_onboarding: true,
  },
  {
    id: 'real-2',
    user_id: 'test-user-123',
    country_code: 'FR',
    status: 'wishlist' as const,
    created_at: '2024-01-01T00:00:00Z',
    added_during_onboarding: false,
  },
];

describe('useUserCountries', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
    jest.clearAllMocks();

    // Reset stores to default state
    useAuthStore.setState({
      session: null,
      hasCompletedOnboarding: false,
      isMigrating: false,
    });
    useOnboardingStore.setState({
      selectedCountries: [],
      bucketListCountries: [],
    });
  });

  describe('migration behavior', () => {
    it('returns placeholder data during migration before fetch completes', async () => {
      // Setup: User is migrating with onboarding data
      useAuthStore.setState({
        session: mockSession,
        isMigrating: true,
      });
      useOnboardingStore.setState({
        selectedCountries: ['US', 'CA'],
        bucketListCountries: ['JP'],
      });

      // API will respond slowly to simulate migration in progress
      let resolveApi: (value: { data: typeof mockApiCountries }) => void;
      const apiPromise = new Promise<{ data: typeof mockApiCountries }>((resolve) => {
        resolveApi = resolve;
      });
      mockedApi.get.mockReturnValue(apiPromise);

      const { result } = renderHook(() => useUserCountries(), {
        wrapper: createWrapper(queryClient),
      });

      // During migration, should return placeholder data immediately
      expect(result.current.data).toBeDefined();
      expect(result.current.data?.length).toBe(3); // 2 visited + 1 wishlist
      expect(result.current.isLoading).toBe(false);

      // Verify placeholder data structure
      const visitedCountries = result.current.data?.filter((c) => c.status === 'visited');
      const wishlistCountries = result.current.data?.filter((c) => c.status === 'wishlist');
      expect(visitedCountries?.map((c) => c.country_code)).toEqual(['US', 'CA']);
      expect(wishlistCountries?.map((c) => c.country_code)).toEqual(['JP']);

      // Verify placeholder IDs are temporary
      expect(result.current.data?.every((c) => c.id.startsWith('temp-'))).toBe(true);

      // Now resolve API
      resolveApi!({ data: mockApiCountries });

      await waitFor(() => {
        expect(result.current.isFetched).toBe(true);
      });
    });

    it('returns real data after fetch completes', async () => {
      // Setup: User is migrating with onboarding data
      useAuthStore.setState({
        session: mockSession,
        isMigrating: true,
      });
      useOnboardingStore.setState({
        selectedCountries: ['US'],
        bucketListCountries: [],
      });

      mockedApi.get.mockResolvedValue({ data: mockApiCountries });

      const { result } = renderHook(() => useUserCountries(), {
        wrapper: createWrapper(queryClient),
      });

      // Wait for fetch to complete
      await waitFor(() => {
        expect(result.current.isFetched).toBe(true);
      });

      // After fetch, should return real data (not placeholder)
      expect(result.current.data).toEqual(mockApiCountries);
      expect(result.current.data?.every((c) => !c.id.startsWith('temp-'))).toBe(true);
    });

    it('preserves error state instead of masking with placeholder data', async () => {
      // Setup: User is migrating with onboarding data
      useAuthStore.setState({
        session: mockSession,
        isMigrating: true,
      });
      useOnboardingStore.setState({
        selectedCountries: ['US'],
        bucketListCountries: [],
      });

      const error = new Error('Network error');
      mockedApi.get.mockRejectedValue(error);

      const { result } = renderHook(() => useUserCountries(), {
        wrapper: createWrapper(queryClient),
      });

      // Wait for error state
      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      // Error should be preserved, not masked by placeholder
      expect(result.current.isError).toBe(true);
      expect(result.current.error).toBeDefined();
    });

    it('does not show empty state when migrating with onboarding data', async () => {
      // Setup: User is migrating with onboarding data
      useAuthStore.setState({
        session: mockSession,
        isMigrating: true,
      });
      useOnboardingStore.setState({
        selectedCountries: ['US', 'CA', 'MX'],
        bucketListCountries: ['JP', 'KR'],
      });

      // API will take time (simulating network delay)
      let resolveApi: (value: { data: typeof mockApiCountries }) => void;
      mockedApi.get.mockReturnValue(
        new Promise((resolve) => {
          resolveApi = resolve;
        })
      );

      const { result } = renderHook(() => useUserCountries(), {
        wrapper: createWrapper(queryClient),
      });

      // Should never show empty data during migration
      expect(result.current.data).toBeDefined();
      expect(result.current.data?.length).toBeGreaterThan(0);

      // This is the key assertion: data should be available immediately
      // even though the query hasn't fetched yet
      expect(result.current.isFetched).toBe(false);
      expect(result.current.data?.length).toBe(5); // 3 visited + 2 wishlist

      // Cleanup: resolve the API call
      resolveApi!({ data: mockApiCountries });
      await waitFor(() => expect(result.current.isFetched).toBe(true));
    });

    it('correctly sets loading state during migration', async () => {
      // Setup: User is migrating with onboarding data
      useAuthStore.setState({
        session: mockSession,
        isMigrating: true,
      });
      useOnboardingStore.setState({
        selectedCountries: ['US'],
        bucketListCountries: [],
      });

      let resolveApi: (value: { data: typeof mockApiCountries }) => void;
      mockedApi.get.mockReturnValue(
        new Promise((resolve) => {
          resolveApi = resolve;
        })
      );

      const { result } = renderHook(() => useUserCountries(), {
        wrapper: createWrapper(queryClient),
      });

      // During migration with placeholder data, isLoading should be false
      // to prevent loading spinners when we have data to show
      expect(result.current.isLoading).toBe(false);
      expect(result.current.isFetching).toBe(false);
      expect(result.current.data).toBeDefined();

      // Cleanup
      resolveApi!({ data: mockApiCountries });
      await waitFor(() => expect(result.current.isFetched).toBe(true));
    });
  });

  describe('non-migration behavior', () => {
    it('returns undefined data when not authenticated', () => {
      // No session set
      useAuthStore.setState({
        session: null,
        isMigrating: false,
      });

      const { result } = renderHook(() => useUserCountries(), {
        wrapper: createWrapper(queryClient),
      });

      // Query should be disabled
      expect(result.current.data).toBeUndefined();
      expect(result.current.isFetched).toBe(false);
    });

    it('fetches data normally when authenticated but not migrating', async () => {
      useAuthStore.setState({
        session: mockSession,
        isMigrating: false,
      });

      mockedApi.get.mockResolvedValue({ data: mockApiCountries });

      const { result } = renderHook(() => useUserCountries(), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => {
        expect(result.current.isFetched).toBe(true);
      });

      expect(result.current.data).toEqual(mockApiCountries);
      expect(mockedApi.get).toHaveBeenCalledWith('/countries/user');
    });

    it('returns empty array when no countries exist (not migrating)', async () => {
      useAuthStore.setState({
        session: mockSession,
        isMigrating: false,
      });

      mockedApi.get.mockResolvedValue({ data: [] });

      const { result } = renderHook(() => useUserCountries(), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => {
        expect(result.current.isFetched).toBe(true);
      });

      // Empty array is valid data, not undefined
      expect(result.current.data).toEqual([]);
    });
  });

  describe('placeholder data structure', () => {
    it('generates correct placeholder data structure during migration', () => {
      useAuthStore.setState({
        session: mockSession,
        isMigrating: true,
      });
      useOnboardingStore.setState({
        selectedCountries: ['US'],
        bucketListCountries: ['JP'],
      });

      // Don't resolve API to keep in placeholder state
      mockedApi.get.mockReturnValue(new Promise(() => {}));

      const { result } = renderHook(() => useUserCountries(), {
        wrapper: createWrapper(queryClient),
      });

      const visitedCountry = result.current.data?.find((c) => c.status === 'visited');
      const wishlistCountry = result.current.data?.find((c) => c.status === 'wishlist');

      // Verify structure matches UserCountry interface
      expect(visitedCountry).toMatchObject({
        id: expect.stringMatching(/^temp-visited-/),
        user_id: 'test-user-123',
        country_code: 'US',
        status: 'visited',
        added_during_onboarding: true,
      });
      expect(visitedCountry?.created_at).toBeDefined();

      expect(wishlistCountry).toMatchObject({
        id: expect.stringMatching(/^temp-wishlist-/),
        user_id: 'test-user-123',
        country_code: 'JP',
        status: 'wishlist',
        added_during_onboarding: true,
      });
    });

    it('handles empty onboarding data during migration', () => {
      useAuthStore.setState({
        session: mockSession,
        isMigrating: true,
      });
      useOnboardingStore.setState({
        selectedCountries: [],
        bucketListCountries: [],
      });

      mockedApi.get.mockReturnValue(new Promise(() => {}));

      const { result } = renderHook(() => useUserCountries(), {
        wrapper: createWrapper(queryClient),
      });

      // No placeholder data when onboarding has no countries
      // Query will show loading state normally
      expect(result.current.data).toBeUndefined();
      expect(result.current.isLoading).toBe(true);
    });
  });
});
