/**
 * Tests for useFollows hooks.
 *
 * Covers:
 * - useFollowing: infinite offset-paged list of followed users
 * - useFollowers: infinite offset-paged list of followers (no 20-item cap)
 * - useFollowUser: following a user with surgical optimistic cache updates
 * - useUnfollowUser: unfollowing a user with surgical optimistic cache updates
 */

import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Alert } from 'react-native';

import {
  useFollowing,
  useFollowers,
  useFollowUser,
  useUnfollowUser,
  getFollowListUsers,
} from '@hooks/useFollows';
import type { SocialHomeInfiniteData } from '@hooks/useSocialHome';
import type { UserProfile } from '@hooks/useUserProfile';
import type { UserSearchResult } from '@hooks/useUserSearch';
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

// Test data
const mockUser = {
  id: 'user-1',
  user_id: 'user-1',
  username: 'testuser',
  display_name: 'Test User',
  avatar_url: null,
  country_count: 3,
};
const OTHER_USER_ID = 'other-user-123';
const OTHER_USERNAME = 'testuser';

// Cache keys as literals so key regressions are caught here.
const PROFILE_KEY = ['user', OTHER_USERNAME, 'profile'];
const SOCIAL_HOME_PAGE_KEY = ['social-home', { limit: 20 }];
const SEARCH_KEY = ['users', 'search', 'test', 10];

function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id: 'profile-1',
    user_id: OTHER_USER_ID,
    username: OTHER_USERNAME,
    display_name: 'Test User',
    avatar_url: null,
    country_count: 3,
    follower_count: 10,
    following_count: 4,
    is_following: false,
    is_blocked: false,
    ...overrides,
  };
}

function makeSocialHome(followingCount: number): SocialHomeInfiniteData {
  const ranking = {
    rank: 1,
    total_friends: 3,
    my_countries: 12,
    leader_username: null,
    leader_countries: null,
  };
  return {
    pages: [
      {
        feed: { items: [], next_cursor: 'cursor-1', has_more: true },
        follow_stats: { follower_count: 2, following_count: followingCount },
        friends_ranking: ranking,
        pending_tag_count: 1,
      },
      {
        feed: { items: [], next_cursor: null, has_more: false },
        follow_stats: { follower_count: 2, following_count: followingCount },
        friends_ranking: ranking,
        pending_tag_count: 1,
      },
    ],
    pageParams: [null, 'cursor-1'],
  };
}

function makeSearchResults(isFollowing: boolean): UserSearchResult[] {
  return [
    {
      id: OTHER_USER_ID,
      username: OTHER_USERNAME,
      avatar_url: null,
      country_count: 3,
      is_following: isFollowing,
    },
    {
      id: 'unrelated-user',
      username: 'someone_else',
      avatar_url: null,
      country_count: 1,
      is_following: false,
    },
  ];
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

describe('useFollows', () => {
  let queryClient: QueryClient;
  const mockedApi = api as jest.Mocked<typeof api>;

  beforeEach(() => {
    queryClient = createTestQueryClient();
    jest.clearAllMocks();
  });

  // ============ useFollowing Tests ============

  describe('useFollowing', () => {
    it('fetches the first page and flattens it', async () => {
      mockedApi.get.mockResolvedValue({ data: [mockUser] });

      const { result } = renderHook(() => useFollowing(), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(getFollowListUsers(result.current.data)).toEqual([mockUser]);
      expect(mockedApi.get).toHaveBeenCalledWith('/follows/following', {
        params: { limit: 20, offset: 0 },
      });
      // A short page (< limit) means there is nothing more to load.
      expect(result.current.hasNextPage).toBe(false);
    });

    it('supports a custom page size', async () => {
      mockedApi.get.mockResolvedValue({ data: [] });

      const { result } = renderHook(() => useFollowing({ limit: 10 }), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockedApi.get).toHaveBeenCalledWith('/follows/following', {
        params: { limit: 10, offset: 0 },
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

      expect(getFollowListUsers(result.current.data)).toEqual([mockUser]);
      expect(mockedApi.get).toHaveBeenCalledWith('/follows/followers', {
        params: { limit: 20, offset: 0 },
      });
    });

    it('pages through all 45 followers in pages of 20 with no cap', async () => {
      const makeFollower = (i: number) => ({
        ...mockUser,
        id: `follower-${i}`,
        user_id: `follower-${i}`,
        username: `traveler_${i}`,
      });
      const allFollowers = Array.from({ length: 45 }, (_, i) => makeFollower(i));

      mockedApi.get.mockImplementation((_url, config) => {
        const { limit, offset } = (config as { params: { limit: number; offset: number } }).params;
        return Promise.resolve({ data: allFollowers.slice(offset, offset + limit) });
      });

      const { result } = renderHook(() => useFollowers(), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(getFollowListUsers(result.current.data)).toHaveLength(20);
      expect(result.current.hasNextPage).toBe(true);

      await act(async () => {
        await result.current.fetchNextPage();
      });
      await waitFor(() => expect(getFollowListUsers(result.current.data)).toHaveLength(40));
      expect(result.current.hasNextPage).toBe(true);

      await act(async () => {
        await result.current.fetchNextPage();
      });
      await waitFor(() => expect(getFollowListUsers(result.current.data)).toHaveLength(45));

      // The final short page (5 < 20) ends pagination.
      expect(result.current.hasNextPage).toBe(false);

      // Pages were requested at offsets 0, 20, 40.
      const offsets = mockedApi.get.mock.calls.map(
        ([, config]) => (config as { params: { offset: number } }).params.offset
      );
      expect(offsets).toEqual([0, 20, 40]);

      // Every follower arrived exactly once, in order.
      const usernames = getFollowListUsers(result.current.data).map((u) => u.username);
      expect(usernames).toEqual(allFollowers.map((u) => u.username));
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
      expect(result.current.data).toEqual({
        status: 'following',
        following_id: OTHER_USER_ID,
      });
    });

    it('optimistically updates profile, social-home stats, and search caches before the request resolves', async () => {
      queryClient = createSeededQueryClient();
      queryClient.setQueryData(PROFILE_KEY, makeProfile());
      queryClient.setQueryData(SOCIAL_HOME_PAGE_KEY, makeSocialHome(5));
      queryClient.setQueryData(SEARCH_KEY, makeSearchResults(false));

      let resolvePost: (value: unknown) => void = () => {};
      mockedApi.post.mockReturnValue(
        new Promise((resolve) => {
          resolvePost = resolve;
        }) as ReturnType<typeof api.post>
      );

      const { result } = renderHook(() => useFollowUser(OTHER_USER_ID, OTHER_USERNAME), {
        wrapper: createWrapper(queryClient),
      });

      act(() => {
        result.current.mutate();
      });

      // While the request is still in flight, the visible caches are updated.
      await waitFor(() => {
        const profile = queryClient.getQueryData<UserProfile>(PROFILE_KEY);
        expect(profile?.is_following).toBe(true);
      });

      const profile = queryClient.getQueryData<UserProfile>(PROFILE_KEY);
      expect(profile?.follower_count).toBe(11);

      const socialHome = queryClient.getQueryData<SocialHomeInfiniteData>(SOCIAL_HOME_PAGE_KEY);
      expect(socialHome?.pages[0].follow_stats.following_count).toBe(6);
      // Later pages and feed items are untouched.
      expect(socialHome?.pages[1].follow_stats.following_count).toBe(5);
      expect(socialHome?.pages[0].feed).toEqual({
        items: [],
        next_cursor: 'cursor-1',
        has_more: true,
      });

      const search = queryClient.getQueryData<UserSearchResult[]>(SEARCH_KEY);
      expect(search?.[0].is_following).toBe(true);
      expect(search?.[1].is_following).toBe(false);

      await act(async () => {
        resolvePost({ data: { status: 'following', following_id: OTHER_USER_ID } });
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      // No feed refetch was triggered by the mutation.
      expect(mockedApi.get).not.toHaveBeenCalled();
    });

    it('does not invalidate feed or social-home queries on settle', async () => {
      mockedApi.post.mockResolvedValue({
        data: { status: 'following', following_id: OTHER_USER_ID },
      });
      const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');

      const { result } = renderHook(() => useFollowUser(OTHER_USER_ID, OTHER_USERNAME), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        result.current.mutate();
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      const invalidatedRoots = invalidateSpy.mock.calls.map(
        ([filters]) => (filters?.queryKey as unknown[])?.[0]
      );
      expect(invalidatedRoots).not.toContain('feed');
      expect(invalidatedRoots).not.toContain('social-home');
      expect(invalidatedRoots).not.toContain('user');
    });

    it('rolls back all caches and alerts on failure', async () => {
      queryClient = createSeededQueryClient();
      const originalProfile = makeProfile();
      const originalSocialHome = makeSocialHome(5);
      const originalSearch = makeSearchResults(false);
      queryClient.setQueryData(PROFILE_KEY, originalProfile);
      queryClient.setQueryData(SOCIAL_HOME_PAGE_KEY, originalSocialHome);
      queryClient.setQueryData(SEARCH_KEY, originalSearch);

      mockedApi.post.mockRejectedValue({ response: { status: 500 } });

      const { result } = renderHook(() => useFollowUser(OTHER_USER_ID, OTHER_USERNAME), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        result.current.mutate();
      });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(queryClient.getQueryData(PROFILE_KEY)).toEqual(originalProfile);
      expect(queryClient.getQueryData(SOCIAL_HOME_PAGE_KEY)).toEqual(originalSocialHome);
      expect(queryClient.getQueryData(SEARCH_KEY)).toEqual(originalSearch);
      expect(Alert.alert).toHaveBeenCalled();
    });

    it('does not resurrect caches a block purged while the follow was in flight', async () => {
      queryClient = createSeededQueryClient();
      queryClient.setQueryData(PROFILE_KEY, makeProfile());
      queryClient.setQueryData(SOCIAL_HOME_PAGE_KEY, makeSocialHome(5));
      queryClient.setQueryData(SEARCH_KEY, makeSearchResults(false));

      let rejectPost: (reason: unknown) => void = () => {};
      mockedApi.post.mockReturnValue(
        new Promise((_resolve, reject) => {
          rejectPost = reject;
        }) as ReturnType<typeof api.post>
      );

      const { result } = renderHook(() => useFollowUser(OTHER_USER_ID, OTHER_USERNAME), {
        wrapper: createWrapper(queryClient),
      });

      act(() => {
        result.current.mutate();
      });

      // Wait for the optimistic update so the snapshot has been taken.
      await waitFor(() => {
        expect(queryClient.getQueryData<UserProfile>(PROFILE_KEY)?.is_following).toBe(true);
      });

      // A block lands while the follow request is in flight and purges every
      // cache that could show the blocked user (mirrors useBlockUser).
      queryClient.removeQueries({ queryKey: ['social-home'] });
      queryClient.removeQueries({ queryKey: ['users', 'search'] });
      queryClient.removeQueries({ queryKey: PROFILE_KEY });

      await act(async () => {
        rejectPost({ response: { status: 500 } });
      });
      await waitFor(() => expect(result.current.isError).toBe(true));

      // The rollback must not re-create the purged queries from snapshots.
      expect(queryClient.getQueryState(PROFILE_KEY)).toBeUndefined();
      expect(queryClient.getQueryState(SOCIAL_HOME_PAGE_KEY)).toBeUndefined();
      expect(queryClient.getQueryState(SEARCH_KEY)).toBeUndefined();
    });

    it('invalidates instead of restoring profile/user-feed snapshots on a blocked-pair 403', async () => {
      queryClient = createSeededQueryClient();
      const originalSocialHome = makeSocialHome(5);
      const originalSearch = makeSearchResults(false);
      queryClient.setQueryData(PROFILE_KEY, makeProfile());
      queryClient.setQueryData(SOCIAL_HOME_PAGE_KEY, originalSocialHome);
      queryClient.setQueryData(SEARCH_KEY, originalSearch);

      const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');
      mockedApi.post.mockRejectedValue({ response: { status: 403 } });

      const { result } = renderHook(() => useFollowUser(OTHER_USER_ID, OTHER_USERNAME), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        result.current.mutate();
      });
      await waitFor(() => expect(result.current.isError).toBe(true));

      // The profile snapshot is not blindly restored: it is invalidated so
      // the next observer refetches (the block may have purged it).
      const invalidatedKeys = invalidateSpy.mock.calls.map(
        ([filters]) => filters?.queryKey as unknown[]
      );
      expect(invalidatedKeys).toContainEqual(['user', OTHER_USERNAME, 'profile']);
      expect(invalidatedKeys).toContainEqual(['user-feed', OTHER_USER_ID]);

      // Shared caches still roll back normally.
      expect(queryClient.getQueryData(SOCIAL_HOME_PAGE_KEY)).toEqual(originalSocialHome);
      expect(queryClient.getQueryData(SEARCH_KEY)).toEqual(originalSearch);
      expect(Alert.alert).toHaveBeenCalled();
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

    it('optimistically decrements counts and flips follow state', async () => {
      queryClient = createSeededQueryClient();
      queryClient.setQueryData(PROFILE_KEY, makeProfile({ is_following: true }));
      queryClient.setQueryData(SOCIAL_HOME_PAGE_KEY, makeSocialHome(5));
      queryClient.setQueryData(SEARCH_KEY, makeSearchResults(true));

      mockedApi.delete.mockResolvedValue({
        data: { status: 'unfollowed', following_id: OTHER_USER_ID },
      });

      const { result } = renderHook(() => useUnfollowUser(OTHER_USER_ID, OTHER_USERNAME), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        result.current.mutate();
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      const profile = queryClient.getQueryData<UserProfile>(PROFILE_KEY);
      expect(profile?.is_following).toBe(false);
      expect(profile?.follower_count).toBe(9);

      const socialHome = queryClient.getQueryData<SocialHomeInfiniteData>(SOCIAL_HOME_PAGE_KEY);
      expect(socialHome?.pages[0].follow_stats.following_count).toBe(4);

      const search = queryClient.getQueryData<UserSearchResult[]>(SEARCH_KEY);
      expect(search?.[0].is_following).toBe(false);

      expect(mockedApi.get).not.toHaveBeenCalled();
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
