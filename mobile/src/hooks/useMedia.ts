import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert } from 'react-native';

import { api, getStoredToken } from '@services/api';
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

// Upload file to Supabase Storage
async function uploadToStorage(uploadUrl: string, file: LocalFile): Promise<void> {
  const token = await getStoredToken();
  if (!token) {
    throw new Error('Not authenticated');
  }

  // Create form data for upload
  const formData = new FormData();
  formData.append('file', {
    uri: file.uri,
    name: file.name,
    type: file.type,
  } as unknown as Blob);

  // Upload to Supabase Storage
  const response = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': file.type,
    },
    body: formData,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Upload failed: ${error}`);
  }
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
      // Validate file
      const validationError = validateFile(file);
      if (validationError) {
        throw new Error(validationError);
      }

      // Report initial progress
      onProgress?.({ loaded: 0, total: file.size ?? 0, percentage: 0 });

      // Request upload URL
      const { media_id, upload_url } = await requestUploadUrl({
        filename: file.name,
        content_type: file.type,
        trip_id: tripId,
        entry_id: entryId,
      });

      // Report 50% progress after getting URL
      onProgress?.({ loaded: (file.size ?? 0) / 2, total: file.size ?? 0, percentage: 50 });

      try {
        // Upload to storage
        await uploadToStorage(upload_url, file);

        // Report 90% progress after upload
        onProgress?.({ loaded: (file.size ?? 0) * 0.9, total: file.size ?? 0, percentage: 90 });

        // Update status to uploaded
        const media = await updateMediaStatus(media_id, { status: 'uploaded' });

        // Report 100% progress
        onProgress?.({ loaded: file.size ?? 0, total: file.size ?? 0, percentage: 100 });

        return media;
      } catch {
        // Update status to failed
        await updateMediaStatus(media_id, { status: 'failed' });
        throw new Error('Failed to upload file');
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
