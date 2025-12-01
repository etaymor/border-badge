/**
 * Integration tests for useMedia hooks and media functionality.
 * Tests: file validation, upload flow, progress callbacks, retry, delete.
 */

import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { api, getStoredToken } from '@services/api';
import { supabase } from '@services/supabase';
import {
  useEntryMedia,
  useTripMedia,
  useMedia,
  useUploadMedia,
  useRetryUpload,
  useDeleteMedia,
  validateFile,
  MAX_FILE_SIZE,
  MAX_PHOTOS_PER_ENTRY,
  ALLOWED_TYPES,
} from '@hooks/useMedia';
import { createMockMediaFile, createMockLocalFile } from '../utils/mockFactories';
import { createTestQueryClient } from '../utils/testUtils';

// Type the mocks
const mockedApi = api as jest.Mocked<typeof api>;
const mockedGetStoredToken = getStoredToken as jest.MockedFunction<typeof getStoredToken>;
const mockedSupabase = supabase as jest.Mocked<typeof supabase>;

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Create wrapper for hooks
function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useMedia Integration', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
    jest.clearAllMocks();
    mockFetch.mockClear();
    mockedGetStoredToken.mockResolvedValue('test-token');
  });

  // ============ Constants Tests ============

  describe('Media Constants', () => {
    it('exports MAX_FILE_SIZE as 10MB', () => {
      expect(MAX_FILE_SIZE).toBe(10 * 1024 * 1024);
    });

    it('exports MAX_PHOTOS_PER_ENTRY as 10', () => {
      expect(MAX_PHOTOS_PER_ENTRY).toBe(10);
    });

    it('exports allowed file types', () => {
      expect(ALLOWED_TYPES).toContain('image/jpeg');
      expect(ALLOWED_TYPES).toContain('image/png');
      expect(ALLOWED_TYPES).toContain('image/heic');
      expect(ALLOWED_TYPES).toContain('image/heif');
    });
  });

  // ============ File Validation Tests ============

  describe('File Validation', () => {
    it('rejects files over 10MB', () => {
      const file = createMockLocalFile({
        size: 11 * 1024 * 1024, // 11MB
        name: 'large-photo.jpg',
      });
      const error = validateFile(file);
      expect(error).toContain('10MB');
      expect(error).toContain('large-photo.jpg');
    });

    it('accepts files under 10MB', () => {
      const file = createMockLocalFile({
        size: 5 * 1024 * 1024, // 5MB
      });
      const error = validateFile(file);
      expect(error).toBeNull();
    });

    it('accepts file exactly at 10MB limit', () => {
      const file = createMockLocalFile({
        size: 10 * 1024 * 1024, // exactly 10MB
      });
      const error = validateFile(file);
      expect(error).toBeNull();
    });

    it.each(['image/jpeg', 'image/png', 'image/heic', 'image/heif'])(
      'accepts %s file type',
      (mimeType) => {
        const file = createMockLocalFile({ type: mimeType, size: 1000 });
        const error = validateFile(file);
        expect(error).toBeNull();
      }
    );

    it.each(['image/gif', 'video/mp4', 'application/pdf', 'image/webp'])(
      'rejects %s file type',
      (mimeType) => {
        const file = createMockLocalFile({ type: mimeType, size: 1000 });
        const error = validateFile(file);
        expect(error).toContain('not supported');
        expect(error).toContain(mimeType);
      }
    );

    it('accepts file when size is undefined (assumes valid)', () => {
      const file = createMockLocalFile({ size: undefined });
      const error = validateFile(file);
      expect(error).toBeNull();
    });

    it('handles case-insensitive mime types', () => {
      const file = createMockLocalFile({ type: 'IMAGE/JPEG', size: 1000 });
      const error = validateFile(file);
      expect(error).toBeNull();
    });
  });

  // ============ Media Query Tests ============

  describe('Media Queries', () => {
    it('fetches all media for an entry', async () => {
      const mockMedia = [
        createMockMediaFile({ id: 'media-1' }),
        createMockMediaFile({ id: 'media-2' }),
      ];
      (mockedSupabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockResolvedValue({ data: mockMedia, error: null }),
      });

      const { result } = renderHook(() => useEntryMedia('entry-123'), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockedSupabase.from).toHaveBeenCalledWith('media_files');
      expect(result.current.data).toHaveLength(2);
    });

    it('fetches all media for a trip', async () => {
      const mockMedia = [createMockMediaFile({ id: 'media-1', trip_id: 'trip-123' })];
      (mockedSupabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockResolvedValue({ data: mockMedia, error: null }),
      });

      const { result } = renderHook(() => useTripMedia('trip-123'), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toHaveLength(1);
    });

    it('fetches a single media file by ID', async () => {
      const mockMedia = createMockMediaFile({ id: 'media-123' });
      mockedApi.get.mockResolvedValueOnce({ data: mockMedia });

      const { result } = renderHook(() => useMedia('media-123'), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockedApi.get).toHaveBeenCalledWith('/media/files/media-123');
    });

    it('does not fetch when entryId is empty', () => {
      const { result } = renderHook(() => useEntryMedia(''), {
        wrapper: createWrapper(queryClient),
      });

      expect(result.current.isFetching).toBe(false);
    });

    it('handles supabase query error', async () => {
      (mockedSupabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
      });

      const { result } = renderHook(() => useEntryMedia('entry-123'), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error?.message).toBe('DB error');
    });
  });

  // ============ Upload Flow Tests ============

  describe('Upload Flow', () => {
    it('calls progress callback at 0%, 50%, 90%, 100%', async () => {
      const file = createMockLocalFile({ size: 1000 });
      const progressCalls: number[] = [];
      const onProgress = jest.fn((p) => progressCalls.push(p.percentage));

      // Mock upload URL request
      mockedApi.post.mockResolvedValueOnce({
        data: {
          media_id: 'media-123',
          upload_url: 'https://storage.example.com/upload',
          file_path: 'media/test.jpg',
        },
      });

      // Mock storage upload
      mockFetch.mockResolvedValueOnce({ ok: true });

      // Mock status update
      mockedApi.patch.mockResolvedValueOnce({
        data: createMockMediaFile({ id: 'media-123', status: 'uploaded' }),
      });

      const { result } = renderHook(() => useUploadMedia(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.mutateAsync({
          file,
          tripId: 'trip-123',
          entryId: 'entry-123',
          onProgress,
        });
      });

      expect(progressCalls).toContain(0);
      expect(progressCalls).toContain(50);
      expect(progressCalls).toContain(90);
      expect(progressCalls).toContain(100);
    });

    it('requests upload URL before uploading', async () => {
      const file = createMockLocalFile();

      mockedApi.post.mockResolvedValueOnce({
        data: {
          media_id: 'media-123',
          upload_url: 'https://storage.example.com/upload',
          file_path: 'media/test.jpg',
        },
      });
      mockFetch.mockResolvedValueOnce({ ok: true });
      mockedApi.patch.mockResolvedValueOnce({
        data: createMockMediaFile({ id: 'media-123' }),
      });

      const { result } = renderHook(() => useUploadMedia(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.mutateAsync({
          file,
          tripId: 'trip-123',
          entryId: 'entry-123',
        });
      });

      expect(mockedApi.post).toHaveBeenCalledWith('/media/files/upload-url', {
        filename: file.name,
        content_type: file.type,
        trip_id: 'trip-123',
        entry_id: 'entry-123',
      });
    });

    it('uploads to storage URL returned from backend', async () => {
      const file = createMockLocalFile();
      const uploadUrl = 'https://storage.example.com/upload/unique-path';

      mockedApi.post.mockResolvedValueOnce({
        data: {
          media_id: 'media-123',
          upload_url: uploadUrl,
          file_path: 'media/test.jpg',
        },
      });
      mockFetch.mockResolvedValueOnce({ ok: true });
      mockedApi.patch.mockResolvedValueOnce({
        data: createMockMediaFile({ id: 'media-123' }),
      });

      const { result } = renderHook(() => useUploadMedia(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.mutateAsync({ file, entryId: 'entry-123' });
      });

      expect(mockFetch).toHaveBeenCalledWith(uploadUrl, expect.any(Object));
    });

    it('updates status to uploaded on success', async () => {
      const file = createMockLocalFile();

      mockedApi.post.mockResolvedValueOnce({
        data: {
          media_id: 'media-123',
          upload_url: 'https://storage.example.com/upload',
          file_path: 'media/test.jpg',
        },
      });
      mockFetch.mockResolvedValueOnce({ ok: true });
      mockedApi.patch.mockResolvedValueOnce({
        data: createMockMediaFile({ id: 'media-123', status: 'uploaded' }),
      });

      const { result } = renderHook(() => useUploadMedia(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.mutateAsync({ file, entryId: 'entry-123' });
      });

      expect(mockedApi.patch).toHaveBeenCalledWith('/media/files/media-123', {
        status: 'uploaded',
      });
    });

    it('invalidates entry media queries on success', async () => {
      const file = createMockLocalFile();

      mockedApi.post.mockResolvedValueOnce({
        data: { media_id: 'media-123', upload_url: 'https://example.com', file_path: 'test.jpg' },
      });
      mockFetch.mockResolvedValueOnce({ ok: true });
      mockedApi.patch.mockResolvedValueOnce({
        data: createMockMediaFile({ id: 'media-123' }),
      });

      const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');

      const { result } = renderHook(() => useUploadMedia(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.mutateAsync({ file, entryId: 'entry-123' });
      });

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['media', 'entry', 'entry-123'],
      });
    });

    it('invalidates trip media queries on success', async () => {
      const file = createMockLocalFile();

      mockedApi.post.mockResolvedValueOnce({
        data: { media_id: 'media-123', upload_url: 'https://example.com', file_path: 'test.jpg' },
      });
      mockFetch.mockResolvedValueOnce({ ok: true });
      mockedApi.patch.mockResolvedValueOnce({
        data: createMockMediaFile({ id: 'media-123' }),
      });

      const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');

      const { result } = renderHook(() => useUploadMedia(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.mutateAsync({ file, tripId: 'trip-123' });
      });

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['media', 'trip', 'trip-123'],
      });
    });
  });

  // ============ Upload Failure Tests ============

  describe('Upload Failure Flow', () => {
    it('rejects file that fails validation', async () => {
      const oversizedFile = createMockLocalFile({ size: 15 * 1024 * 1024 }); // 15MB

      const { result } = renderHook(() => useUploadMedia(), {
        wrapper: createWrapper(queryClient),
      });

      let caughtError: Error | null = null;
      await act(async () => {
        try {
          await result.current.mutateAsync({ file: oversizedFile, entryId: 'entry-123' });
        } catch (e) {
          caughtError = e as Error;
        }
      });

      // Verify error was thrown
      expect(caughtError).toBeInstanceOf(Error);
      // API should not be called for invalid files
      expect(mockedApi.post).not.toHaveBeenCalled();
    });

    it('updates status to failed when storage upload fails', async () => {
      const file = createMockLocalFile();

      mockedApi.post.mockResolvedValueOnce({
        data: {
          media_id: 'media-123',
          upload_url: 'https://storage.example.com/upload',
          file_path: 'media/test.jpg',
        },
      });
      // Storage upload fails
      mockFetch.mockResolvedValueOnce({ ok: false, text: () => Promise.resolve('Storage error') });
      // Status update to failed
      mockedApi.patch.mockResolvedValueOnce({
        data: createMockMediaFile({ id: 'media-123', status: 'failed' }),
      });

      const { result } = renderHook(() => useUploadMedia(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        try {
          await result.current.mutateAsync({ file, entryId: 'entry-123' });
        } catch {
          // Expected to throw
        }
      });

      expect(mockedApi.patch).toHaveBeenCalledWith('/media/files/media-123', {
        status: 'failed',
      });
    });

    it('handles upload failure gracefully', async () => {
      const file = createMockLocalFile();

      mockedApi.post.mockResolvedValueOnce({
        data: { media_id: 'media-123', upload_url: 'https://example.com', file_path: 'test.jpg' },
      });
      mockFetch.mockResolvedValueOnce({ ok: false, text: () => Promise.resolve('Error') });
      mockedApi.patch.mockResolvedValueOnce({
        data: createMockMediaFile({ id: 'media-123', status: 'failed' }),
      });

      const { result } = renderHook(() => useUploadMedia(), {
        wrapper: createWrapper(queryClient),
      });

      let caughtError: Error | null = null;
      await act(async () => {
        try {
          await result.current.mutateAsync({ file, entryId: 'entry-123' });
        } catch (e) {
          caughtError = e as Error;
        }
      });

      // Verify error was thrown
      expect(caughtError).toBeInstanceOf(Error);
    });

    it('handles authentication error gracefully', async () => {
      const file = createMockLocalFile();

      // No token available - triggers auth error in uploadToStorage
      mockedGetStoredToken.mockResolvedValueOnce(null);

      mockedApi.post.mockResolvedValueOnce({
        data: { media_id: 'media-123', upload_url: 'https://example.com', file_path: 'test.jpg' },
      });

      const { result } = renderHook(() => useUploadMedia(), {
        wrapper: createWrapper(queryClient),
      });

      let caughtError: Error | null = null;
      await act(async () => {
        try {
          await result.current.mutateAsync({ file, entryId: 'entry-123' });
        } catch (e) {
          caughtError = e as Error;
        }
      });

      // Verify error was thrown
      expect(caughtError).toBeInstanceOf(Error);
    });
  });

  // ============ Retry Functionality Tests ============

  describe('Retry Functionality', () => {
    it('resets status to processing on retry', async () => {
      mockedApi.patch.mockResolvedValueOnce({
        data: createMockMediaFile({ id: 'media-123', status: 'processing' }),
      });

      const { result } = renderHook(() => useRetryUpload(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.mutateAsync('media-123');
      });

      expect(mockedApi.patch).toHaveBeenCalledWith('/media/files/media-123', {
        status: 'processing',
      });
    });

    it('invalidates media queries on successful retry', async () => {
      mockedApi.patch.mockResolvedValueOnce({
        data: createMockMediaFile({
          id: 'media-123',
          entry_id: 'entry-123',
          trip_id: 'trip-123',
          status: 'processing',
        }),
      });

      const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');

      const { result } = renderHook(() => useRetryUpload(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.mutateAsync('media-123');
      });

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['media', 'entry', 'entry-123'],
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['media', 'trip', 'trip-123'],
      });
    });

    it('handles retry failure gracefully', async () => {
      const error = new Error('Retry failed');
      mockedApi.patch.mockRejectedValueOnce(error);

      const { result } = renderHook(() => useRetryUpload(), {
        wrapper: createWrapper(queryClient),
      });

      let caughtError: Error | null = null;
      await act(async () => {
        try {
          await result.current.mutateAsync('media-123');
        } catch (e) {
          caughtError = e as Error;
        }
      });

      // Verify error was thrown and caught
      expect(caughtError).toBeInstanceOf(Error);
    });
  });

  // ============ Delete Media Tests ============

  describe('Delete Media', () => {
    it('calls delete endpoint', async () => {
      mockedApi.delete.mockResolvedValueOnce({ data: {} });

      const { result } = renderHook(() => useDeleteMedia(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.mutateAsync('media-123');
      });

      expect(mockedApi.delete).toHaveBeenCalledWith('/media/files/media-123');
    });

    it('invalidates all media queries on success', async () => {
      mockedApi.delete.mockResolvedValueOnce({ data: {} });

      const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');

      const { result } = renderHook(() => useDeleteMedia(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.mutateAsync('media-123');
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['media'] });
    });

    it('handles deletion failure gracefully', async () => {
      const error = new Error('Cannot delete media');
      mockedApi.delete.mockRejectedValueOnce(error);

      const { result } = renderHook(() => useDeleteMedia(), {
        wrapper: createWrapper(queryClient),
      });

      let caughtError: Error | null = null;
      await act(async () => {
        try {
          await result.current.mutateAsync('media-123');
        } catch (e) {
          caughtError = e as Error;
        }
      });

      // Verify error was thrown and caught
      expect(caughtError).toBeInstanceOf(Error);
    });
  });

  // ============ Media URL Tests ============

  describe('Media URL Generation', () => {
    it('transforms raw media data to include computed URLs', async () => {
      const rawMedia = {
        id: 'media-123',
        owner_id: 'user-123',
        entry_id: 'entry-123',
        file_path: 'media/photo.jpg',
        thumbnail_path: 'media/photo-thumb.jpg',
        status: 'uploaded',
        created_at: new Date().toISOString(),
      };

      (mockedSupabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockResolvedValue({ data: [rawMedia], error: null }),
      });

      const { result } = renderHook(() => useEntryMedia('entry-123'), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      // URL and thumbnail_url should be computed
      expect(result.current.data?.[0].url).toBeDefined();
      expect(result.current.data?.[0].thumbnail_url).toBeDefined();
    });

    it('handles missing thumbnail_path', async () => {
      const rawMedia = {
        id: 'media-123',
        owner_id: 'user-123',
        entry_id: 'entry-123',
        file_path: 'media/photo.jpg',
        thumbnail_path: undefined,
        status: 'uploaded',
        created_at: new Date().toISOString(),
      };

      (mockedSupabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockResolvedValue({ data: [rawMedia], error: null }),
      });

      const { result } = renderHook(() => useEntryMedia('entry-123'), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data?.[0].thumbnail_url).toBeNull();
    });
  });
});
