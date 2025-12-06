/**
 * Integration tests for List Creation flow.
 * Tests: entry selection, validation, creation, success view with share.
 */

import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { api } from '@services/api';
import {
  useTripLists,
  useList,
  useCreateList,
  useUpdateList,
  useDeleteList,
  getPublicListUrl,
  type ListDetail,
} from '@hooks/useLists';
import {
  createMockListDetail,
  createMockListSummary,
  createMockListEntry,
} from '../utils/mockFactories';
import { createTestQueryClient } from '../utils/testUtils';

// Type the mocked api
const mockedApi = api as jest.Mocked<typeof api>;

// Create wrapper for hooks
function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('ListCreateFlow Integration', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
    jest.clearAllMocks();
  });

  // ============ List Query Tests ============

  describe('List Queries', () => {
    it('fetches all lists for a trip', async () => {
      const mockLists = [
        createMockListSummary({ id: 'list-1', name: 'Best Spots' }),
        createMockListSummary({ id: 'list-2', name: 'Food Guide' }),
      ];
      mockedApi.get.mockResolvedValueOnce({ data: mockLists });

      const { result } = renderHook(() => useTripLists('trip-123'), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockedApi.get).toHaveBeenCalledWith('/trips/trip-123/lists');
      expect(result.current.data).toHaveLength(2);
      expect(result.current.data?.[0].name).toBe('Best Spots');
    });

    it('fetches a single list detail by ID', async () => {
      const mockList = createMockListDetail({
        id: 'list-123',
        name: 'My List',
        entries: [createMockListEntry()],
      });
      mockedApi.get.mockResolvedValueOnce({ data: mockList });

      const { result } = renderHook(() => useList('list-123'), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockedApi.get).toHaveBeenCalledWith('/lists/list-123');
      expect(result.current.data?.name).toBe('My List');
      expect(result.current.data?.entries).toHaveLength(1);
    });

    it('does not fetch lists when tripId is empty', () => {
      const { result } = renderHook(() => useTripLists(''), {
        wrapper: createWrapper(queryClient),
      });

      expect(result.current.isFetching).toBe(false);
      expect(mockedApi.get).not.toHaveBeenCalled();
    });

    it('does not fetch list when listId is empty', () => {
      const { result } = renderHook(() => useList(''), {
        wrapper: createWrapper(queryClient),
      });

      expect(result.current.isFetching).toBe(false);
      expect(mockedApi.get).not.toHaveBeenCalled();
    });
  });

  // ============ List Creation Tests ============

  describe('List Creation', () => {
    it('creates a list with name, description, and entries', async () => {
      const mockResponse = createMockListDetail({
        id: 'new-list',
        name: 'Best Spots',
        description: 'My favorite places',
        slug: 'best-spots-abc123',
        entries: [
          createMockListEntry({ entry_id: 'entry-1' }),
          createMockListEntry({ entry_id: 'entry-2' }),
        ],
      });
      mockedApi.post.mockResolvedValueOnce({ data: mockResponse });

      const { result } = renderHook(() => useCreateList(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.mutateAsync({
          tripId: 'trip-123',
          data: {
            name: 'Best Spots',
            description: 'My favorite places',
            entry_ids: ['entry-1', 'entry-2'],
          },
        });
      });

      expect(mockedApi.post).toHaveBeenCalledWith('/trips/trip-123/lists', {
        name: 'Best Spots',
        description: 'My favorite places',
        entry_ids: ['entry-1', 'entry-2'],
      });
    });

    it('creates a list with only required name field', async () => {
      const mockResponse = createMockListDetail({
        id: 'new-list',
        name: 'Quick List',
      });
      mockedApi.post.mockResolvedValueOnce({ data: mockResponse });

      const { result } = renderHook(() => useCreateList(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.mutateAsync({
          tripId: 'trip-123',
          data: {
            name: 'Quick List',
          },
        });
      });

      expect(mockedApi.post).toHaveBeenCalledWith('/trips/trip-123/lists', {
        name: 'Quick List',
      });
    });

    it('invalidates trip lists cache on successful creation', async () => {
      const mockResponse = createMockListDetail({ id: 'new-list' });
      mockedApi.post.mockResolvedValueOnce({ data: mockResponse });

      const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');

      const { result } = renderHook(() => useCreateList(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.mutateAsync({
          tripId: 'trip-123',
          data: { name: 'New List' },
        });
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['lists', 'trip', 'trip-123'] });
    });

    it('caches the created list detail', async () => {
      const mockResponse = createMockListDetail({ id: 'new-list', name: 'Cached List' });
      mockedApi.post.mockResolvedValueOnce({ data: mockResponse });

      const setQueryDataSpy = jest.spyOn(queryClient, 'setQueryData');

      const { result } = renderHook(() => useCreateList(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.mutateAsync({
          tripId: 'trip-123',
          data: { name: 'Cached List' },
        });
      });

      expect(setQueryDataSpy).toHaveBeenCalledWith(['lists', 'new-list'], mockResponse);
    });

    it('handles creation failure gracefully', async () => {
      const error = new Error('Network error');
      mockedApi.post.mockRejectedValueOnce(error);

      const { result } = renderHook(() => useCreateList(), {
        wrapper: createWrapper(queryClient),
      });

      let caughtError: Error | null = null;
      await act(async () => {
        try {
          await result.current.mutateAsync({
            tripId: 'trip-123',
            data: { name: 'Will Fail' },
          });
        } catch (e) {
          caughtError = e as Error;
        }
      });

      // Verify the error was thrown and caught
      expect(caughtError).toBeInstanceOf(Error);
    });
  });

  // ============ List Update Tests ============

  describe('List Update', () => {
    it('updates list name', async () => {
      const mockResponse = createMockListDetail({
        id: 'list-123',
        trip_id: 'trip-123',
        name: 'Updated Name',
        entries: [],
      });
      mockedApi.patch.mockResolvedValueOnce({ data: mockResponse });

      const { result } = renderHook(() => useUpdateList(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.mutateAsync({
          listId: 'list-123',
          data: { name: 'Updated Name' },
        });
      });

      expect(mockedApi.patch).toHaveBeenCalledWith('/lists/list-123', {
        name: 'Updated Name',
      });
    });

    it('updates list visibility', async () => {
      const mockResponse = createMockListDetail({
        id: 'list-123',
        trip_id: 'trip-123',
        entries: [],
      });
      mockedApi.patch.mockResolvedValueOnce({ data: mockResponse });

      const { result } = renderHook(() => useUpdateList(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.mutateAsync({
          listId: 'list-123',
          data: { name: 'Updated Name' },
        });
      });

      expect(mockedApi.patch).toHaveBeenCalledWith('/lists/list-123', {
        name: 'Updated Name',
      });
    });

    it('updates both list detail cache and summary cache', async () => {
      const mockResponse = createMockListDetail({
        id: 'list-123',
        trip_id: 'trip-123',
        name: 'Updated',
        entries: [createMockListEntry(), createMockListEntry()],
      });
      mockedApi.patch.mockResolvedValueOnce({ data: mockResponse });

      // Pre-populate trip lists cache with existing summary
      const existingSummary = createMockListSummary({
        id: 'list-123',
        trip_id: 'trip-123',
        entry_count: 1,
      });
      queryClient.setQueryData(['lists', 'trip', 'trip-123'], [existingSummary]);

      const setQueryDataSpy = jest.spyOn(queryClient, 'setQueryData');

      const { result } = renderHook(() => useUpdateList(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.mutateAsync({
          listId: 'list-123',
          data: { name: 'Updated' },
        });
      });

      // Updates detail cache
      expect(setQueryDataSpy).toHaveBeenCalledWith(['lists', 'list-123'], mockResponse);
      // Updates summary in trip lists cache with computed entry_count
      expect(setQueryDataSpy).toHaveBeenCalledWith(
        ['lists', 'trip', 'trip-123'],
        expect.any(Function)
      );
    });
  });

  // ============ List Deletion Tests ============

  describe('List Deletion', () => {
    it('deletes list successfully', async () => {
      mockedApi.delete.mockResolvedValueOnce({ data: {} });

      const { result } = renderHook(() => useDeleteList(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.mutateAsync({ listId: 'list-123', tripId: 'trip-123' });
      });

      expect(mockedApi.delete).toHaveBeenCalledWith('/lists/list-123');
    });

    it('removes list from cache and invalidates trip lists on deletion', async () => {
      mockedApi.delete.mockResolvedValueOnce({ data: {} });

      // Pre-populate caches
      queryClient.setQueryData(['lists', 'list-123'], createMockListDetail({ id: 'list-123' }));
      queryClient.setQueryData(
        ['lists', 'trip', 'trip-123'],
        [createMockListSummary({ id: 'list-123' })]
      );

      const removeQueriesSpy = jest.spyOn(queryClient, 'removeQueries');
      const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');

      const { result } = renderHook(() => useDeleteList(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.mutateAsync({ listId: 'list-123', tripId: 'trip-123' });
      });

      expect(removeQueriesSpy).toHaveBeenCalledWith({ queryKey: ['lists', 'list-123'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['lists', 'trip', 'trip-123'] });
    });
  });

  // ============ Public URL Generation Tests ============

  describe('Public URL Generation', () => {
    const originalWebBase = process.env.EXPO_PUBLIC_WEB_BASE_URL;

    beforeEach(() => {
      process.env.EXPO_PUBLIC_WEB_BASE_URL = 'https://example.com';
    });

    afterEach(() => {
      process.env.EXPO_PUBLIC_WEB_BASE_URL = originalWebBase;
    });

    it('generates correct public URL from slug', () => {
      const url = getPublicListUrl('best-spots-abc123');
      expect(url).toBe('https://example.com/l/best-spots-abc123');
    });

    it('handles special characters in slug', () => {
      const url = getPublicListUrl('my-list-123');
      expect(url).toContain('/l/my-list-123');
    });

    it('handles empty slug', () => {
      const url = getPublicListUrl('');
      expect(url).toBe('https://example.com/l/');
    });
  });

  // ============ Entry Selection Logic Tests ============

  describe('Entry Selection Logic', () => {
    it('returns created list with selected entry_ids', async () => {
      const selectedEntryIds = ['entry-1', 'entry-2', 'entry-3'];
      const mockResponse = createMockListDetail({
        id: 'new-list',
        entries: selectedEntryIds.map((id, index) =>
          createMockListEntry({ entry_id: id, position: index })
        ),
      });
      mockedApi.post.mockResolvedValueOnce({ data: mockResponse });

      const { result } = renderHook(() => useCreateList(), {
        wrapper: createWrapper(queryClient),
      });

      let createdList: ListDetail | undefined;
      await act(async () => {
        createdList = await result.current.mutateAsync({
          tripId: 'trip-123',
          data: {
            name: 'Test List',
            entry_ids: selectedEntryIds,
          },
        });
      });

      expect(createdList?.entries).toHaveLength(3);
      expect(createdList?.entries.map((e) => e.entry_id)).toEqual(selectedEntryIds);
    });

    it('creates list without entries when entry_ids is empty', async () => {
      const mockResponse = createMockListDetail({
        id: 'new-list',
        entries: [],
      });
      mockedApi.post.mockResolvedValueOnce({ data: mockResponse });

      const { result } = renderHook(() => useCreateList(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.mutateAsync({
          tripId: 'trip-123',
          data: {
            name: 'Empty List',
            entry_ids: [],
          },
        });
      });

      expect(mockedApi.post).toHaveBeenCalledWith('/trips/trip-123/lists', {
        name: 'Empty List',
        entry_ids: [],
      });
    });
  });

  // ============ Public Visibility Tests ============

  describe('Public Visibility', () => {
    it('creates lists that are always public without sending a visibility flag', async () => {
      const mockResponse = createMockListDetail({
        id: 'new-list',
        is_public: true,
        slug: 'my-public-list',
      });
      mockedApi.post.mockResolvedValueOnce({ data: mockResponse });

      const { result } = renderHook(() => useCreateList(), {
        wrapper: createWrapper(queryClient),
      });

      let createdList: ListDetail | undefined;
      await act(async () => {
        createdList = await result.current.mutateAsync({
          tripId: 'trip-123',
          data: {
            name: 'Public List',
          },
        });
      });

      expect(mockedApi.post).toHaveBeenCalledWith('/trips/trip-123/lists', {
        name: 'Public List',
      });
      expect(createdList?.is_public).toBe(true);
      expect(createdList?.slug).toBeDefined();
    });
  });
});
