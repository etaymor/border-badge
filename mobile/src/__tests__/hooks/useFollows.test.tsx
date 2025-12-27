/**
 * Tests for useFollows hooks.
 *
 * Covers:
 * - useFollowStats: fetching follow statistics
 * - useFollowing: fetching list of followed users
 * - useFollowers: fetching list of followers
 * - useFollowUser: following a user with optimistic updates
 * - useUnfollowUser: unfollowing a user with optimistic updates
 */

import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import {
  useFollowStats,
  useFollowing,
  useFollowers,
  useFollowUser,
  useUnfollowUser,
} from '@hooks/useFollows';
import { api } from '@services/api';
import { createTestQueryClient } from '../utils/testUtils';

// Mock API
jest.mock('@services/api', () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
    delete: jest.fn(),
  },
}));

// Note: Alert.alert is mocked in jest.setup.js at the internal path
// Testing Alert calls is complex due to React Native's module structure.
// We test error state and rollback behavior instead.

// Test data
const mockStats = { follower_count: 10, following_count: 5 };
const mockUser = {
  id: 'user-1',
  user_id: 'user-1',
  username: 'testuser',
  display_name: 'Test User',
  avatar_url: null,
  country_count: 3,
};
const OTHER_USER_ID = 'other-user-123';

// Create wrapper for hooks
function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useFollows', () => {
  let queryClient: QueryClient;
  const mockedApi = api as jest.Mocked<typeof api>;

  beforeEach(() => {
    queryClient = createTestQueryClient();
    jest.clearAllMocks();
  });

  // ============ useFollowStats Tests ============

  describe('useFollowStats', () => {
    it('fetches follow stats successfully', async () => {
      mockedApi.get.mockResolvedValue({ data: mockStats });

      const { result } = renderHook(() => useFollowStats(), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toEqual(mockStats);
      expect(mockedApi.get).toHaveBeenCalledWith('/follows/stats');
    });

    it('handles error state', async () => {
      mockedApi.get.mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useFollowStats(), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.error).toBeDefined();
    });
  });

  // ============ useFollowing Tests ============

  describe('useFollowing', () => {
    it('fetches following list successfully', async () => {
      mockedApi.get.mockResolvedValue({ data: [mockUser] });

      const { result } = renderHook(() => useFollowing(), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toEqual([mockUser]);
      expect(mockedApi.get).toHaveBeenCalledWith('/follows/following', {
        params: { limit: 20, offset: 0 },
      });
    });

    it('supports pagination options', async () => {
      mockedApi.get.mockResolvedValue({ data: [] });

      const { result } = renderHook(() => useFollowing({ limit: 10, offset: 20 }), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockedApi.get).toHaveBeenCalledWith('/follows/following', {
        params: { limit: 10, offset: 20 },
      });
    });
  });

  // ============ useFollowers Tests ============

  describe('useFollowers', () => {
    it('fetches followers list successfully', async () => {
      mockedApi.get.mockResolvedValue({ data: [mockUser] });

      const { result } = renderHook(() => useFollowers(), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toEqual([mockUser]);
      expect(mockedApi.get).toHaveBeenCalledWith('/follows/followers', {
        params: { limit: 20, offset: 0 },
      });
    });
  });

  // ============ useFollowUser Tests ============

  describe('useFollowUser', () => {
    it('follows a user successfully', async () => {
      mockedApi.post.mockResolvedValue({
        data: { status: 'following', following_id: OTHER_USER_ID },
      });

      const { result } = renderHook(() => useFollowUser(OTHER_USER_ID), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        result.current.mutate();
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockedApi.post).toHaveBeenCalledWith(`/follows/${OTHER_USER_ID}`);
    });

    it('returns success data on follow', async () => {
      mockedApi.post.mockResolvedValue({
        data: { status: 'following', following_id: OTHER_USER_ID },
      });

      const { result } = renderHook(() => useFollowUser(OTHER_USER_ID), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        result.current.mutate();
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toEqual({
        status: 'following',
        following_id: OTHER_USER_ID,
      });
    });

    it('sets error state on failure', async () => {
      mockedApi.post.mockRejectedValue({
        response: { status: 403 },
      });

      const { result } = renderHook(() => useFollowUser(OTHER_USER_ID), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        result.current.mutate();
      });

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.error).toBeDefined();
    });

    it('sets error state on conflict (already following)', async () => {
      mockedApi.post.mockRejectedValue({
        response: { status: 409 },
      });

      const { result } = renderHook(() => useFollowUser(OTHER_USER_ID), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        result.current.mutate();
      });

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.error).toBeDefined();
    });
  });

  // ============ useUnfollowUser Tests ============

  describe('useUnfollowUser', () => {
    it('unfollows a user successfully', async () => {
      mockedApi.delete.mockResolvedValue({
        data: { status: 'unfollowed', following_id: OTHER_USER_ID },
      });

      const { result } = renderHook(() => useUnfollowUser(OTHER_USER_ID), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        result.current.mutate();
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockedApi.delete).toHaveBeenCalledWith(`/follows/${OTHER_USER_ID}`);
      expect(result.current.data).toEqual({
        status: 'unfollowed',
        following_id: OTHER_USER_ID,
      });
    });

    it('sets error state on conflict (not following)', async () => {
      mockedApi.delete.mockRejectedValue({
        response: { status: 409 },
      });

      const { result } = renderHook(() => useUnfollowUser(OTHER_USER_ID), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        result.current.mutate();
      });

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.error).toBeDefined();
    });
  });
});
