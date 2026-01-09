/**
 * Tests for useUserCountries hook behavior.
 *
 * Covers:
 * - SQLite local data is returned before fetch completes
 * - Real data replaces local data after fetch completes
 * - Empty state is not shown when local SQLite data exists
 * - Error states are preserved (not masked by local data)
 * - Loading state correctly reflects data availability
 */

import React from 'react';
import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';

import { useUserCountries } from '@hooks/useUserCountries';
import { api } from '@services/api';
import * as countriesDb from '@services/countriesDb';
import { useAuthStore } from '@stores/authStore';
import { createTestQueryClient } from '../utils/testUtils';

// Mock API
const mockedApi = api as jest.Mocked<typeof api>;

// Mock countriesDb
const mockedCountriesDb = countriesDb as jest.Mocked<typeof countriesDb>;

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

// Sample SQLite local data
const mockLocalCountries: countriesDb.LocalUserCountry[] = [
  {
    id: 'local-visited-US',
    country_code: 'US',
    status: 'visited',
    created_at: '2024-01-01T00:00:00Z',
    added_during_onboarding: true,
  },
  {
    id: 'local-visited-CA',
    country_code: 'CA',
    status: 'visited',
    created_at: '2024-01-01T00:00:00Z',
    added_during_onboarding: true,
  },
  {
    id: 'local-wishlist-JP',
    country_code: 'JP',
    status: 'wishlist',
    created_at: '2024-01-01T00:00:00Z',
    added_during_onboarding: true,
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

    // Default: no local SQLite data
    mockedCountriesDb.getLocalUserCountries.mockResolvedValue([]);
  });

  describe('SQLite local data behavior', () => {
    it('returns local SQLite data before fetch completes', async () => {
      // Setup: User is authenticated with local SQLite data
      useAuthStore.setState({
        session: mockSession,
        isMigrating: false,
      });
      mockedCountriesDb.getLocalUserCountries.mockResolvedValue(mockLocalCountries);

      // API will respond slowly to simulate network delay
      let resolveApi: (value: { data: typeof mockApiCountries }) => void;
      const apiPromise = new Promise<{ data: typeof mockApiCountries }>((resolve) => {
        resolveApi = resolve;
      });
      mockedApi.get.mockReturnValue(apiPromise);

      const { result } = renderHook(() => useUserCountries(), {
        wrapper: createWrapper(queryClient),
      });

      // Wait for SQLite data to load
      await waitFor(() => {
        expect(result.current.data).toBeDefined();
      });

      // Should return local data immediately
      expect(result.current.data?.length).toBe(3); // 2 visited + 1 wishlist
      expect(result.current.isLoading).toBe(false);

      // Verify local data structure
      const visitedCountries = result.current.data?.filter((c) => c.status === 'visited');
      const wishlistCountries = result.current.data?.filter((c) => c.status === 'wishlist');
      expect(visitedCountries?.map((c) => c.country_code)).toEqual(['US', 'CA']);
      expect(wishlistCountries?.map((c) => c.country_code)).toEqual(['JP']);

      // Verify local IDs match SQLite format
      expect(result.current.data?.every((c) => c.id.startsWith('local-'))).toBe(true);

      // Now resolve API
      resolveApi!({ data: mockApiCountries });

      await waitFor(() => {
        expect(result.current.isFetched).toBe(true);
      });
    });

    it('returns real data after fetch completes', async () => {
      // Setup: User is authenticated with local SQLite data
      useAuthStore.setState({
        session: mockSession,
        isMigrating: false,
      });
      mockedCountriesDb.getLocalUserCountries.mockResolvedValue(mockLocalCountries);
      mockedApi.get.mockResolvedValue({ data: mockApiCountries });

      const { result } = renderHook(() => useUserCountries(), {
        wrapper: createWrapper(queryClient),
      });

      // Wait for fetch to complete
      await waitFor(() => {
        expect(result.current.isFetched).toBe(true);
      });

      // After fetch, should return real data (not local)
      expect(result.current.data).toEqual(mockApiCountries);
      expect(result.current.data?.every((c) => !c.id.startsWith('local-'))).toBe(true);
    });

    it('preserves error state instead of masking with local data', async () => {
      // Setup: User is authenticated with local SQLite data
      useAuthStore.setState({
        session: mockSession,
        isMigrating: false,
      });
      mockedCountriesDb.getLocalUserCountries.mockResolvedValue(mockLocalCountries);

      const error = new Error('Network error');
      mockedApi.get.mockRejectedValue(error);

      const { result } = renderHook(() => useUserCountries(), {
        wrapper: createWrapper(queryClient),
      });

      // Wait for error state
      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      // Error should be preserved, not masked by local data
      expect(result.current.isError).toBe(true);
      expect(result.current.error).toBeDefined();
    });

    it('does not show empty state when local data exists', async () => {
      // Setup: User is authenticated with local SQLite data
      useAuthStore.setState({
        session: mockSession,
        isMigrating: false,
      });
      mockedCountriesDb.getLocalUserCountries.mockResolvedValue(mockLocalCountries);

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

      // Wait for SQLite data to load
      await waitFor(() => {
        expect(result.current.data).toBeDefined();
      });

      // Should never show empty data when local data exists
      expect(result.current.data?.length).toBeGreaterThan(0);

      // This is the key assertion: data should be available immediately
      // even though the query hasn't fetched yet
      expect(result.current.isFetched).toBe(false);
      expect(result.current.data?.length).toBe(3); // 2 visited + 1 wishlist

      // Cleanup: resolve the API call
      resolveApi!({ data: mockApiCountries });
      await waitFor(() => expect(result.current.isFetched).toBe(true));
    });

    it('correctly sets loading state when local data exists', async () => {
      // Setup: User is authenticated with local SQLite data
      useAuthStore.setState({
        session: mockSession,
        isMigrating: false,
      });
      mockedCountriesDb.getLocalUserCountries.mockResolvedValue(mockLocalCountries);

      let resolveApi: (value: { data: typeof mockApiCountries }) => void;
      mockedApi.get.mockReturnValue(
        new Promise((resolve) => {
          resolveApi = resolve;
        })
      );

      const { result } = renderHook(() => useUserCountries(), {
        wrapper: createWrapper(queryClient),
      });

      // Wait for SQLite data to load
      await waitFor(() => {
        expect(result.current.data).toBeDefined();
      });

      // With local data, isLoading should be false
      // to prevent loading spinners when we have data to show
      // However, isFetching is true because real data is still loading in background
      expect(result.current.isLoading).toBe(false);
      expect(result.current.isFetching).toBe(true);
      expect(result.current.data).toBeDefined();

      // Cleanup
      resolveApi!({ data: mockApiCountries });
      await waitFor(() => expect(result.current.isFetched).toBe(true));
    });
  });

  describe('migration behavior', () => {
    it('uses local SQLite data and skips API while migrating', async () => {
      useAuthStore.setState({
        session: mockSession,
        isMigrating: true,
      });
      mockedCountriesDb.getLocalUserCountries.mockResolvedValue(mockLocalCountries);
      mockedApi.get.mockResolvedValue({ data: [] });

      const { result } = renderHook(() => useUserCountries(), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => {
        expect(result.current.data).toBeDefined();
      });

      expect(result.current.data?.length).toBe(3);
      expect(result.current.isLoading).toBe(false);
      expect(mockedApi.get).not.toHaveBeenCalled();
    });

    it('prefers local SQLite data over empty API responses to avoid flashes', async () => {
      useAuthStore.setState({
        session: mockSession,
        isMigrating: false,
      });
      mockedCountriesDb.getLocalUserCountries.mockResolvedValue(mockLocalCountries);
      mockedApi.get.mockResolvedValue({ data: [] });

      const { result } = renderHook(() => useUserCountries(), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => {
        expect(result.current.data?.length).toBe(3);
      });

      expect(result.current.isLoading).toBe(false);
      expect(mockedApi.get).toHaveBeenCalledWith('/countries/user');
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

    it('fetches data normally when authenticated with no local data', async () => {
      useAuthStore.setState({
        session: mockSession,
        isMigrating: false,
      });
      mockedCountriesDb.getLocalUserCountries.mockResolvedValue([]);
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

    it('returns empty array when no countries exist (no local data)', async () => {
      useAuthStore.setState({
        session: mockSession,
        isMigrating: false,
      });
      mockedCountriesDb.getLocalUserCountries.mockResolvedValue([]);
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

  describe('local data structure', () => {
    it('converts local SQLite data to UserCountry format', async () => {
      useAuthStore.setState({
        session: mockSession,
        isMigrating: false,
      });
      mockedCountriesDb.getLocalUserCountries.mockResolvedValue([
        {
          id: 'local-visited-US',
          country_code: 'US',
          status: 'visited',
          created_at: '2024-01-01T00:00:00Z',
          added_during_onboarding: true,
        },
        {
          id: 'local-wishlist-JP',
          country_code: 'JP',
          status: 'wishlist',
          created_at: '2024-01-01T00:00:00Z',
          added_during_onboarding: true,
        },
      ]);

      // Don't resolve API to keep showing local data
      mockedApi.get.mockReturnValue(new Promise(() => {}));

      const { result } = renderHook(() => useUserCountries(), {
        wrapper: createWrapper(queryClient),
      });

      // Wait for SQLite data to load
      await waitFor(() => {
        expect(result.current.data).toBeDefined();
      });

      const visitedCountry = result.current.data?.find((c) => c.status === 'visited');
      const wishlistCountry = result.current.data?.find((c) => c.status === 'wishlist');

      // Verify structure matches UserCountry interface
      expect(visitedCountry).toMatchObject({
        id: 'local-visited-US',
        user_id: 'test-user-123',
        country_code: 'US',
        status: 'visited',
        added_during_onboarding: true,
      });
      expect(visitedCountry?.created_at).toBeDefined();

      expect(wishlistCountry).toMatchObject({
        id: 'local-wishlist-JP',
        user_id: 'test-user-123',
        country_code: 'JP',
        status: 'wishlist',
        added_during_onboarding: true,
      });
    });

    it('handles empty local data gracefully', async () => {
      useAuthStore.setState({
        session: mockSession,
        isMigrating: false,
      });
      mockedCountriesDb.getLocalUserCountries.mockResolvedValue([]);

      mockedApi.get.mockReturnValue(new Promise(() => {}));

      const { result } = renderHook(() => useUserCountries(), {
        wrapper: createWrapper(queryClient),
      });

      // No local data, so query shows loading state normally
      expect(result.current.data).toBeUndefined();
      expect(result.current.isLoading).toBe(true);
    });
  });
});
