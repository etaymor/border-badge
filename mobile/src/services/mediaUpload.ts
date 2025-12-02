/**
 * Media upload service for handling image uploads to the backend.
 * Uses signed URLs from the backend to upload directly to storage.
 *
 * Uses the modern expo-file-system API (SDK 54+) with expo/fetch for uploads.
 * See: https://docs.expo.dev/versions/latest/sdk/filesystem/
 */

import * as ImagePicker from 'expo-image-picker';
import { File as ExpoFile } from 'expo-file-system';
import { fetch as expoFetch } from 'expo/fetch';

import { api } from './api';

// Constants
export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
export const MAX_PHOTOS_PER_ENTRY = 10;
export const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/heic', 'image/heif'];

// Types
export interface LocalFile {
  uri: string;
  name: string;
  type: string;
  size: number;
}

export interface UploadProgress {
  loaded: number;
  total: number;
  percentage: number;
}

export interface UploadResult {
  id: string;
  url: string;
  thumbnail_url: string | null;
  status: 'completed' | 'failed';
}

export interface SignedUrlResponse {
  media_id: string;
  upload_url: string;
  public_url: string;
}

export class MediaUploadError extends Error {
  constructor(
    message: string,
    public code: 'VALIDATION' | 'PERMISSION' | 'UPLOAD' | 'NETWORK' | 'UNKNOWN'
  ) {
    super(message);
    this.name = 'MediaUploadError';
  }
}

/**
 * Request camera roll permissions
 */
export async function requestMediaLibraryPermission(): Promise<boolean> {
  const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
  return status === 'granted';
}

/**
 * Request camera permissions
 */
export async function requestCameraPermission(): Promise<boolean> {
  const { status } = await ImagePicker.requestCameraPermissionsAsync();
  return status === 'granted';
}

/**
 * Validate a file before upload
 */
export function validateFile(file: LocalFile): { valid: boolean; error?: string } {
  // Check file size
  if (file.size > MAX_FILE_SIZE) {
    return {
      valid: false,
      error: `File is too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)}MB`,
    };
  }

  // Check file type
  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    return {
      valid: false,
      error: 'Invalid file type. Only JPEG, PNG, and HEIC images are allowed',
    };
  }

  return { valid: true };
}

/**
 * Pick images from the media library
 */
export async function pickImages(options?: {
  maxCount?: number;
  allowsEditing?: boolean;
}): Promise<LocalFile[]> {
  const { maxCount = MAX_PHOTOS_PER_ENTRY, allowsEditing = false } = options ?? {};

  const hasPermission = await requestMediaLibraryPermission();
  if (!hasPermission) {
    throw new MediaUploadError(
      'Photo library access denied. Please enable in Settings.',
      'PERMISSION'
    );
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing,
    allowsMultipleSelection: !allowsEditing && maxCount > 1,
    selectionLimit: maxCount,
    quality: 0.8,
    exif: false,
  });

  if (result.canceled || !result.assets?.length) {
    return [];
  }

  const files: LocalFile[] = [];

  for (const asset of result.assets) {
    // Use the modern expo-file-system File class
    const expoFile = new ExpoFile(asset.uri);

    if (!expoFile.exists) {
      continue;
    }

    const file: LocalFile = {
      uri: asset.uri,
      name: asset.fileName ?? `photo_${Date.now()}.jpg`,
      type: asset.mimeType ?? 'image/jpeg',
      size: expoFile.size,
    };

    const validation = validateFile(file);
    if (!validation.valid) {
      console.warn(`Skipping invalid file: ${validation.error}`);
      continue;
    }

    files.push(file);
  }

  return files;
}

/**
 * Take a photo with the camera
 */
export async function takePhoto(): Promise<LocalFile | null> {
  const hasPermission = await requestCameraPermission();
  if (!hasPermission) {
    throw new MediaUploadError('Camera access denied. Please enable in Settings.', 'PERMISSION');
  }

  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    quality: 0.8,
    exif: false,
  });

  if (result.canceled || !result.assets?.length) {
    return null;
  }

  const asset = result.assets[0];
  // Use the modern expo-file-system File class
  const expoFile = new ExpoFile(asset.uri);

  if (!expoFile.exists) {
    throw new MediaUploadError('Failed to access captured photo', 'UNKNOWN');
  }

  const file: LocalFile = {
    uri: asset.uri,
    name: asset.fileName ?? `photo_${Date.now()}.jpg`,
    type: asset.mimeType ?? 'image/jpeg',
    size: expoFile.size,
  };

  const validation = validateFile(file);
  if (!validation.valid) {
    throw new MediaUploadError(validation.error!, 'VALIDATION');
  }

  return file;
}

/**
 * Get a signed upload URL from the backend
 */
async function getSignedUploadUrl(
  entryId: string,
  filename: string,
  contentType: string
): Promise<SignedUrlResponse> {
  try {
    const response = await api.post<SignedUrlResponse>('/media/files/upload-url', {
      entry_id: entryId,
      filename,
      content_type: contentType,
    });
    return response.data;
  } catch (error) {
    console.error('Failed to get signed URL:', error);
    throw new MediaUploadError('Failed to prepare upload. Please try again.', 'NETWORK');
  }
}

/**
 * Upload file to storage using signed URL.
 * Uses the modern expo-file-system File class with expo/fetch for efficient uploads.
 * The File class implements the Blob interface, enabling direct use with fetch.
 */
async function uploadToStorage(
  signedUrl: string,
  file: LocalFile,
  onProgress?: (progress: UploadProgress) => void
): Promise<void> {
  try {
    // Report initial progress
    onProgress?.({ loaded: 0, total: file.size, percentage: 0 });

    // Create an ExpoFile from the URI - it implements the Blob interface
    const expoFile = new ExpoFile(file.uri);

    // Use expo/fetch with the file as the body for efficient streaming upload
    // This avoids loading the entire file into memory
    const response = await expoFetch(signedUrl, {
      method: 'PUT',
      headers: { 'Content-Type': file.type },
      body: expoFile,
    });

    if (!response.ok) {
      throw new Error(`Upload failed with status ${response.status}`);
    }

    // Report completion
    onProgress?.({ loaded: file.size, total: file.size, percentage: 100 });
  } catch (error) {
    console.error('Storage upload failed:', error);
    throw new MediaUploadError('Failed to upload file. Please try again.', 'UPLOAD');
  }
}

/**
 * Mark upload as complete in the backend
 */
async function markUploadComplete(mediaId: string): Promise<void> {
  try {
    await api.post(`/media/${mediaId}/complete`);
  } catch (error) {
    console.error('Failed to mark upload complete:', error);
    // Don't throw - the file was uploaded, just status update failed
  }
}

/**
 * Upload a single file for an entry
 */
export async function uploadMediaFile(
  entryId: string,
  file: LocalFile,
  onProgress?: (progress: UploadProgress) => void
): Promise<UploadResult> {
  // Validate file
  const validation = validateFile(file);
  if (!validation.valid) {
    throw new MediaUploadError(validation.error!, 'VALIDATION');
  }

  // Get signed URL
  const signedUrlResponse = await getSignedUploadUrl(entryId, file.name, file.type);

  // Report initial progress
  if (onProgress) {
    onProgress({ loaded: 0, total: file.size, percentage: 0 });
  }

  // Upload to storage
  await uploadToStorage(signedUrlResponse.upload_url, file, onProgress);

  // Mark complete
  await markUploadComplete(signedUrlResponse.media_id);

  return {
    id: signedUrlResponse.media_id,
    url: signedUrlResponse.public_url,
    thumbnail_url: null, // Backend will generate async
    status: 'completed',
  };
}

/**
 * Upload multiple files for an entry
 */
export async function uploadMultipleMediaFiles(
  entryId: string,
  files: LocalFile[],
  onFileProgress?: (fileIndex: number, progress: UploadProgress) => void,
  onFileComplete?: (fileIndex: number, result: UploadResult | null, error?: Error) => void
): Promise<UploadResult[]> {
  const results: UploadResult[] = [];

  for (let i = 0; i < files.length; i++) {
    try {
      const result = await uploadMediaFile(entryId, files[i], (progress) => {
        onFileProgress?.(i, progress);
      });
      results.push(result);
      onFileComplete?.(i, result);
    } catch (error) {
      console.error(`Failed to upload file ${i}:`, error);
      onFileComplete?.(i, null, error as Error);
    }
  }

  return results;
}
