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

// Create wrapper for hooks
function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
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
