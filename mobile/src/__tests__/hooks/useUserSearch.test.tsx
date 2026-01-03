/**
 * Tests for useUserSearch hook.
 *
 * Covers:
 * - Searching users by username prefix
 * - Minimum query length requirement (2 chars)
 * - Empty search results
 * - Error handling
 * - Search result structure with follow status
 */

import React from 'react';
import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { useUserSearch } from '@hooks/useUserSearch';
import { api } from '@services/api';
import { createTestQueryClient } from '../utils/testUtils';

// Mock API
jest.mock('@services/api', () => ({
  api: {
    get: jest.fn(),
  },
}));

// Test data
const mockSearchResults = [
  {
    id: 'user-1',
    username: 'traveler',
    avatar_url: 'https://example.com/avatar1.jpg',
    country_count: 25,
    is_following: true,
  },
  {
    id: 'user-2',
    username: 'explorer',
    avatar_url: null,
    country_count: 10,
    is_following: false,
  },
];

// Create wrapper for hooks
function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useUserSearch', () => {
  let queryClient: QueryClient;
  const mockedApi = api as jest.Mocked<typeof api>;

  beforeEach(() => {
    queryClient = createTestQueryClient();
    jest.clearAllMocks();
  });

  it('fetches users by search query', async () => {
    mockedApi.get.mockResolvedValue({ data: mockSearchResults });

    const { result } = renderHook(() => useUserSearch('trav', { debounceMs: 0 }), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(mockSearchResults);
    const [url, config] = mockedApi.get.mock.calls[0];
    expect(url).toBe('/users/search');
    expect(config?.params).toEqual({ q: 'trav', limit: 10 });
  });

  it('respects minimum query length (2 chars)', async () => {
    mockedApi.get.mockResolvedValue({ data: [] });

    // Query with 1 character - should NOT fetch
    const { result: shortResult } = renderHook(() => useUserSearch('t', { debounceMs: 0 }), {
      wrapper: createWrapper(queryClient),
    });

    // Give it time to potentially fetch
    await new Promise((resolve) => setTimeout(resolve, 50));

    // API should not have been called for 1-char query
    expect(mockedApi.get).not.toHaveBeenCalled();
    expect(shortResult.current.fetchStatus).toBe('idle');

    // Query with 2 characters - should fetch
    const { result: validResult } = renderHook(() => useUserSearch('tr', { debounceMs: 0 }), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(validResult.current.isSuccess).toBe(true));
    const [, validConfig] = mockedApi.get.mock.calls[0];
    expect(validConfig?.params).toEqual({ q: 'tr', limit: 10 });
  });

  it('returns empty array for no results', async () => {
    mockedApi.get.mockResolvedValue({ data: [] });

    const { result } = renderHook(() => useUserSearch('nonexistent', { debounceMs: 0 }), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual([]);
  });

  it('handles error state', async () => {
    mockedApi.get.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useUserSearch('test', { debounceMs: 0 }), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeDefined();
  });

  it('includes follow status in results', async () => {
    mockedApi.get.mockResolvedValue({ data: mockSearchResults });

    const { result } = renderHook(() => useUserSearch('user', { debounceMs: 0 }), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // First user is being followed
    expect(result.current.data?.[0].is_following).toBe(true);
    // Second user is not being followed
    expect(result.current.data?.[1].is_following).toBe(false);
  });

  it('supports custom limit option', async () => {
    mockedApi.get.mockResolvedValue({ data: mockSearchResults });

    const { result } = renderHook(() => useUserSearch('test', { limit: 5, debounceMs: 0 }), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [, limitConfig] = mockedApi.get.mock.calls[0];
    expect(limitConfig?.params).toEqual({ q: 'test', limit: 5 });
  });

  it('respects enabled option', async () => {
    mockedApi.get.mockResolvedValue({ data: [] });

    const { result } = renderHook(() => useUserSearch('test', { enabled: false, debounceMs: 0 }), {
      wrapper: createWrapper(queryClient),
    });

    // Give it time to potentially fetch
    await new Promise((resolve) => setTimeout(resolve, 50));

    // API should not have been called when disabled
    expect(mockedApi.get).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('includes all user fields in results', async () => {
    mockedApi.get.mockResolvedValue({ data: mockSearchResults });

    const { result } = renderHook(() => useUserSearch('trav', { debounceMs: 0 }), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const firstUser = result.current.data?.[0];
    expect(firstUser).toHaveProperty('id');
    expect(firstUser).toHaveProperty('username');
    expect(firstUser).toHaveProperty('avatar_url');
    expect(firstUser).toHaveProperty('country_count');
    expect(firstUser).toHaveProperty('is_following');
  });
});
