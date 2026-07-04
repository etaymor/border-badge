/**
 * Tests for media upload resize/compression (U8 / R12 upload-half).
 *
 * Verifies that uploads resize/compress client-side via expo-image-manipulator
 * before shipping to storage, with a bounded long edge (2048px), a pass-through
 * rule for already-small images, orientation baked upright by the manipulator,
 * and graceful fallback to the original on manipulator failure.
 */

// --- Mocks (must be declared before importing the module under test) ---

jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(),
  SaveFormat: { JPEG: 'jpeg' },
}));

// Provide a controllable Image.getSize for source-dimension probing.
const mockGetSize = jest.fn();
jest.mock('react-native', () => ({
  Image: { getSize: (...args: unknown[]) => mockGetSize(...args) },
}));

import * as ImageManipulator from 'expo-image-manipulator';

import {
  resizeImageForUpload,
  uploadMediaFile,
  RESIZE_MAX_DIMENSION,
  type LocalFile,
} from '../../services/mediaUpload';
import { api } from '../../services/api';

const mockManipulate = ImageManipulator.manipulateAsync as jest.Mock;
const mockApiPost = api.post as jest.Mock;

// Helper: make Image.getSize resolve with the given dimensions.
function setSourceDimensions(width: number, height: number): void {
  mockGetSize.mockImplementation((_uri: string, onSuccess: (w: number, h: number) => void) => {
    onSuccess(width, height);
  });
}

function makeFile(overrides: Partial<LocalFile> = {}): LocalFile {
  return {
    uri: 'file:///photos/original.heic',
    name: 'original.heic',
    type: 'image/heic',
    size: 5 * 1024 * 1024,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('resizeImageForUpload', () => {
  it('resizes a 4000x3000 source to a bounded long edge (2048) before upload', async () => {
    setSourceDimensions(4000, 3000);
    mockManipulate.mockResolvedValue({
      uri: 'file:///cache/resized.jpg',
      width: 2048,
      height: 1536,
    });

    const input = makeFile();
    const result = await resizeImageForUpload(input);

    // Manipulator was invoked with a resize action bounding the LONG edge to 2048.
    expect(mockManipulate).toHaveBeenCalledTimes(1);
    const [uriArg, actionsArg, optionsArg] = mockManipulate.mock.calls[0];
    expect(uriArg).toBe(input.uri);
    // Landscape source -> constrain width.
    expect(actionsArg).toEqual([{ resize: { width: RESIZE_MAX_DIMENSION } }]);
    expect(optionsArg).toEqual(expect.objectContaining({ format: 'jpeg', compress: 0.8 }));

    // The resized URI is what gets returned (and thus uploaded).
    expect(result.uri).toBe('file:///cache/resized.jpg');
    expect(result.type).toBe('image/jpeg');
  });

  it('constrains the HEIGHT for a portrait source taller than it is wide', async () => {
    setSourceDimensions(3000, 4000);
    mockManipulate.mockResolvedValue({
      uri: 'file:///cache/resized-portrait.jpg',
      width: 1536,
      height: 2048,
    });

    await resizeImageForUpload(makeFile());

    const [, actionsArg] = mockManipulate.mock.calls[0];
    expect(actionsArg).toEqual([{ resize: { height: RESIZE_MAX_DIMENSION } }]);
  });

  it('passes a source already <= 2048 on the long edge through untouched (no resize)', async () => {
    setSourceDimensions(1600, 1200);

    const input = makeFile({ uri: 'file:///photos/small.jpg', type: 'image/jpeg' });
    const result = await resizeImageForUpload(input);

    // Manipulator resize must NOT run - re-encoding a small image is wasteful/lossy.
    expect(mockManipulate).not.toHaveBeenCalled();
    // Original file passes through unchanged.
    expect(result).toBe(input);
  });

  it('preserves orientation by using the manipulated (upright) result uri', async () => {
    // A rotated source whose EXIF orientation the manipulator bakes into pixels.
    setSourceDimensions(4000, 3000);
    mockManipulate.mockResolvedValue({
      uri: 'file:///cache/upright.jpg',
      width: 2048,
      height: 1536,
    });

    const result = await resizeImageForUpload(makeFile());

    // We rely on the manipulator output (orientation baked upright), not the original.
    expect(result.uri).toBe('file:///cache/upright.jpg');
  });

  it('falls back to the original file when the manipulator throws', async () => {
    setSourceDimensions(4000, 3000);
    mockManipulate.mockRejectedValue(new Error('manipulator hiccup'));

    const input = makeFile();
    const result = await resizeImageForUpload(input);

    // A manipulator hiccup must not block the upload - original is used.
    expect(result).toBe(input);
  });

  it('falls back to the original file when source dimensions cannot be read', async () => {
    mockGetSize.mockImplementation(
      (_uri: string, _onSuccess: unknown, onError: (e: Error) => void) => {
        onError(new Error('cannot read size'));
      }
    );

    const input = makeFile();
    const result = await resizeImageForUpload(input);

    expect(mockManipulate).not.toHaveBeenCalled();
    expect(result).toBe(input);
  });
});

describe('uploadMediaFile resize integration', () => {
  it('resizes before requesting a signed upload URL and uploads the resized uri', async () => {
    setSourceDimensions(4000, 3000);
    mockManipulate.mockResolvedValue({
      uri: 'file:///cache/resized.jpg',
      width: 2048,
      height: 1536,
    });
    mockApiPost.mockResolvedValue({
      data: {
        media_id: 'media-1',
        upload_url: 'https://storage.example.com/signed',
        public_url: 'https://cdn.example.com/media-1.jpg',
      },
    });

    const result = await uploadMediaFile('entry-1', makeFile());

    // Resize happened.
    expect(mockManipulate).toHaveBeenCalledTimes(1);

    // The signed-URL request used the resized content type (image/jpeg),
    // proving resize ran BEFORE getSignedUploadUrl.
    const signedUrlCall = mockApiPost.mock.calls.find(([url]) => url === '/media/files/upload-url');
    expect(signedUrlCall).toBeDefined();
    expect(signedUrlCall![1]).toEqual(expect.objectContaining({ content_type: 'image/jpeg' }));

    expect(result.status).toBe('completed');
    expect(result.id).toBe('media-1');
  });

  it('still enforces the 10MB backstop after resize', async () => {
    // Small source -> pass-through, but original is oversized -> must be rejected.
    setSourceDimensions(1600, 1200);

    const oversized = makeFile({
      uri: 'file:///photos/huge.jpg',
      type: 'image/jpeg',
      size: 11 * 1024 * 1024,
    });

    await expect(uploadMediaFile('entry-1', oversized)).rejects.toThrow(/too large/i);

    // Never reached the signed-URL request.
    const signedUrlCall = mockApiPost.mock.calls.find(([url]) => url === '/media/files/upload-url');
    expect(signedUrlCall).toBeUndefined();
  });
});
