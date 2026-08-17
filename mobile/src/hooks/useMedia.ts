import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert } from 'react-native';

import { api, getStoredToken } from '@services/api';
import { resizeImageForUpload } from '@services/mediaUpload';
import { supabase } from '@services/supabase';

// Media status enum matching backend
export type MediaStatus = 'processing' | 'uploaded' | 'failed';

// Media file interface matching backend MediaFile schema
export interface MediaFile {
  id: string;
  owner_id: string;
  entry_id?: string;
  trip_id?: string;
  file_path: string;
  thumbnail_path?: string;
  exif?: Record<string, unknown>;
  status: MediaStatus;
  created_at: string;
  // Computed URLs for convenience
  url: string;
  thumbnail_url: string | null;
}

// Upload URL response from backend
export interface UploadUrlResponse {
  media_id: string;
  upload_url: string;
  file_path: string;
}

// Input for requesting upload URL
export interface UploadUrlRequest {
  filename: string;
  content_type: string;
  trip_id?: string;
  entry_id?: string;
}

// Input for updating media status
export interface MediaStatusUpdate {
  status: MediaStatus;
  thumbnail_path?: string;
  exif?: Record<string, unknown>;
}

// Local file info for upload
export interface LocalFile {
  uri: string;
  name: string;
  type: string; // MIME type
  size?: number;
}

// Upload progress callback
export interface UploadProgress {
  loaded: number;
  total: number;
  percentage: number;
}

const MEDIA_QUERY_KEY = ['media'];

// Maximum file size: 10MB
export const MAX_FILE_SIZE = 10 * 1024 * 1024;

// Allowed file types
export const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/heic', 'image/heif'];

// Maximum photos per entry
export const MAX_PHOTOS_PER_ENTRY = 10;

// Validate a file before upload
export function validateFile(file: LocalFile): string | null {
  if (file.size && file.size > MAX_FILE_SIZE) {
    return `File "${file.name}" exceeds 10MB limit`;
  }
  if (!ALLOWED_TYPES.includes(file.type.toLowerCase())) {
    return `File type "${file.type}" is not supported. Use JPEG, PNG, or HEIC.`;
  }
  return null;
}

// Helper to get public URL for a media file
export function getMediaUrl(filePath: string): string {
  const { data } = supabase.storage.from('media').getPublicUrl(filePath);
  return data.publicUrl;
}

// Helper to get thumbnail URL (or fallback to main image)
export function getThumbnailUrl(media: MediaFile): string {
  const path = media.thumbnail_path || media.file_path;
  return getMediaUrl(path);
}

// Transform raw media data to include computed URLs
function transformMediaFile(raw: Record<string, unknown>): MediaFile {
  const filePath = raw.file_path as string;
  const thumbnailPath = raw.thumbnail_path as string | undefined;
  return {
    id: raw.id as string,
    owner_id: raw.owner_id as string,
    entry_id: raw.entry_id as string | undefined,
    trip_id: raw.trip_id as string | undefined,
    file_path: filePath,
    thumbnail_path: thumbnailPath,
    exif: raw.exif as Record<string, unknown> | undefined,
    status: raw.status as MediaStatus,
    created_at: raw.created_at as string,
    url: getMediaUrl(filePath),
    thumbnail_url: thumbnailPath ? getMediaUrl(thumbnailPath) : null,
  };
}

// Fetch all media for an entry
export function useEntryMedia(entryId: string) {
  return useQuery({
    queryKey: [...MEDIA_QUERY_KEY, 'entry', entryId],
    queryFn: async (): Promise<MediaFile[]> => {
      // Query media_files table filtered by entry_id
      const { data, error } = await supabase
        .from('media_files')
        .select('*')
        .eq('entry_id', entryId)
        .order('created_at', { ascending: true });

      if (error) throw new Error(error.message);
      return (data || []).map((raw) => transformMediaFile(raw as Record<string, unknown>));
    },
    enabled: !!entryId,
  });
}

// Fetch all media for a trip
export function useTripMedia(tripId: string) {
  return useQuery({
    queryKey: [...MEDIA_QUERY_KEY, 'trip', tripId],
    queryFn: async (): Promise<MediaFile[]> => {
      const { data, error } = await supabase
        .from('media_files')
        .select('*')
        .eq('trip_id', tripId)
        .order('created_at', { ascending: true });

      if (error) throw new Error(error.message);
      return (data || []).map((raw) => transformMediaFile(raw as Record<string, unknown>));
    },
    enabled: !!tripId,
  });
}

// Fetch pending media for a trip (media with tripId but no entryId yet)
// Used during entry creation before the entry exists
export function usePendingTripMedia(tripId: string, enabled = true) {
  return useQuery({
    queryKey: [...MEDIA_QUERY_KEY, 'pending', tripId],
    queryFn: async (): Promise<MediaFile[]> => {
      const { data, error } = await supabase
        .from('media_files')
        .select('*')
        .eq('trip_id', tripId)
        .is('entry_id', null)
        .order('created_at', { ascending: true });

      if (error) throw new Error(error.message);
      return (data || []).map((raw) => transformMediaFile(raw as Record<string, unknown>));
    },
    enabled: !!tripId && enabled,
  });
}

// Get a single media file
export function useMedia(mediaId: string) {
  return useQuery({
    queryKey: [...MEDIA_QUERY_KEY, mediaId],
    queryFn: async (): Promise<MediaFile> => {
      const response = await api.get(`/media/files/${mediaId}`);
      return transformMediaFile(response.data as Record<string, unknown>);
    },
    enabled: !!mediaId,
  });
}

// Request upload URL from backend
async function requestUploadUrl(request: UploadUrlRequest): Promise<UploadUrlResponse> {
  const response = await api.post('/media/files/upload-url', request);
  return response.data;
}

// Upload timeout in ms (60 seconds)
const UPLOAD_TIMEOUT = 60 * 1000;

// Upload file to Supabase Storage with progress tracking
async function uploadToStorage(
  uploadUrl: string,
  file: LocalFile,
  onProgress?: (progress: UploadProgress) => void
): Promise<void> {
  const token = await getStoredToken();
  if (!token) {
    throw new Error('Please sign in to upload photos');
  }

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    // Set up timeout
    const timeoutId = setTimeout(() => {
      xhr.abort();
      reject(new Error('Upload timed out. Please check your connection and try again.'));
    }, UPLOAD_TIMEOUT);

    // Track upload progress
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        const percentage = Math.round((event.loaded / event.total) * 100);
        onProgress({ loaded: event.loaded, total: event.total, percentage });
      }
    };

    xhr.onload = () => {
      clearTimeout(timeoutId);

      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        let errorMessage = 'Upload failed';
        const statusCode = xhr.status;

        if (statusCode === 413) {
          errorMessage = 'File is too large. Please choose a smaller photo.';
        } else if (statusCode === 401 || statusCode === 403) {
          errorMessage = 'Please sign in again to upload photos.';
        } else if (statusCode === 429) {
          errorMessage = 'Too many uploads. Please wait a moment and try again.';
        } else if (statusCode >= 500) {
          errorMessage = 'Server error. Please try again later.';
        } else if (xhr.responseText) {
          errorMessage = `Upload failed: ${xhr.responseText}`;
        }

        reject(new Error(errorMessage));
      }
    };

    xhr.onerror = () => {
      clearTimeout(timeoutId);
      reject(new Error('Upload failed. Please try again.'));
    };

    xhr.onabort = () => {
      clearTimeout(timeoutId);
      reject(new Error('Upload was cancelled.'));
    };

    // Send raw file as PUT request body (matching mediaUpload.ts pattern)
    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    // Send the file URI object as the body - React Native XHR handles this
    xhr.send({
      uri: file.uri,
      name: file.name,
      type: file.type,
    } as unknown as Blob);
  });
}

// Update media status after upload
async function updateMediaStatus(mediaId: string, update: MediaStatusUpdate): Promise<MediaFile> {
  const response = await api.patch(`/media/files/${mediaId}`, update);
  return transformMediaFile(response.data as Record<string, unknown>);
}

// Hook for uploading media
export function useUploadMedia() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      file,
      tripId,
      entryId,
      onProgress,
    }: {
      file: LocalFile;
      tripId?: string;
      entryId?: string;
      onProgress?: (progress: UploadProgress) => void;
    }): Promise<MediaFile> => {
      // Resize/compress before upload so no upload path ships full-resolution
      // originals. This is the single chokepoint every real upload path funnels
      // through (manual picker via EntryMediaGallery, cluster import, and
      // multi-cluster import all use useUploadMedia), so the resize lives here
      // rather than at each call site. Falls back to the original on failure.
      file = await resizeImageForUpload(file);

      // Validate file (after resize, so the 10MB backstop sees the final bytes)
      const validationError = validateFile(file);
      if (validationError) {
        throw new Error(validationError);
      }

      const fileSize = file.size ?? 0;

      // Report initial progress
      onProgress?.({ loaded: 0, total: fileSize, percentage: 0 });

      // Request upload URL (0-10% of progress)
      const { media_id, upload_url } = await requestUploadUrl({
        filename: file.name,
        content_type: file.type,
        trip_id: tripId,
        entry_id: entryId,
      });

      onProgress?.({ loaded: fileSize * 0.1, total: fileSize, percentage: 10 });

      try {
        // Upload to storage (10-95% of progress)
        // Scale the upload progress to fit within our 10-95% range
        await uploadToStorage(upload_url, file, (uploadProgress) => {
          // Upload progress goes from 0-100%, scale to 10-95% of overall
          const scaledPercentage = 10 + uploadProgress.percentage * 0.85;
          onProgress?.({
            loaded: fileSize * (scaledPercentage / 100),
            total: fileSize,
            percentage: Math.round(scaledPercentage),
          });
        });

        onProgress?.({ loaded: fileSize * 0.95, total: fileSize, percentage: 95 });

        // Update status to uploaded (95-100%)
        const media = await updateMediaStatus(media_id, { status: 'uploaded' });

        // Report 100% progress
        onProgress?.({ loaded: fileSize, total: fileSize, percentage: 100 });

        return media;
      } catch (uploadError) {
        // Update status to failed
        try {
          await updateMediaStatus(media_id, { status: 'failed' });
        } catch {
          // Ignore status update failure - the upload already failed
        }

        // Re-throw with the original error message for better user feedback
        if (uploadError instanceof Error) {
          throw uploadError;
        }
        throw new Error('Failed to upload file. Please try again.');
      }
    },
    onSuccess: (_, variables) => {
      // Invalidate relevant queries
      if (variables.entryId) {
        queryClient.invalidateQueries({
          queryKey: [...MEDIA_QUERY_KEY, 'entry', variables.entryId],
        });
      }
      if (variables.tripId) {
        queryClient.invalidateQueries({ queryKey: [...MEDIA_QUERY_KEY, 'trip', variables.tripId] });
        // Also invalidate pending query so uploaded media appears in gallery
        queryClient.invalidateQueries({
          queryKey: [...MEDIA_QUERY_KEY, 'pending', variables.tripId],
        });
      }
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Failed to upload media';
      Alert.alert('Upload Error', message);
    },
  });
}

// Hook for retrying a failed upload
export function useRetryUpload() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (mediaId: string): Promise<MediaFile> => {
      // Just update status back to processing to trigger a retry
      // The actual file should still be there
      const media = await updateMediaStatus(mediaId, { status: 'processing' });
      return media;
    },
    onSuccess: (data) => {
      if (data.entry_id) {
        queryClient.invalidateQueries({ queryKey: [...MEDIA_QUERY_KEY, 'entry', data.entry_id] });
      }
      if (data.trip_id) {
        queryClient.invalidateQueries({ queryKey: [...MEDIA_QUERY_KEY, 'trip', data.trip_id] });
      }
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Failed to retry upload';
      Alert.alert('Retry Error', message);
    },
  });
}

// Hook for deleting media
export function useDeleteMedia() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (mediaId: string): Promise<void> => {
      await api.delete(`/media/files/${mediaId}`);
    },
    onSuccess: () => {
      // Invalidate all media queries since we don't know which entry/trip
      queryClient.invalidateQueries({ queryKey: MEDIA_QUERY_KEY });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Failed to delete media';
      Alert.alert('Error', message);
    },
  });
}
