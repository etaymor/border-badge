/**
 * Tests for useUserProfile hook.
 *
 * Covers:
 * - Fetching user profile by username
 * - Profile data structure (follower/following counts)
 * - Follow and block status
 * - Error handling (user not found)
 */

import React from 'react';
import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { useUserProfile } from '@hooks/useUserProfile';
import { api } from '@services/api';
import { createTestQueryClient } from '../utils/testUtils';

// Mock API
jest.mock('@services/api', () => ({
  api: {
    get: jest.fn(),
  },
}));

// Test data
const mockProfile = {
  id: 'profile-id',
  user_id: 'user-123',
  username: 'worldtraveler',
  display_name: 'World Traveler',
  avatar_url: 'https://example.com/avatar.jpg',
  country_count: 42,
  follower_count: 150,
  following_count: 75,
  is_following: true,
  is_blocked: false,
};

// Create wrapper for hooks
function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useUserProfile', () => {
  let queryClient: QueryClient;
  const mockedApi = api as jest.Mocked<typeof api>;

  beforeEach(() => {
    queryClient = createTestQueryClient();
    jest.clearAllMocks();
  });

  it('fetches user profile by username', async () => {
    mockedApi.get.mockResolvedValue({ data: mockProfile });

    const { result } = renderHook(() => useUserProfile('worldtraveler'), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(mockProfile);
    expect(mockedApi.get).toHaveBeenCalledWith('/users/worldtraveler/profile');
  });

  it('includes follower and following counts', async () => {
    mockedApi.get.mockResolvedValue({ data: mockProfile });

    const { result } = renderHook(() => useUserProfile('worldtraveler'), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.follower_count).toBe(150);
    expect(result.current.data?.following_count).toBe(75);
    expect(result.current.data?.country_count).toBe(42);
  });

  it('includes is_following status', async () => {
    mockedApi.get.mockResolvedValue({ data: mockProfile });

    const { result } = renderHook(() => useUserProfile('worldtraveler'), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.is_following).toBe(true);
  });

  it('includes is_blocked status', async () => {
    mockedApi.get.mockResolvedValue({ data: { ...mockProfile, is_blocked: true } });

    const { result } = renderHook(() => useUserProfile('blockeduser'), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.is_blocked).toBe(true);
  });

  it('handles user not found error', async () => {
    const notFoundError = new Error('User not found') as Error & {
      response?: { status: number };
    };
    notFoundError.response = { status: 404 };
    mockedApi.get.mockRejectedValue(notFoundError);

    const { result } = renderHook(() => useUserProfile('nonexistent'), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeDefined();
  });

  it('does not fetch when username is empty', async () => {
    mockedApi.get.mockResolvedValue({ data: mockProfile });

    const { result } = renderHook(() => useUserProfile(''), {
      wrapper: createWrapper(queryClient),
    });

    // Give it time to potentially fetch
    await new Promise((resolve) => setTimeout(resolve, 50));

    // API should not have been called
    expect(mockedApi.get).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('handles network errors', async () => {
    mockedApi.get.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useUserProfile('testuser'), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeDefined();
  });

  it('includes all profile fields in response', async () => {
    mockedApi.get.mockResolvedValue({ data: mockProfile });

    const { result } = renderHook(() => useUserProfile('worldtraveler'), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const profile = result.current.data;
    expect(profile).toHaveProperty('id');
    expect(profile).toHaveProperty('user_id');
    expect(profile).toHaveProperty('username');
    expect(profile).toHaveProperty('display_name');
    expect(profile).toHaveProperty('avatar_url');
    expect(profile).toHaveProperty('country_count');
    expect(profile).toHaveProperty('follower_count');
    expect(profile).toHaveProperty('following_count');
    expect(profile).toHaveProperty('is_following');
    expect(profile).toHaveProperty('is_blocked');
  });

  it('handles profile with null avatar', async () => {
    const profileNoAvatar = { ...mockProfile, avatar_url: null };
    mockedApi.get.mockResolvedValue({ data: profileNoAvatar });

    const { result } = renderHook(() => useUserProfile('noavatar'), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.avatar_url).toBeNull();
  });
});
