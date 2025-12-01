/**
 * React Query hooks for shareable lists API.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@services/api';

// Types
export interface ListEntry {
  id: string;
  entry_id: string;
  position: number;
  created_at: string;
}

export interface ListSummary {
  id: string;
  trip_id: string;
  owner_id: string;
  name: string;
  slug: string;
  description: string | null;
  is_public: boolean;
  entry_count: number;
  created_at: string;
  updated_at: string;
}

export interface ListDetail extends Omit<ListSummary, 'entry_count'> {
  entries: ListEntry[];
}

export interface CreateListInput {
  name: string;
  description?: string;
  is_public?: boolean;
  entry_ids?: string[];
}

export interface UpdateListInput {
  name?: string;
  description?: string;
  is_public?: boolean;
}

// Query keys
const LISTS_QUERY_KEY = ['lists'];

function getListsQueryKey(tripId: string) {
  return [...LISTS_QUERY_KEY, 'trip', tripId];
}

function getListQueryKey(listId: string) {
  return [...LISTS_QUERY_KEY, listId];
}

/**
 * Get all lists for a trip
 */
export function useTripLists(tripId: string) {
  return useQuery({
    queryKey: getListsQueryKey(tripId),
    queryFn: async (): Promise<ListSummary[]> => {
      const response = await api.get(`/trips/${tripId}/lists`);
      return response.data;
    },
    enabled: !!tripId,
  });
}

/**
 * Get list details
 */
export function useList(listId: string) {
  return useQuery({
    queryKey: getListQueryKey(listId),
    queryFn: async (): Promise<ListDetail> => {
      const response = await api.get(`/lists/${listId}`);
      return response.data;
    },
    enabled: !!listId,
  });
}

/**
 * Create a new list
 */
export function useCreateList() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      tripId,
      data,
    }: {
      tripId: string;
      data: CreateListInput;
    }): Promise<ListDetail> => {
      const response = await api.post(`/trips/${tripId}/lists`, data);
      return response.data;
    },
    onSuccess: (data, variables) => {
      // Invalidate trip lists
      queryClient.invalidateQueries({ queryKey: getListsQueryKey(variables.tripId) });
      // Cache the new list
      queryClient.setQueryData(getListQueryKey(data.id), data);
    },
  });
}

/**
 * Update a list
 */
export function useUpdateList() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      listId,
      data,
    }: {
      listId: string;
      data: UpdateListInput;
    }): Promise<ListDetail> => {
      const response = await api.patch(`/lists/${listId}`, data);
      return response.data;
    },
    onSuccess: (data) => {
      // Update the list cache
      queryClient.setQueryData(getListQueryKey(data.id), data);
      // Update list summary in trip lists cache with computed entry count
      queryClient.setQueryData(getListsQueryKey(data.trip_id), (old: ListSummary[] | undefined) => {
        if (!old) return old;
        return old.map((list) =>
          list.id === data.id ? { ...list, entry_count: data.entries.length } : list
        );
      });
    },
  });
}

/**
 * Update entries in a list
 */
export function useUpdateListEntries() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      listId,
      entryIds,
    }: {
      listId: string;
      entryIds: string[];
    }): Promise<ListDetail> => {
      const response = await api.put(`/lists/${listId}/entries`, { entry_ids: entryIds });
      return response.data;
    },
    onSuccess: (data) => {
      // Update the list cache
      queryClient.setQueryData(getListQueryKey(data.id), data);
      // Invalidate trip lists to update entry count
      queryClient.invalidateQueries({ queryKey: getListsQueryKey(data.trip_id) });
    },
  });
}

/**
 * Delete a list
 */
export function useDeleteList() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ listId }: { listId: string; tripId: string }): Promise<void> => {
      await api.delete(`/lists/${listId}`);
    },
    onSuccess: (_, variables) => {
      // Remove from cache
      queryClient.removeQueries({ queryKey: getListQueryKey(variables.listId) });
      // Invalidate trip lists
      queryClient.invalidateQueries({ queryKey: getListsQueryKey(variables.tripId) });
    },
  });
}

/**
 * Get public share URL for a list
 */
export function getPublicListUrl(slug: string): string {
  const baseUrl = process.env.EXPO_PUBLIC_WEB_URL ?? 'https://borderbadge.app';
  return `${baseUrl}/public/lists/${slug}`;
}
