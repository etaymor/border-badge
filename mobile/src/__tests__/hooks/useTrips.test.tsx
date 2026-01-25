/**
 * Tests for trip-related hooks including uncategorized trips and entry movement.
 *
 * Covers:
 * - useUncategorizedTrip: fetching the Saved Places trip
 * - useMoveEntry: moving a single entry to a different trip
 * - useBulkMoveEntries: moving multiple entries to a trip
 */

import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import {
  useUncategorizedTrip,
  useMoveEntry,
  useBulkMoveEntries,
  UncategorizedTrip,
} from '@hooks/useTrips';
import { api } from '@services/api';
import { createTestQueryClient } from '../utils/testUtils';

// Type the mocks
const mockedApi = api as jest.Mocked<typeof api>;

// Create wrapper for hooks
function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

// Sample test data
const mockUncategorizedTrip: UncategorizedTrip = {
  id: 'uncategorized-trip-id',
  user_id: 'user-123',
  name: 'Saved Places',
  is_system: true,
  entry_count: 5,
  created_at: '2024-01-01T00:00:00Z',
};

const mockEntry = {
  id: 'entry-123',
  trip_id: 'trip-456',
  type: 'place',
  title: 'Central Park',
  notes: null,
  created_at: '2024-01-01T00:00:00Z',
  place: {
    id: 'place-123',
    place_name: 'Central Park',
    lat: 40.7829,
    lng: -73.9654,
  },
};

describe('useTrips hooks', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
    jest.clearAllMocks();
  });

  // ============ useUncategorizedTrip Tests ============

  describe('useUncategorizedTrip', () => {
    it('fetches uncategorized trip from /trips/uncategorized', async () => {
      mockedApi.get.mockResolvedValueOnce({ data: mockUncategorizedTrip });

      const { result } = renderHook(() => useUncategorizedTrip(), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockedApi.get).toHaveBeenCalledWith('/trips/uncategorized');
      expect(result.current.data).toEqual(mockUncategorizedTrip);
    });

    it('returns entry_count in response', async () => {
      const tripWith10Entries = { ...mockUncategorizedTrip, entry_count: 10 };
      mockedApi.get.mockResolvedValueOnce({ data: tripWith10Entries });

      const { result } = renderHook(() => useUncategorizedTrip(), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data?.entry_count).toBe(10);
    });

    it('returns is_system=true for uncategorized trip', async () => {
      mockedApi.get.mockResolvedValueOnce({ data: mockUncategorizedTrip });

      const { result } = renderHook(() => useUncategorizedTrip(), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data?.is_system).toBe(true);
    });

    it('handles error state', async () => {
      const error = new Error('Network error');
      mockedApi.get.mockRejectedValueOnce(error);

      const { result } = renderHook(() => useUncategorizedTrip(), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error).toBeDefined();
    });
  });

  // ============ useMoveEntry Tests ============

  describe('useMoveEntry', () => {
    it('calls PATCH /entries/{id}/move with trip_id', async () => {
      const movedEntry = { ...mockEntry, trip_id: 'new-trip-id' };
      mockedApi.patch.mockResolvedValueOnce({ data: movedEntry });

      const { result } = renderHook(() => useMoveEntry(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.mutateAsync({
          entryId: 'entry-123',
          tripId: 'new-trip-id',
        });
      });

      expect(mockedApi.patch).toHaveBeenCalledWith('/entries/entry-123/move', {
        trip_id: 'new-trip-id',
      });
    });

    it('invalidates uncategorized trip query on success', async () => {
      const movedEntry = { ...mockEntry, trip_id: 'new-trip-id' };
      mockedApi.patch.mockResolvedValueOnce({ data: movedEntry });

      const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');

      const { result } = renderHook(() => useMoveEntry(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.mutateAsync({
          entryId: 'entry-123',
          tripId: 'new-trip-id',
        });
      });

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['trips', 'uncategorized'],
      });
    });

    it('invalidates target trip entries query on success (scoped invalidation)', async () => {
      const movedEntry = { ...mockEntry, trip_id: 'new-trip-id' };
      mockedApi.patch.mockResolvedValueOnce({ data: movedEntry });

      const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');

      const { result } = renderHook(() => useMoveEntry(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.mutateAsync({
          entryId: 'entry-123',
          tripId: 'new-trip-id',
        });
      });

      // Scoped invalidation: only target trip entries are invalidated
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['entries', 'new-trip-id'],
      });
    });

    it('handles error and shows alert', async () => {
      const error = new Error('Failed to move entry');
      mockedApi.patch.mockRejectedValueOnce(error);

      const { result } = renderHook(() => useMoveEntry(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        try {
          await result.current.mutateAsync({
            entryId: 'entry-123',
            tripId: 'new-trip-id',
          });
        } catch {
          // Expected error
        }
      });

      await waitFor(() => expect(result.current.isError).toBe(true));
      // Alert is called via onError callback
      expect(global.__mockAlert.alert).toHaveBeenCalledWith('Error', 'Failed to move entry');
    });
  });

  // ============ useBulkMoveEntries Tests ============

  describe('useBulkMoveEntries', () => {
    it('calls POST /entries/bulk-move with entry_ids and target_trip_id', async () => {
      const bulkMoveResult = {
        moved_count: 2,
        entries: [
          { ...mockEntry, id: 'entry-1', trip_id: 'target-trip-id' },
          { ...mockEntry, id: 'entry-2', trip_id: 'target-trip-id' },
        ],
      };
      mockedApi.post.mockResolvedValueOnce({ data: bulkMoveResult });

      const { result } = renderHook(() => useBulkMoveEntries(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.mutateAsync({
          entryIds: ['entry-1', 'entry-2'],
          targetTripId: 'target-trip-id',
        });
      });

      expect(mockedApi.post).toHaveBeenCalledWith('/entries/bulk-move', {
        entry_ids: ['entry-1', 'entry-2'],
        target_trip_id: 'target-trip-id',
      });
    });

    it('returns moved_count in response', async () => {
      const bulkMoveResult = {
        moved_count: 3,
        entries: [],
      };
      mockedApi.post.mockResolvedValueOnce({ data: bulkMoveResult });

      const { result } = renderHook(() => useBulkMoveEntries(), {
        wrapper: createWrapper(queryClient),
      });

      let response: { moved_count: number; entries: unknown[] } | undefined;
      await act(async () => {
        response = await result.current.mutateAsync({
          entryIds: ['entry-1', 'entry-2', 'entry-3'],
          targetTripId: 'target-trip-id',
        });
      });

      expect(response?.moved_count).toBe(3);
    });

    it('invalidates uncategorized trip query on success', async () => {
      const bulkMoveResult = { moved_count: 1, entries: [] };
      mockedApi.post.mockResolvedValueOnce({ data: bulkMoveResult });

      const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');

      const { result } = renderHook(() => useBulkMoveEntries(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.mutateAsync({
          entryIds: ['entry-1'],
          targetTripId: 'target-trip-id',
        });
      });

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['trips', 'uncategorized'],
      });
    });

    it('invalidates target trip entries query on success (scoped invalidation)', async () => {
      const bulkMoveResult = { moved_count: 1, entries: [] };
      mockedApi.post.mockResolvedValueOnce({ data: bulkMoveResult });

      const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');

      const { result } = renderHook(() => useBulkMoveEntries(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.mutateAsync({
          entryIds: ['entry-1'],
          targetTripId: 'target-trip-id',
        });
      });

      // Scoped invalidation: only target trip entries are invalidated
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['entries', 'target-trip-id'],
      });
    });

    it('handles error and shows alert', async () => {
      const error = new Error('Failed to move entries');
      mockedApi.post.mockRejectedValueOnce(error);

      const { result } = renderHook(() => useBulkMoveEntries(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        try {
          await result.current.mutateAsync({
            entryIds: ['entry-1', 'entry-2'],
            targetTripId: 'target-trip-id',
          });
        } catch {
          // Expected error
        }
      });

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(global.__mockAlert.alert).toHaveBeenCalledWith('Error', 'Failed to move entries');
    });
  });
});
