/**
 * useMultiClusterUpload — stalled native calls.
 *
 * Confirming a photo-import suggestion can sit on "Uploading 1 of 1..." forever
 * with no request ever reaching the backend. Before the first network call the
 * hook resolves the `ph://` asset (`getAssetInfoAsync` with
 * `shouldDownloadFromNetwork: true`, which downloads iCloud-only originals) and
 * copies it into the cache. Either native call can leave its promise pending
 * forever, and Cancel only flipped an AbortSignal nothing was listening to, so
 * the card never left the uploading state.
 */

import { renderHook, act } from '@testing-library/react-native';

const mockGetAssetInfoAsync = jest.fn();
jest.mock('expo-media-library', () => ({
  getAssetInfoAsync: (...args: unknown[]) => mockGetAssetInfoAsync(...args),
}));

const mockCopyAsync = jest.fn();
const mockGetInfoAsync = jest.fn();
const mockDeleteAsync = jest.fn();
jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  copyAsync: (...args: unknown[]) => mockCopyAsync(...args),
  getInfoAsync: (...args: unknown[]) => mockGetInfoAsync(...args),
  deleteAsync: (...args: unknown[]) => mockDeleteAsync(...args),
}));

const mockUploadMutateAsync = jest.fn();
jest.mock('../../hooks/useMedia', () => ({
  MAX_PHOTOS_PER_ENTRY: 10,
  useUploadMedia: () => ({ mutateAsync: mockUploadMutateAsync }),
}));

import {
  useMultiClusterUpload,
  ASSET_DOWNLOAD_TIMEOUT_MS,
  type UploadPhotosResult,
} from '../../hooks/useMultiClusterUpload';
import type { PhotoWithLocation } from '../../services/photoImport';

const PENDING = Symbol('pending');

const never = () => new Promise<never>(() => {});

/** Let queued microtasks/immediates drain without advancing fake time. */
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

async function settledOrPending<T>(promise: Promise<T>): Promise<T | typeof PENDING> {
  return Promise.race([promise, flush().then((): typeof PENDING => PENDING)]);
}

function makePhoto(overrides: Partial<PhotoWithLocation> = {}): PhotoWithLocation {
  return {
    id: 'A1B2C3D4-0000-0000-0000-000000000001/L0/001',
    uri: 'ph://A1B2C3D4-0000-0000-0000-000000000001',
    filename: 'IMG_0001.HEIC',
    creationTime: new Date('2022-09-28T12:00:00Z'),
    location: { latitude: 52.5, longitude: 13.43 },
    ...overrides,
  };
}

describe('useMultiClusterUpload', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    mockGetAssetInfoAsync.mockResolvedValue({ localUri: 'file:///library/IMG_0001.HEIC' });
    mockCopyAsync.mockResolvedValue(undefined);
    mockGetInfoAsync.mockResolvedValue({ exists: true, size: 1234 });
    mockDeleteAsync.mockResolvedValue(undefined);
    mockUploadMutateAsync.mockResolvedValue({ id: 'media-1' });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('uploads a library photo and returns its media id', async () => {
    const { result } = renderHook(() => useMultiClusterUpload());

    let outcome: UploadPhotosResult | undefined;
    await act(async () => {
      outcome = await result.current.uploadPhotos('cluster-1', [makePhoto()], 'trip-1');
    });

    expect(outcome).toEqual({ mediaIds: ['media-1'], failedCount: 0, cancelled: false });
    expect(mockUploadMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ tripId: 'trip-1' })
    );
  });

  it('gives up on an iCloud asset fetch that never settles and counts the photo as failed', async () => {
    mockGetAssetInfoAsync.mockImplementation(never);
    const { result } = renderHook(() => useMultiClusterUpload());

    let pending!: Promise<UploadPhotosResult>;
    act(() => {
      pending = result.current.uploadPhotos('cluster-1', [makePhoto()], 'trip-1');
    });

    await act(async () => {
      await flush();
      jest.advanceTimersByTime(ASSET_DOWNLOAD_TIMEOUT_MS);
    });

    let outcome: UploadPhotosResult | typeof PENDING = PENDING;
    await act(async () => {
      outcome = await settledOrPending(pending);
    });

    expect(outcome).toEqual({ mediaIds: [], failedCount: 1, cancelled: false });
    expect(mockUploadMutateAsync).not.toHaveBeenCalled();
  });

  it('gives up on a cache copy that never settles', async () => {
    mockCopyAsync.mockImplementation(never);
    const { result } = renderHook(() => useMultiClusterUpload());

    let pending!: Promise<UploadPhotosResult>;
    act(() => {
      pending = result.current.uploadPhotos('cluster-1', [makePhoto()], 'trip-1');
    });

    await act(async () => {
      await flush();
      jest.advanceTimersByTime(ASSET_DOWNLOAD_TIMEOUT_MS);
    });

    let outcome: UploadPhotosResult | typeof PENDING = PENDING;
    await act(async () => {
      outcome = await settledOrPending(pending);
    });

    expect(outcome).toEqual({ mediaIds: [], failedCount: 1, cancelled: false });
  });

  it('Cancel settles an upload stuck on a native call immediately, flagged as cancelled', async () => {
    mockGetAssetInfoAsync.mockImplementation(never);
    const { result } = renderHook(() => useMultiClusterUpload());

    let pending!: Promise<UploadPhotosResult>;
    act(() => {
      pending = result.current.uploadPhotos('cluster-1', [makePhoto()], 'trip-1');
    });
    await act(async () => {
      await flush();
    });

    act(() => {
      result.current.cancel('cluster-1');
    });

    // No timer advance: cancelling must not wait out the download bound.
    let outcome: UploadPhotosResult | typeof PENDING = PENDING;
    await act(async () => {
      outcome = await settledOrPending(pending);
    });

    expect(outcome).toEqual(expect.objectContaining({ mediaIds: [], cancelled: true }));
    expect(mockUploadMutateAsync).not.toHaveBeenCalled();
    expect(result.current.getUploadState('cluster-1')?.isUploading).toBe(false);
  });
});
