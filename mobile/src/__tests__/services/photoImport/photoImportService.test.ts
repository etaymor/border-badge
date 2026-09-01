import * as MediaLibrary from 'expo-media-library';

import { Analytics } from '@services/analytics';

import {
  extractPhotosWithLocation,
  requestPhotoPermissions,
  SCAN_CONFIG,
} from '../../../services/photoImport/photoImportService';
import { PermissionDeniedError, ScanCancelledError } from '../../../services/photoImport/errors';

jest.mock('@services/analytics', () => ({
  Analytics: {
    photoPermissionSoftAskShown: jest.fn(),
    photoPermissionOsResult: jest.fn(),
  },
}));

// Mock expo-media-library
jest.mock('expo-media-library', () => ({
  requestPermissionsAsync: jest.fn(),
  getAssetsAsync: jest.fn(),
  getAssetInfoAsync: jest.fn(),
  MediaType: { photo: 'photo' },
  SortBy: { creationTime: ['creationTime', false] },
  PermissionStatus: {
    GRANTED: 'granted',
    DENIED: 'denied',
    UNDETERMINED: 'undetermined',
  },
}));

const mockedMediaLibrary = MediaLibrary as jest.Mocked<typeof MediaLibrary>;

describe('photoImportService', () => {
  beforeEach(() => {
    // Reset all mocks including implementation queues
    jest.resetAllMocks();
  });

  describe('SCAN_CONFIG', () => {
    it('has correct batch size', () => {
      expect(SCAN_CONFIG.BATCH_SIZE).toBe(50);
    });

    it('has correct yield interval', () => {
      expect(SCAN_CONFIG.YIELD_INTERVAL_MS).toBe(16);
    });
  });

  describe('requestPhotoPermissions', () => {
    it('returns granted true when permission is granted', async () => {
      mockedMediaLibrary.requestPermissionsAsync.mockResolvedValue({
        status: MediaLibrary.PermissionStatus.GRANTED,
        granted: true,
        canAskAgain: true,
        expires: 'never',
        accessPrivileges: 'all',
      });

      const result = await requestPhotoPermissions();

      expect(result.granted).toBe(true);
      expect(result.limited).toBe(false);
      expect(mockedMediaLibrary.requestPermissionsAsync).toHaveBeenCalledTimes(1);
      expect(Analytics.photoPermissionSoftAskShown).toHaveBeenCalledWith({ door: 'trips' });
      expect(Analytics.photoPermissionOsResult).toHaveBeenCalledWith({
        door: 'trips',
        status: 'granted',
      });
    });

    it('returns granted false when permission is denied', async () => {
      mockedMediaLibrary.requestPermissionsAsync.mockResolvedValue({
        status: MediaLibrary.PermissionStatus.DENIED,
        granted: false,
        canAskAgain: true,
        expires: 'never',
        accessPrivileges: 'none',
      });

      const result = await requestPhotoPermissions();

      expect(result.granted).toBe(false);
      expect(Analytics.photoPermissionOsResult).toHaveBeenCalledWith({
        door: 'trips',
        status: 'denied',
      });
    });

    it('returns limited true for limited permission', async () => {
      mockedMediaLibrary.requestPermissionsAsync.mockResolvedValue({
        status: MediaLibrary.PermissionStatus.GRANTED,
        granted: true,
        canAskAgain: false,
        expires: 'never',
        accessPrivileges: 'limited',
      });

      const result = await requestPhotoPermissions();

      expect(result.granted).toBe(true);
      expect(result.limited).toBe(true);
      expect(Analytics.photoPermissionOsResult).toHaveBeenCalledWith({
        door: 'trips',
        status: 'limited',
      });
    });
  });

  describe('extractPhotosWithLocation', () => {
    const mockProgressCallback = jest.fn();

    beforeEach(() => {
      mockProgressCallback.mockClear();
    });

    it('throws PermissionDeniedError when permission is not granted', async () => {
      mockedMediaLibrary.requestPermissionsAsync.mockResolvedValue({
        status: MediaLibrary.PermissionStatus.DENIED,
        granted: false,
        canAskAgain: true,
        expires: 'never',
        accessPrivileges: 'none',
      });

      await expect(extractPhotosWithLocation(mockProgressCallback)).rejects.toThrow(
        PermissionDeniedError
      );
    });

    it('extracts photos with location data', async () => {
      // Grant permission
      mockedMediaLibrary.requestPermissionsAsync.mockResolvedValue({
        status: MediaLibrary.PermissionStatus.GRANTED,
        granted: true,
        canAskAgain: true,
        expires: 'never',
        accessPrivileges: 'all',
      });

      // Return total count
      mockedMediaLibrary.getAssetsAsync.mockResolvedValueOnce({
        assets: [],
        totalCount: 2,
        hasNextPage: false,
        endCursor: '',
      });

      // Return batch of photos
      mockedMediaLibrary.getAssetsAsync.mockResolvedValueOnce({
        assets: [
          {
            id: 'photo-1',
            uri: 'file://photo1.jpg',
            filename: 'photo1.jpg',
            creationTime: Date.now() - 86400000,
            modificationTime: Date.now(),
            mediaType: 'photo',
            width: 1920,
            height: 1080,
            duration: 0,
          },
          {
            id: 'photo-2',
            uri: 'file://photo2.jpg',
            filename: 'photo2.jpg',
            creationTime: Date.now(),
            modificationTime: Date.now(),
            mediaType: 'photo',
            width: 1920,
            height: 1080,
            duration: 0,
          },
        ],
        totalCount: 2,
        hasNextPage: false,
        endCursor: 'cursor-1',
      });

      // Return asset info with location for first photo
      mockedMediaLibrary.getAssetInfoAsync.mockResolvedValueOnce({
        id: 'photo-1',
        uri: 'file://photo1.jpg',
        filename: 'photo1.jpg',
        creationTime: Date.now() - 86400000,
        modificationTime: Date.now(),
        mediaType: 'photo',
        width: 1920,
        height: 1080,
        duration: 0,
        location: {
          latitude: 35.6762,
          longitude: 139.6503,
        },
      });

      // Return asset info without location for second photo
      mockedMediaLibrary.getAssetInfoAsync.mockResolvedValueOnce({
        id: 'photo-2',
        uri: 'file://photo2.jpg',
        filename: 'photo2.jpg',
        creationTime: Date.now(),
        modificationTime: Date.now(),
        mediaType: 'photo',
        width: 1920,
        height: 1080,
        duration: 0,
        location: undefined,
      });

      const photos = await extractPhotosWithLocation(mockProgressCallback);

      // Should only return photo with location
      expect(photos).toHaveLength(1);
      expect(photos[0].id).toBe('photo-1');
      expect(photos[0].location.latitude).toBe(35.6762);
      expect(photos[0].location.longitude).toBe(139.6503);
    });

    it('calls progress callback during scan', async () => {
      mockedMediaLibrary.requestPermissionsAsync.mockResolvedValue({
        status: MediaLibrary.PermissionStatus.GRANTED,
        granted: true,
        canAskAgain: true,
        expires: 'never',
        accessPrivileges: 'all',
      });

      mockedMediaLibrary.getAssetsAsync.mockResolvedValueOnce({
        assets: [],
        totalCount: 1,
        hasNextPage: false,
        endCursor: '',
      });

      mockedMediaLibrary.getAssetsAsync.mockResolvedValueOnce({
        assets: [
          {
            id: 'photo-1',
            uri: 'file://photo1.jpg',
            filename: 'photo1.jpg',
            creationTime: Date.now(),
            modificationTime: Date.now(),
            mediaType: 'photo',
            width: 1920,
            height: 1080,
            duration: 0,
          },
        ],
        totalCount: 1,
        hasNextPage: false,
        endCursor: 'cursor-1',
      });

      mockedMediaLibrary.getAssetInfoAsync.mockResolvedValueOnce({
        id: 'photo-1',
        uri: 'file://photo1.jpg',
        filename: 'photo1.jpg',
        creationTime: Date.now(),
        modificationTime: Date.now(),
        mediaType: 'photo',
        width: 1920,
        height: 1080,
        duration: 0,
        location: { latitude: 35.6762, longitude: 139.6503 },
      });

      await extractPhotosWithLocation(mockProgressCallback);

      // Should call progress with counting, scanning, and complete phases
      expect(mockProgressCallback).toHaveBeenCalled();
      const calls = mockProgressCallback.mock.calls;
      expect(calls.some((call) => call[0].phase === 'counting')).toBe(true);
      expect(calls.some((call) => call[0].phase === 'scanning')).toBe(true);
      expect(calls.some((call) => call[0].phase === 'complete')).toBe(true);
    });

    it('handles cancellation via AbortSignal', async () => {
      mockedMediaLibrary.requestPermissionsAsync.mockResolvedValue({
        status: MediaLibrary.PermissionStatus.GRANTED,
        granted: true,
        canAskAgain: true,
        expires: 'never',
        accessPrivileges: 'all',
      });

      mockedMediaLibrary.getAssetsAsync.mockResolvedValueOnce({
        assets: [],
        totalCount: 100,
        hasNextPage: false,
        endCursor: '',
      });

      // Create an already-aborted signal
      const controller = new AbortController();
      controller.abort();

      mockedMediaLibrary.getAssetsAsync.mockResolvedValueOnce({
        assets: [
          {
            id: 'photo-1',
            uri: 'file://photo1.jpg',
            filename: 'photo1.jpg',
            creationTime: Date.now(),
            modificationTime: Date.now(),
            mediaType: 'photo',
            width: 1920,
            height: 1080,
            duration: 0,
          },
        ],
        totalCount: 100,
        hasNextPage: true,
        endCursor: 'cursor-1',
      });

      await expect(
        extractPhotosWithLocation(mockProgressCallback, controller.signal)
      ).rejects.toThrow(ScanCancelledError);
    });

    it('gracefully handles photos that fail to load metadata', async () => {
      mockedMediaLibrary.requestPermissionsAsync.mockResolvedValue({
        status: MediaLibrary.PermissionStatus.GRANTED,
        granted: true,
        canAskAgain: true,
        expires: 'never',
        accessPrivileges: 'all',
      });

      mockedMediaLibrary.getAssetsAsync.mockResolvedValueOnce({
        assets: [],
        totalCount: 2,
        hasNextPage: false,
        endCursor: '',
      });

      mockedMediaLibrary.getAssetsAsync.mockResolvedValueOnce({
        assets: [
          {
            id: 'photo-1',
            uri: 'file://photo1.jpg',
            filename: 'photo1.jpg',
            creationTime: Date.now(),
            modificationTime: Date.now(),
            mediaType: 'photo',
            width: 1920,
            height: 1080,
            duration: 0,
          },
          {
            id: 'photo-2',
            uri: 'file://photo2.jpg',
            filename: 'photo2.jpg',
            creationTime: Date.now(),
            modificationTime: Date.now(),
            mediaType: 'photo',
            width: 1920,
            height: 1080,
            duration: 0,
          },
        ],
        totalCount: 2,
        hasNextPage: false,
        endCursor: 'cursor-1',
      });

      // First photo throws error
      mockedMediaLibrary.getAssetInfoAsync.mockRejectedValueOnce(new Error('Failed to load asset'));

      // Second photo loads successfully
      mockedMediaLibrary.getAssetInfoAsync.mockResolvedValueOnce({
        id: 'photo-2',
        uri: 'file://photo2.jpg',
        filename: 'photo2.jpg',
        creationTime: Date.now(),
        modificationTime: Date.now(),
        mediaType: 'photo',
        width: 1920,
        height: 1080,
        duration: 0,
        location: { latitude: 40.7128, longitude: -74.006 },
      });

      const photos = await extractPhotosWithLocation(mockProgressCallback);

      // Should still return the successful photo
      expect(photos).toHaveLength(1);
      expect(photos[0].id).toBe('photo-2');
    });
  });
});
