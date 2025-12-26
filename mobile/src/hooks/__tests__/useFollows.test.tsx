import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import { api } from '@services/api';
import {
  useFollowing,
  useFollowers,
  useFollowStats,
  useFollowUser,
  useUnfollowUser,
} from '../useFollows';

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

describe('useFollowing', () => {
  it('should fetch following list', async () => {
    const mockFollowing = {
      users: [
        {
          id: 'user-1',
          username: 'alice',
          avatar_url: null,
          country_count: 10,
          is_following: true,
          created_at: '2024-01-01T00:00:00Z',
        },
      ],
      total: 1,
      limit: 20,
      offset: 0,
      has_more: false,
    };

    (api.get as jest.Mock).mockResolvedValue({ data: mockFollowing });

    const { result } = renderHook(() => useFollowing(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(mockFollowing);
    expect(api.get).toHaveBeenCalledWith('/follows/following', {
      params: { limit: 20, offset: 0 },
    });
  });

  it('should support pagination', async () => {
    const mockFollowing = {
      users: [],
      total: 25,
      limit: 10,
      offset: 10,
      has_more: true,
    };

    (api.get as jest.Mock).mockResolvedValue({ data: mockFollowing });

    const { result } = renderHook(() => useFollowing(10, 10), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.get).toHaveBeenCalledWith('/follows/following', {
      params: { limit: 10, offset: 10 },
    });
  });
});

describe('useFollowers', () => {
  it('should fetch followers list', async () => {
    const mockFollowers = {
      users: [
        {
          id: 'user-2',
          username: 'bob',
          avatar_url: 'https://example.com/avatar.jpg',
          country_count: 5,
          is_following: false,
          created_at: '2024-01-02T00:00:00Z',
        },
      ],
      total: 1,
      limit: 20,
      offset: 0,
      has_more: false,
    };

    (api.get as jest.Mock).mockResolvedValue({ data: mockFollowers });

    const { result } = renderHook(() => useFollowers(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(mockFollowers);
    expect(api.get).toHaveBeenCalledWith('/follows/followers', {
      params: { limit: 20, offset: 0 },
    });
  });
});

describe('useFollowStats', () => {
  it('should fetch follow statistics', async () => {
    const mockStats = {
      following_count: 15,
      follower_count: 23,
    };

    (api.get as jest.Mock).mockResolvedValue({ data: mockStats });

    const { result } = renderHook(() => useFollowStats(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(mockStats);
    expect(api.get).toHaveBeenCalledWith('/follows/stats');
  });
});

describe('useFollowUser', () => {
  it('should follow a user', async () => {
    (api.post as jest.Mock).mockResolvedValue({ data: {} });

    const { result } = renderHook(() => useFollowUser('user-123'), {
      wrapper: createWrapper(),
    });

    result.current.mutate();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.post).toHaveBeenCalledWith('/follows/user-123');
  });

  it('should handle follow errors', async () => {
    const mockError = new Error('Cannot follow this user');
    (api.post as jest.Mock).mockRejectedValue(mockError);

    const { result } = renderHook(() => useFollowUser('user-123'), {
      wrapper: createWrapper(),
    });

    result.current.mutate();

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error).toEqual(mockError);
  });
});

describe('useUnfollowUser', () => {
  it('should unfollow a user', async () => {
    (api.delete as jest.Mock).mockResolvedValue({ data: {} });

    const { result } = renderHook(() => useUnfollowUser('user-123'), {
      wrapper: createWrapper(),
    });

    result.current.mutate();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.delete).toHaveBeenCalledWith('/follows/user-123');
  });

  it('should handle unfollow errors', async () => {
    const mockError = new Error('User not found');
    (api.delete as jest.Mock).mockRejectedValue(mockError);

    const { result } = renderHook(() => useUnfollowUser('user-123'), {
      wrapper: createWrapper(),
    });

    result.current.mutate();

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error).toEqual(mockError);
  });
});
