/**
 * Tests for useTripTags hooks.
 *
 * Covers:
 * - usePendingTripTags: fetching pending trip tag invitations
 * - useApproveTripTag: approving a trip tag invitation
 * - useDeclineTripTag: declining a trip tag invitation
 */

import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import {
  usePendingTripTags,
  usePendingTripTagCount,
  useApproveTripTag,
  useDeclineTripTag,
  PendingTripTag,
} from '@hooks/useTripTags';
import { api } from '@services/api';
import { createTestQueryClient } from '../utils/testUtils';

// Mock API
jest.mock('@services/api', () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

// Test data
const mockPendingTag: PendingTripTag = {
  id: 'tag-123',
  trip_id: 'trip-456',
  trip_name: 'Summer Vacation',
  trip_country_code: 'US',
  initiated_by: 'user-789',
  initiated_by_username: 'traveler_jane',
  initiated_by_avatar_url: 'https://example.com/avatar.jpg',
  created_at: '2024-01-01T00:00:00Z',
};

const mockApproveResponse = {
  status: 'approved' as const,
  responded_at: '2024-01-02T00:00:00Z',
};

const mockDeclineResponse = {
  status: 'declined' as const,
  responded_at: '2024-01-02T00:00:00Z',
};

// Create wrapper for hooks
function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useTripTags', () => {
  let queryClient: QueryClient;
  const mockedApi = api as jest.Mocked<typeof api>;

  beforeEach(() => {
    queryClient = createTestQueryClient();
    jest.clearAllMocks();
  });

  // ============ usePendingTripTags Tests ============

  describe('usePendingTripTags', () => {
    it('fetches pending trip tags successfully', async () => {
      mockedApi.get.mockResolvedValue({ data: [mockPendingTag] });

      const { result } = renderHook(() => usePendingTripTags(), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toEqual([mockPendingTag]);
      expect(mockedApi.get).toHaveBeenCalledWith('/trip-tags/pending');
    });

    it('returns empty list when no pending tags', async () => {
      mockedApi.get.mockResolvedValue({ data: [] });

      const { result } = renderHook(() => usePendingTripTags(), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toEqual([]);
    });

    it('handles error state', async () => {
      mockedApi.get.mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => usePendingTripTags(), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.error).toBeDefined();
    });
  });

  // ============ usePendingTripTagCount Tests ============

  describe('usePendingTripTagCount', () => {
    it('fetches pending tag count successfully', async () => {
      mockedApi.get.mockResolvedValue({ data: { count: 3 } });

      const { result } = renderHook(() => usePendingTripTagCount(), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toBe(3);
      expect(mockedApi.get).toHaveBeenCalledWith('/trip-tags/pending/count');
    });

    it('handles error state', async () => {
      mockedApi.get.mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => usePendingTripTagCount(), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.error).toBeDefined();
    });
  });

  // ============ useApproveTripTag Tests ============

  describe('useApproveTripTag', () => {
    it('approves a trip tag successfully', async () => {
      mockedApi.post.mockResolvedValue({ data: mockApproveResponse });

      const { result } = renderHook(() => useApproveTripTag(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        result.current.mutate('trip-456');
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockedApi.post).toHaveBeenCalledWith('/trip-tags/trip-456/approve');
      expect(result.current.data).toEqual(mockApproveResponse);
    });

    it('invalidates pending tags query on success', async () => {
      mockedApi.post.mockResolvedValue({ data: mockApproveResponse });

      const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');

      const { result } = renderHook(() => useApproveTripTag(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        result.current.mutate('trip-456');
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['trip-tags', 'pending'] });
    });

    it('handles error state', async () => {
      mockedApi.post.mockRejectedValue(new Error('Failed to approve'));

      const { result } = renderHook(() => useApproveTripTag(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        result.current.mutate('trip-456');
      });

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.error).toBeDefined();
    });
  });

  // ============ useDeclineTripTag Tests ============

  describe('useDeclineTripTag', () => {
    it('declines a trip tag successfully', async () => {
      mockedApi.post.mockResolvedValue({ data: mockDeclineResponse });

      const { result } = renderHook(() => useDeclineTripTag(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        result.current.mutate('trip-456');
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockedApi.post).toHaveBeenCalledWith('/trip-tags/trip-456/decline');
      expect(result.current.data).toEqual(mockDeclineResponse);
    });

    it('invalidates pending tags query on success', async () => {
      mockedApi.post.mockResolvedValue({ data: mockDeclineResponse });

      const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');

      const { result } = renderHook(() => useDeclineTripTag(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        result.current.mutate('trip-456');
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['trip-tags', 'pending'] });
    });

    it('handles error state', async () => {
      mockedApi.post.mockRejectedValue(new Error('Failed to decline'));

      const { result } = renderHook(() => useDeclineTripTag(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        result.current.mutate('trip-456');
      });

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.error).toBeDefined();
    });
  });
});
