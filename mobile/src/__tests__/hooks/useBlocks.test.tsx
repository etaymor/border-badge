/**
 * Tests for useBlocks hooks.
 *
 * Covers:
 * - useBlockedUsers: fetching list of blocked users
 * - useBlockUser: blocking a user
 * - useUnblockUser: unblocking a user
 */

import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  persistQueryClientSave,
  persistQueryClientRestore,
} from '@tanstack/react-query-persist-client';
import type { PersistedClient, Persister } from '@tanstack/react-query-persist-client';

import { useBlockedUsers, useBlockUser, useUnblockUser } from '@hooks/useBlocks';
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

// Note: Alert.alert is mocked in jest.setup.js

// Test data
const mockBlockedUser = {
  id: 'block-1',
  user_id: 'user-1',
  username: 'blockeduser',
  avatar_url: null,
};
const OTHER_USER_ID = 'other-user-123';
const OTHER_USERNAME = 'blockeduser';

// Cache keys as literals so key regressions are caught here.
const SOCIAL_HOME_PAGE_KEY = ['social-home', { limit: 20 }];
const USER_FEED_KEY = ['user-feed', OTHER_USER_ID, { limit: 20 }];
const PROFILE_KEY = ['user', OTHER_USERNAME, 'profile'];
const SEARCH_KEY = ['users', 'search', 'blocked', 10];
const CONTROL_KEY = ['trips'];

function seedBlockedUserContent(client: QueryClient) {
  client.setQueryData(SOCIAL_HOME_PAGE_KEY, {
    pages: [
      {
        feed: {
          items: [
            {
              activity_id: 'activity-1',
              activity_type: 'country_visited',
              created_at: '2024-01-01T00:00:00Z',
              user: { user_id: OTHER_USER_ID, username: OTHER_USERNAME, avatar_url: null },
              country: { country_id: 'c1', country_name: 'Japan', country_code: 'JP' },
              entry: null,
            },
          ],
          next_cursor: null,
          has_more: false,
        },
        follow_stats: { follower_count: 1, following_count: 1 },
        friends_ranking: {
          rank: 1,
          total_friends: 1,
          my_countries: 1,
          leader_username: null,
          leader_countries: null,
        },
        pending_tag_count: 0,
      },
    ],
    pageParams: [null],
  });
  client.setQueryData(USER_FEED_KEY, {
    pages: [{ items: [], next_cursor: null, has_more: false }],
    pageParams: [null],
  });
  client.setQueryData(PROFILE_KEY, {
    id: 'profile-1',
    user_id: OTHER_USER_ID,
    username: OTHER_USERNAME,
    display_name: 'Blocked User',
    avatar_url: null,
    country_count: 1,
    follower_count: 1,
    following_count: 1,
    is_following: true,
    is_blocked: false,
  });
  client.setQueryData(SEARCH_KEY, [
    {
      id: OTHER_USER_ID,
      username: OTHER_USERNAME,
      avatar_url: null,
      country_count: 1,
      is_following: true,
    },
  ]);
  client.setQueryData(CONTROL_KEY, [{ id: 'trip-1' }]);
}

function createInMemoryPersister(): Persister {
  let stored: PersistedClient | undefined;
  return {
    persistClient: async (client: PersistedClient) => {
      stored = client;
    },
    restoreClient: async () => stored,
    removeClient: async () => {
      stored = undefined;
    },
  };
}

// Create wrapper for hooks
function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

/**
 * Client with a realistic gcTime so seeded (unobserved) caches survive long
 * enough to be read back - createTestQueryClient's gcTime of 0 would
 * garbage-collect them immediately.
 */
function createSeededQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 1000 * 60 * 30, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

describe('useBlocks', () => {
  let queryClient: QueryClient;
  const mockedApi = api as jest.Mocked<typeof api>;

  beforeEach(() => {
    queryClient = createTestQueryClient();
    jest.clearAllMocks();
  });

  // ============ useBlockedUsers Tests ============

  describe('useBlockedUsers', () => {
    it('fetches blocked users successfully', async () => {
      mockedApi.get.mockResolvedValue({ data: [mockBlockedUser] });

      const { result } = renderHook(() => useBlockedUsers(), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toEqual([mockBlockedUser]);
      expect(mockedApi.get).toHaveBeenCalledWith('/blocks', {
        params: { limit: 50, offset: 0 },
      });
    });

    it('supports custom pagination options', async () => {
      mockedApi.get.mockResolvedValue({ data: [] });

      const { result } = renderHook(() => useBlockedUsers({ limit: 10, offset: 5 }), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockedApi.get).toHaveBeenCalledWith('/blocks', {
        params: { limit: 10, offset: 5 },
      });
    });

    it('returns empty array when no blocked users', async () => {
      mockedApi.get.mockResolvedValue({ data: [] });

      const { result } = renderHook(() => useBlockedUsers(), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toEqual([]);
    });

    it('handles error state', async () => {
      mockedApi.get.mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useBlockedUsers(), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.error).toBeDefined();
    });
  });

  // ============ useBlockUser Tests ============

  describe('useBlockUser', () => {
    it('blocks a user successfully', async () => {
      mockedApi.post.mockResolvedValue({
        data: { status: 'blocked', blocked_id: OTHER_USER_ID },
      });

      const { result } = renderHook(() => useBlockUser(OTHER_USER_ID), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        result.current.mutate();
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockedApi.post).toHaveBeenCalledWith(`/blocks/${OTHER_USER_ID}`);
      expect(result.current.data).toEqual({
        status: 'blocked',
        blocked_id: OTHER_USER_ID,
      });
    });

    it('sets error state on 403 forbidden', async () => {
      mockedApi.post.mockRejectedValue({
        response: { status: 403 },
      });

      const { result } = renderHook(() => useBlockUser(OTHER_USER_ID), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        result.current.mutate();
      });

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.error).toBeDefined();
    });

    it('purges the blocked user content from every visible cache', async () => {
      queryClient = createSeededQueryClient();
      seedBlockedUserContent(queryClient);
      mockedApi.post.mockResolvedValue({
        data: { status: 'blocked', blocked_id: OTHER_USER_ID },
      });

      const { result } = renderHook(() => useBlockUser(OTHER_USER_ID, OTHER_USERNAME), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        result.current.mutate();
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(queryClient.getQueryData(SOCIAL_HOME_PAGE_KEY)).toBeUndefined();
      expect(queryClient.getQueryData(USER_FEED_KEY)).toBeUndefined();
      expect(queryClient.getQueryData(PROFILE_KEY)).toBeUndefined();
      expect(queryClient.getQueryData(SEARCH_KEY)).toBeUndefined();
      // Unrelated caches are untouched.
      expect(queryClient.getQueryData(CONTROL_KEY)).toEqual([{ id: 'trip-1' }]);
    });

    it('does not resurrect blocked content from a persisted cache', async () => {
      // Client with realistic gcTime so queries survive dehydration.
      const persistedClient = new QueryClient({
        defaultOptions: {
          queries: { retry: false, gcTime: 1000 * 60 * 30 },
          mutations: { retry: false },
        },
      });
      seedBlockedUserContent(persistedClient);
      mockedApi.post.mockResolvedValue({
        data: { status: 'blocked', blocked_id: OTHER_USER_ID },
      });

      const { result } = renderHook(() => useBlockUser(OTHER_USER_ID, OTHER_USERNAME), {
        wrapper: createWrapper(persistedClient),
      });

      await act(async () => {
        result.current.mutate();
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      // Simulate the AsyncStorage persistence cycle: save, then cold-start restore.
      const persister = createInMemoryPersister();
      await persistQueryClientSave({ queryClient: persistedClient, persister });

      const rehydratedClient = new QueryClient({
        defaultOptions: {
          queries: { retry: false, gcTime: 1000 * 60 * 30 },
          mutations: { retry: false },
        },
      });
      await persistQueryClientRestore({ queryClient: rehydratedClient, persister });

      expect(rehydratedClient.getQueryData(SOCIAL_HOME_PAGE_KEY)).toBeUndefined();
      expect(rehydratedClient.getQueryData(USER_FEED_KEY)).toBeUndefined();
      expect(rehydratedClient.getQueryData(PROFILE_KEY)).toBeUndefined();
      // Non-social data survives the round trip.
      expect(rehydratedClient.getQueryData(CONTROL_KEY)).toEqual([{ id: 'trip-1' }]);

      persistedClient.clear();
      rehydratedClient.clear();
    });

    it('sets error state on 409 conflict (already blocked)', async () => {
      mockedApi.post.mockRejectedValue({
        response: { status: 409 },
      });

      const { result } = renderHook(() => useBlockUser(OTHER_USER_ID), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        result.current.mutate();
      });

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.error).toBeDefined();
    });
  });

  // ============ useUnblockUser Tests ============

  describe('useUnblockUser', () => {
    it('unblocks a user successfully', async () => {
      mockedApi.delete.mockResolvedValue({
        data: { status: 'unblocked', blocked_id: OTHER_USER_ID },
      });

      const { result } = renderHook(() => useUnblockUser(OTHER_USER_ID), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        result.current.mutate();
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockedApi.delete).toHaveBeenCalledWith(`/blocks/${OTHER_USER_ID}`);
      expect(result.current.data).toEqual({
        status: 'unblocked',
        blocked_id: OTHER_USER_ID,
      });
    });

    it('sets error state on 409 conflict (not blocked)', async () => {
      mockedApi.delete.mockRejectedValue({
        response: { status: 409 },
      });

      const { result } = renderHook(() => useUnblockUser(OTHER_USER_ID), {
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
