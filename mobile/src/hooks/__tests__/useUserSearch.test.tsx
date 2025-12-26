import { renderHook, waitFor, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import { api } from '@services/api';
import { useUserSearch, useUsernameCheck } from '../useUserSearch';

// Mock the API service
jest.mock('@services/api');

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }

  return Wrapper;
}

// Mock timers for debounce testing
jest.useFakeTimers();

describe('useUserSearch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should not search with queries less than 2 characters', async () => {
    const { result } = renderHook(() => useUserSearch('a'), {
      wrapper: createWrapper(),
    });

    // Wait for debounce
    act(() => {
      jest.advanceTimersByTime(300);
    });

    await waitFor(() => {
      expect(result.current.data).toEqual([]);
    });

    expect(api.get).not.toHaveBeenCalled();
  });

  it('should search users with valid query', async () => {
    const mockResults = [
      {
        id: 'user-1',
        username: 'alice',
        avatar_url: null,
        country_count: 10,
        is_following: false,
      },
      {
        id: 'user-2',
        username: 'alicia',
        avatar_url: 'https://example.com/avatar.jpg',
        country_count: 5,
        is_following: true,
      },
    ];

    (api.get as jest.Mock).mockResolvedValue({ data: mockResults });

    const { result } = renderHook(() => useUserSearch('ali'), {
      wrapper: createWrapper(),
    });

    // Wait for debounce
    act(() => {
      jest.advanceTimersByTime(300);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(mockResults);
    expect(api.get).toHaveBeenCalledWith('/users/search', {
      params: { q: 'ali' },
    });
  });

  it('should debounce search queries', async () => {
    const { rerender } = renderHook(({ query }) => useUserSearch(query), {
      initialProps: { query: 'a' },
      wrapper: createWrapper(),
    });

    // Type multiple characters quickly
    rerender({ query: 'al' });
    act(() => {
      jest.advanceTimersByTime(100);
    });

    rerender({ query: 'ali' });
    act(() => {
      jest.advanceTimersByTime(100);
    });

    rerender({ query: 'alic' });
    act(() => {
      jest.advanceTimersByTime(100);
    });

    // API should not have been called yet
    expect(api.get).not.toHaveBeenCalled();

    // After debounce period, only the last query should be executed
    act(() => {
      jest.advanceTimersByTime(300);
    });

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledTimes(1);
      expect(api.get).toHaveBeenCalledWith('/users/search', {
        params: { q: 'alic' },
      });
    });
  });

  it('should respect custom debounce time', async () => {
    renderHook(() => useUserSearch('alice', 500), {
      wrapper: createWrapper(),
    });

    // Advance by less than custom debounce time
    act(() => {
      jest.advanceTimersByTime(400);
    });

    expect(api.get).not.toHaveBeenCalled();

    // Advance to complete custom debounce
    act(() => {
      jest.advanceTimersByTime(100);
    });

    await waitFor(() => {
      expect(api.get).toHaveBeenCalled();
    });
  });

  it('should handle empty search results', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: [] });

    const { result } = renderHook(() => useUserSearch('xyz'), {
      wrapper: createWrapper(),
    });

    act(() => {
      jest.advanceTimersByTime(300);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual([]);
  });

  it('should handle search errors', async () => {
    const mockError = new Error('Network error');
    (api.get as jest.Mock).mockRejectedValue(mockError);

    const { result } = renderHook(() => useUserSearch('alice'), {
      wrapper: createWrapper(),
    });

    act(() => {
      jest.advanceTimersByTime(300);
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error).toEqual(mockError);
  });
});

describe('useUsernameCheck', () => {
  it('should check username availability', async () => {
    const checkUsername = useUsernameCheck();

    const mockResponse = {
      available: true,
      suggestions: [],
    };

    (api.post as jest.Mock).mockResolvedValue({ data: mockResponse });

    const result = await checkUsername('alice123');

    expect(result).toEqual(mockResponse);
    expect(api.post).toHaveBeenCalledWith('/users/check-username', {
      username: 'alice123',
    });
  });

  it('should return unavailable with suggestions when username is taken', async () => {
    const checkUsername = useUsernameCheck();

    const mockResponse = {
      available: false,
      suggestions: ['alice124', 'alice125', 'alice_travels'],
    };

    (api.post as jest.Mock).mockResolvedValue({ data: mockResponse });

    const result = await checkUsername('alice');

    expect(result).toEqual(mockResponse);
    expect(result.available).toBe(false);
    expect(result.suggestions).toHaveLength(3);
  });

  it('should return unavailable for usernames less than 3 characters', async () => {
    const checkUsername = useUsernameCheck();

    const result = await checkUsername('ab');

    expect(result).toEqual({
      available: false,
      suggestions: [],
    });
    expect(api.post).not.toHaveBeenCalled();
  });

  it('should handle API errors gracefully', async () => {
    const checkUsername = useUsernameCheck();

    (api.post as jest.Mock).mockRejectedValue(new Error('Network error'));

    const result = await checkUsername('alice');

    expect(result).toEqual({
      available: false,
      suggestions: [],
    });
  });
});
