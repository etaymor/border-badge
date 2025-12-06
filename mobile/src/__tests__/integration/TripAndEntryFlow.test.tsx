/**
 * Integration tests for Trip and Entry flows.
 * Tests critical paths: CRUD operations, validation, cache invalidation.
 */

import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { api } from '@services/api';
import { useTrips, useTrip, useCreateTrip, useUpdateTrip, useDeleteTrip } from '@hooks/useTrips';
import {
  useEntries,
  useEntry,
  useCreateEntry,
  useUpdateEntry,
  useDeleteEntry,
} from '@hooks/useEntries';
import {
  createMockTrip,
  createMockTripWithTags,
  createMockPlaceInput,
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

describe('TripAndEntryFlow Integration', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
    jest.clearAllMocks();
  });

  // ============ Trip Query Tests ============

  describe('Trip Queries', () => {
    it('fetches all trips successfully', async () => {
      const mockTrips = [createMockTrip({ id: 'trip-1' }), createMockTrip({ id: 'trip-2' })];
      mockedApi.get.mockResolvedValueOnce({ data: mockTrips });

      const { result } = renderHook(() => useTrips(), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockedApi.get).toHaveBeenCalledWith('/trips');
      expect(result.current.data).toHaveLength(2);
      expect(result.current.data?.[0].id).toBe('trip-1');
    });

    it('fetches a single trip by ID', async () => {
      const mockTrip = createMockTrip({ id: 'trip-123', name: 'Japan Trip' });
      mockedApi.get.mockResolvedValueOnce({ data: mockTrip });

      const { result } = renderHook(() => useTrip('trip-123'), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockedApi.get).toHaveBeenCalledWith('/trips/trip-123');
      expect(result.current.data?.name).toBe('Japan Trip');
    });

    it('does not fetch trip when tripId is empty', () => {
      const { result } = renderHook(() => useTrip(''), {
        wrapper: createWrapper(queryClient),
      });

      expect(result.current.isFetching).toBe(false);
      expect(mockedApi.get).not.toHaveBeenCalled();
    });
  });

  // ============ Trip Creation Tests ============

  describe('Trip Creation', () => {
    it('creates a trip with country and name', async () => {
      const mockResponse = createMockTripWithTags({
        id: 'new-trip',
        name: 'Tokyo Adventure',
        country_id: 'JP',
      });
      mockedApi.post.mockResolvedValueOnce({ data: mockResponse });

      const { result } = renderHook(() => useCreateTrip(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.mutateAsync({
          name: 'Tokyo Adventure',
          country_code: 'JP',
        });
      });

      expect(mockedApi.post).toHaveBeenCalledWith('/trips', {
        name: 'Tokyo Adventure',
        country_code: 'JP',
      });
    });

    it('creates a trip with cover image', async () => {
      const mockResponse = createMockTripWithTags({
        id: 'new-trip',
        name: 'Quick Trip',
        country_id: 'US',
        cover_image_url: 'https://example.com/cover.jpg',
      });
      mockedApi.post.mockResolvedValueOnce({ data: mockResponse });

      const { result } = renderHook(() => useCreateTrip(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.mutateAsync({
          name: 'Quick Trip',
          country_code: 'US',
          cover_image_url: 'https://example.com/cover.jpg',
        });
      });

      expect(mockedApi.post).toHaveBeenCalledWith('/trips', {
        name: 'Quick Trip',
        country_code: 'US',
        cover_image_url: 'https://example.com/cover.jpg',
      });
    });

    it('invalidates trips cache on successful creation', async () => {
      const mockResponse = createMockTripWithTags({ id: 'new-trip' });
      mockedApi.post.mockResolvedValueOnce({ data: mockResponse });

      // Pre-populate cache
      queryClient.setQueryData(['trips'], [createMockTrip()]);
      const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');

      const { result } = renderHook(() => useCreateTrip(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.mutateAsync({
          name: 'New Trip',
          country_code: 'JP',
        });
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['trips'] });
    });

    it('handles creation failure gracefully', async () => {
      const error = new Error('Network error');
      mockedApi.post.mockRejectedValueOnce(error);

      const { result } = renderHook(() => useCreateTrip(), {
        wrapper: createWrapper(queryClient),
      });

      let caughtError: Error | null = null;
      await act(async () => {
        try {
          await result.current.mutateAsync({
            name: 'Failed Trip',
            country_code: 'JP',
          });
        } catch (e) {
          caughtError = e as Error;
        }
      });

      // Verify error was thrown and caught
      expect(caughtError).toBeInstanceOf(Error);
    });
  });

  // ============ Trip Update Tests ============

  describe('Trip Update', () => {
    it('updates trip name successfully', async () => {
      const mockResponse = createMockTrip({
        id: 'trip-123',
        name: 'Updated Name',
      });
      mockedApi.patch.mockResolvedValueOnce({ data: mockResponse });

      const { result } = renderHook(() => useUpdateTrip(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.mutateAsync({
          id: 'trip-123',
          name: 'Updated Name',
        });
      });

      expect(mockedApi.patch).toHaveBeenCalledWith('/trips/trip-123', {
        name: 'Updated Name',
      });
    });

    it('updates trip with cover image', async () => {
      const mockResponse = createMockTrip({
        id: 'trip-123',
        cover_image_url: 'https://example.com/new-cover.jpg',
      });
      mockedApi.patch.mockResolvedValueOnce({ data: mockResponse });

      const { result } = renderHook(() => useUpdateTrip(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.mutateAsync({
          id: 'trip-123',
          cover_image_url: 'https://example.com/new-cover.jpg',
        });
      });

      expect(mockedApi.patch).toHaveBeenCalledWith('/trips/trip-123', {
        cover_image_url: 'https://example.com/new-cover.jpg',
      });
    });

    it('invalidates both list and detail caches on update', async () => {
      const mockResponse = createMockTrip({ id: 'trip-123' });
      mockedApi.patch.mockResolvedValueOnce({ data: mockResponse });

      const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');

      const { result } = renderHook(() => useUpdateTrip(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.mutateAsync({
          id: 'trip-123',
          name: 'Updated',
        });
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['trips'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['trips', 'trip-123'] });
    });

    it('handles update failure gracefully', async () => {
      const error = new Error('Update failed');
      mockedApi.patch.mockRejectedValueOnce(error);

      const { result } = renderHook(() => useUpdateTrip(), {
        wrapper: createWrapper(queryClient),
      });

      let caughtError: Error | null = null;
      await act(async () => {
        try {
          await result.current.mutateAsync({
            id: 'trip-123',
            name: 'Will Fail',
          });
        } catch (e) {
          caughtError = e as Error;
        }
      });

      // Verify error was thrown and caught
      expect(caughtError).toBeInstanceOf(Error);
    });
  });

  // ============ Trip Deletion Tests ============

  describe('Trip Deletion', () => {
    it('deletes trip successfully', async () => {
      mockedApi.delete.mockResolvedValueOnce({ data: {} });

      const { result } = renderHook(() => useDeleteTrip(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.mutateAsync('trip-123');
      });

      expect(mockedApi.delete).toHaveBeenCalledWith('/trips/trip-123');
    });

    it('invalidates trips cache on deletion', async () => {
      mockedApi.delete.mockResolvedValueOnce({ data: {} });

      const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');

      const { result } = renderHook(() => useDeleteTrip(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.mutateAsync('trip-123');
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['trips'] });
    });

    it('handles deletion failure gracefully', async () => {
      const error = new Error('Cannot delete trip');
      mockedApi.delete.mockRejectedValueOnce(error);

      const { result } = renderHook(() => useDeleteTrip(), {
        wrapper: createWrapper(queryClient),
      });

      let caughtError: Error | null = null;
      await act(async () => {
        try {
          await result.current.mutateAsync('trip-123');
        } catch (e) {
          caughtError = e as Error;
        }
      });

      // Verify error was thrown and caught
      expect(caughtError).toBeInstanceOf(Error);
    });
  });

  // ============ Entry Query Tests ============

  describe('Entry Queries', () => {
    it('fetches all entries for a trip', async () => {
      // Backend returns 'type' and 'date', hook transforms to 'entry_type' and 'entry_date'
      const backendEntries = [
        {
          id: 'entry-1',
          trip_id: 'trip-123',
          type: 'place',
          title: 'Temple Visit',
          notes: null,
          date: '2024-01-05',
          created_at: new Date().toISOString(),
          place: {
            id: 'place-1',
            entry_id: 'entry-1',
            google_place_id: 'ChIJ123',
            place_name: 'Sensoji Temple',
            lat: 35.7147,
            lng: 139.7966,
            address: 'Asakusa, Tokyo',
          },
        },
      ];
      mockedApi.get.mockResolvedValueOnce({ data: backendEntries });

      const { result } = renderHook(() => useEntries('trip-123'), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockedApi.get).toHaveBeenCalledWith('/trips/trip-123/entries');
      expect(result.current.data).toHaveLength(1);
      // Verify transformation
      expect(result.current.data?.[0].entry_type).toBe('place');
      expect(result.current.data?.[0].entry_date).toBe('2024-01-05');
      expect(result.current.data?.[0].place?.name).toBe('Sensoji Temple');
      expect(result.current.data?.[0].place?.latitude).toBe(35.7147);
    });

    it('fetches a single entry by ID', async () => {
      const backendEntry = {
        id: 'entry-123',
        trip_id: 'trip-123',
        type: 'food',
        title: 'Best Ramen',
        notes: 'Amazing!',
        date: '2024-01-06',
        created_at: new Date().toISOString(),
        place: null,
      };
      mockedApi.get.mockResolvedValueOnce({ data: backendEntry });

      const { result } = renderHook(() => useEntry('entry-123'), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockedApi.get).toHaveBeenCalledWith('/entries/entry-123');
      expect(result.current.data?.entry_type).toBe('food');
    });

    it('does not fetch entries when tripId is empty', () => {
      const { result } = renderHook(() => useEntries(''), {
        wrapper: createWrapper(queryClient),
      });

      expect(result.current.isFetching).toBe(false);
      expect(mockedApi.get).not.toHaveBeenCalled();
    });
  });

  // ============ Entry Creation Tests ============

  describe('Entry Creation', () => {
    it.each(['place', 'food', 'stay', 'experience'] as const)(
      'creates %s entry with correct type transformation',
      async (entryType) => {
        const backendResponse = {
          id: 'new-entry',
          trip_id: 'trip-123',
          type: entryType,
          title: `Test ${entryType}`,
          notes: null,
          date: '2024-01-10',
          created_at: new Date().toISOString(),
          place: null,
        };
        mockedApi.post.mockResolvedValueOnce({ data: backendResponse });

        const { result } = renderHook(() => useCreateEntry(), {
          wrapper: createWrapper(queryClient),
        });

        await act(async () => {
          await result.current.mutateAsync({
            trip_id: 'trip-123',
            entry_type: entryType,
            title: `Test ${entryType}`,
            entry_date: '2024-01-10',
          });
        });

        // Verify transformation from frontend to backend format
        expect(mockedApi.post).toHaveBeenCalledWith('/trips/trip-123/entries', {
          type: entryType, // Transformed from entry_type
          title: `Test ${entryType}`,
          notes: undefined,
          date: '2024-01-10', // Transformed from entry_date
          place: undefined,
        });
      }
    );

    it('creates entry with place data (location required for place/food/stay)', async () => {
      const backendResponse = {
        id: 'new-entry',
        trip_id: 'trip-123',
        type: 'place',
        title: 'Famous Temple',
        notes: null,
        date: '2024-01-10',
        created_at: new Date().toISOString(),
        place: {
          id: 'place-1',
          entry_id: 'new-entry',
          google_place_id: 'ChIJ123',
          place_name: 'Famous Temple',
          lat: 35.6762,
          lng: 139.6503,
          address: 'Tokyo, Japan',
        },
      };
      mockedApi.post.mockResolvedValueOnce({ data: backendResponse });

      const { result } = renderHook(() => useCreateEntry(), {
        wrapper: createWrapper(queryClient),
      });

      const placeInput = createMockPlaceInput();

      await act(async () => {
        await result.current.mutateAsync({
          trip_id: 'trip-123',
          entry_type: 'place',
          title: 'Famous Temple',
          place: placeInput,
        });
      });

      // Verify place field transformation
      expect(mockedApi.post).toHaveBeenCalledWith(
        '/trips/trip-123/entries',
        expect.objectContaining({
          place: {
            google_place_id: placeInput.google_place_id,
            place_name: placeInput.name, // Transformed from name
            lat: placeInput.latitude, // Transformed from latitude
            lng: placeInput.longitude, // Transformed from longitude
            address: placeInput.address,
          },
        })
      );
    });

    it('creates experience entry without place (location optional)', async () => {
      const backendResponse = {
        id: 'new-entry',
        trip_id: 'trip-123',
        type: 'experience',
        title: 'Amazing sunset',
        notes: 'Beautiful!',
        date: '2024-01-10',
        created_at: new Date().toISOString(),
        place: null,
      };
      mockedApi.post.mockResolvedValueOnce({ data: backendResponse });

      const { result } = renderHook(() => useCreateEntry(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.mutateAsync({
          trip_id: 'trip-123',
          entry_type: 'experience',
          title: 'Amazing sunset',
          notes: 'Beautiful!',
        });
      });

      expect(mockedApi.post).toHaveBeenCalledWith('/trips/trip-123/entries', {
        type: 'experience',
        title: 'Amazing sunset',
        notes: 'Beautiful!',
        date: undefined,
        place: undefined,
      });
    });

    it('invalidates entries cache for trip on success', async () => {
      const backendResponse = {
        id: 'new-entry',
        trip_id: 'trip-123',
        type: 'place',
        title: 'Test',
        notes: null,
        date: null,
        created_at: new Date().toISOString(),
        place: null,
      };
      mockedApi.post.mockResolvedValueOnce({ data: backendResponse });

      const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');

      const { result } = renderHook(() => useCreateEntry(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.mutateAsync({
          trip_id: 'trip-123',
          entry_type: 'place',
          title: 'Test',
        });
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['entries', 'trip-123'] });
    });

    it('handles creation failure gracefully', async () => {
      const error = new Error('Failed to create entry');
      mockedApi.post.mockRejectedValueOnce(error);

      const { result } = renderHook(() => useCreateEntry(), {
        wrapper: createWrapper(queryClient),
      });

      let caughtError: Error | null = null;
      await act(async () => {
        try {
          await result.current.mutateAsync({
            trip_id: 'trip-123',
            entry_type: 'place',
            title: 'Will Fail',
          });
        } catch (e) {
          caughtError = e as Error;
        }
      });

      // Verify error was thrown and caught
      expect(caughtError).toBeInstanceOf(Error);
    });
  });

  // ============ Entry Update Tests ============

  describe('Entry Update', () => {
    it('updates entry title successfully', async () => {
      const backendResponse = {
        id: 'entry-123',
        trip_id: 'trip-123',
        type: 'place',
        title: 'Updated Title',
        notes: null,
        date: null,
        created_at: new Date().toISOString(),
        place: null,
      };
      mockedApi.patch.mockResolvedValueOnce({ data: backendResponse });

      const { result } = renderHook(() => useUpdateEntry(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.mutateAsync({
          entryId: 'entry-123',
          data: { title: 'Updated Title' },
        });
      });

      expect(mockedApi.patch).toHaveBeenCalledWith('/entries/entry-123', {
        title: 'Updated Title',
      });
    });

    it('updates entry with place data', async () => {
      const backendResponse = {
        id: 'entry-123',
        trip_id: 'trip-123',
        type: 'place',
        title: 'Updated',
        notes: null,
        date: null,
        created_at: new Date().toISOString(),
        place: {
          id: 'place-1',
          entry_id: 'entry-123',
          google_place_id: 'ChIJ456',
          place_name: 'New Place',
          lat: 35.0,
          lng: 139.0,
          address: 'New Address',
        },
      };
      mockedApi.patch.mockResolvedValueOnce({ data: backendResponse });

      const { result } = renderHook(() => useUpdateEntry(), {
        wrapper: createWrapper(queryClient),
      });

      const newPlace = createMockPlaceInput({ name: 'New Place' });

      await act(async () => {
        await result.current.mutateAsync({
          entryId: 'entry-123',
          data: { place: newPlace },
        });
      });

      expect(mockedApi.patch).toHaveBeenCalledWith('/entries/entry-123', {
        place: {
          google_place_id: newPlace.google_place_id,
          place_name: newPlace.name,
          lat: newPlace.latitude,
          lng: newPlace.longitude,
          address: newPlace.address,
        },
      });
    });

    it('optimistically updates detail cache and invalidates list cache', async () => {
      const backendResponse = {
        id: 'entry-123',
        trip_id: 'trip-123',
        type: 'place',
        title: 'Updated',
        notes: null,
        date: null,
        created_at: new Date().toISOString(),
        place: null,
      };
      mockedApi.patch.mockResolvedValueOnce({ data: backendResponse });

      const setQueryDataSpy = jest.spyOn(queryClient, 'setQueryData');
      const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');

      const { result } = renderHook(() => useUpdateEntry(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.mutateAsync({
          entryId: 'entry-123',
          data: { title: 'Updated' },
        });
      });

      // Optimistic update to detail cache
      expect(setQueryDataSpy).toHaveBeenCalledWith(
        ['entries', 'detail', 'entry-123'],
        expect.any(Object)
      );
      // Invalidate trip entries list
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['entries', 'trip-123'] });
    });

    it('handles update failure gracefully', async () => {
      const error = new Error('Update failed');
      mockedApi.patch.mockRejectedValueOnce(error);

      const { result } = renderHook(() => useUpdateEntry(), {
        wrapper: createWrapper(queryClient),
      });

      let caughtError: Error | null = null;
      await act(async () => {
        try {
          await result.current.mutateAsync({
            entryId: 'entry-123',
            data: { title: 'Will Fail' },
          });
        } catch (e) {
          caughtError = e as Error;
        }
      });

      // Verify error was thrown and caught
      expect(caughtError).toBeInstanceOf(Error);
    });
  });

  // ============ Entry Deletion Tests ============

  describe('Entry Deletion', () => {
    it('deletes entry successfully', async () => {
      mockedApi.delete.mockResolvedValueOnce({ data: {} });

      const { result } = renderHook(() => useDeleteEntry(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.mutateAsync({ entryId: 'entry-123', tripId: 'trip-123' });
      });

      expect(mockedApi.delete).toHaveBeenCalledWith('/entries/entry-123');
    });

    it('invalidates trip entries cache on deletion', async () => {
      mockedApi.delete.mockResolvedValueOnce({ data: {} });

      const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');

      const { result } = renderHook(() => useDeleteEntry(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.mutateAsync({ entryId: 'entry-123', tripId: 'trip-123' });
      });

      // Uses tripId from variables, not entryId
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['entries', 'trip-123'] });
    });

    it('handles deletion failure gracefully', async () => {
      const error = new Error('Cannot delete entry');
      mockedApi.delete.mockRejectedValueOnce(error);

      const { result } = renderHook(() => useDeleteEntry(), {
        wrapper: createWrapper(queryClient),
      });

      let caughtError: Error | null = null;
      await act(async () => {
        try {
          await result.current.mutateAsync({ entryId: 'entry-123', tripId: 'trip-123' });
        } catch (e) {
          caughtError = e as Error;
        }
      });

      // Verify error was thrown and caught
      expect(caughtError).toBeInstanceOf(Error);
    });
  });

  // ============ Data Transformation Tests ============

  describe('Data Transformations', () => {
    it('transforms backend entry format to frontend format', async () => {
      const backendEntry = {
        id: 'entry-1',
        trip_id: 'trip-123',
        type: 'food', // Backend uses 'type'
        title: 'Best Ramen',
        notes: 'Delicious',
        date: '2024-01-10', // Backend uses 'date'
        created_at: new Date().toISOString(),
        place: {
          id: 'place-1',
          entry_id: 'entry-1',
          google_place_id: 'ChIJ123',
          place_name: 'Ramen Shop', // Backend uses 'place_name'
          lat: 35.6762, // Backend uses 'lat'
          lng: 139.6503, // Backend uses 'lng'
          address: 'Tokyo',
        },
      };
      mockedApi.get.mockResolvedValueOnce({ data: [backendEntry] });

      const { result } = renderHook(() => useEntries('trip-123'), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      const entry = result.current.data?.[0];
      // Frontend format assertions
      expect(entry?.entry_type).toBe('food'); // Transformed to 'entry_type'
      expect(entry?.entry_date).toBe('2024-01-10'); // Transformed to 'entry_date'
      expect(entry?.place?.name).toBe('Ramen Shop'); // Transformed to 'name'
      expect(entry?.place?.latitude).toBe(35.6762); // Transformed to 'latitude'
      expect(entry?.place?.longitude).toBe(139.6503); // Transformed to 'longitude'
    });

    it('handles entry without place correctly', async () => {
      const backendEntry = {
        id: 'entry-1',
        trip_id: 'trip-123',
        type: 'experience',
        title: 'Sunset',
        notes: null,
        date: null,
        created_at: new Date().toISOString(),
        place: null,
      };
      mockedApi.get.mockResolvedValueOnce({ data: [backendEntry] });

      const { result } = renderHook(() => useEntries('trip-123'), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data?.[0].place).toBeNull();
    });

    it('handles null notes and date correctly', async () => {
      const backendEntry = {
        id: 'entry-1',
        trip_id: 'trip-123',
        type: 'place',
        title: 'Test',
        notes: null,
        date: null,
        created_at: new Date().toISOString(),
        place: null,
      };
      mockedApi.get.mockResolvedValueOnce({ data: [backendEntry] });

      const { result } = renderHook(() => useEntries('trip-123'), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data?.[0].notes).toBeNull();
      expect(result.current.data?.[0].entry_date).toBeNull();
    });
  });
});
