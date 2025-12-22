/**
 * Tests for the Share Extension Bridge service.
 *
 * Tests the pure functions and storage logic for handling URLs
 * shared from the iOS Share Extension.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  isShareExtensionDeepLink,
  parseDeepLinkParams,
  savePendingShare,
  getPendingShare,
  clearPendingShare,
  markShareProcessed,
  wasRecentlyProcessed,
} from '@services/shareExtensionBridge';

// Mock AsyncStorage
jest.mock('@react-native-async-storage/async-storage');
const mockAsyncStorage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;

// Mock Platform
jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  Linking: {
    getInitialURL: jest.fn(),
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  },
  NativeModules: {},
}));

describe('shareExtensionBridge', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('isShareExtensionDeepLink', () => {
    it('returns true for borderbadge://share', () => {
      expect(isShareExtensionDeepLink('borderbadge://share')).toBe(true);
    });

    it('returns true for borderbadge://share with query params', () => {
      expect(isShareExtensionDeepLink('borderbadge://share?foo=bar')).toBe(true);
    });

    it('returns false for other borderbadge deep links', () => {
      expect(isShareExtensionDeepLink('borderbadge://other')).toBe(false);
      expect(isShareExtensionDeepLink('borderbadge://settings')).toBe(false);
    });

    it('returns false for other URL schemes', () => {
      expect(isShareExtensionDeepLink('https://example.com/share')).toBe(false);
      expect(isShareExtensionDeepLink('myapp://share')).toBe(false);
    });

    it('returns false for null or empty input', () => {
      expect(isShareExtensionDeepLink(null)).toBe(false);
      expect(isShareExtensionDeepLink('')).toBe(false);
    });
  });

  describe('parseDeepLinkParams', () => {
    it('extracts URL from query params', () => {
      const deepLink = 'borderbadge://share?url=https%3A%2F%2Fvm.tiktok.com%2Fabc123';
      const params = parseDeepLinkParams(deepLink);
      expect(params.url).toBe('https://vm.tiktok.com/abc123');
      expect(params.source).toBe('share_extension');
    });

    it('handles deep links without URL param', () => {
      const params = parseDeepLinkParams('borderbadge://share');
      expect(params.url).toBeUndefined();
      expect(params.source).toBe('share_extension');
    });

    it('handles malformed URLs gracefully', () => {
      const params = parseDeepLinkParams('not-a-valid-url');
      expect(params.source).toBe('share_extension');
    });
  });

  describe('savePendingShare', () => {
    it('saves URL with timestamp to AsyncStorage', async () => {
      const testUrl = 'https://vm.tiktok.com/abc123';
      const beforeTime = Date.now();

      await savePendingShare(testUrl);

      expect(mockAsyncStorage.setItem).toHaveBeenCalledTimes(1);
      const [key, value] = mockAsyncStorage.setItem.mock.calls[0];
      expect(key).toBe('share_extension_pending_url');

      const parsed = JSON.parse(value);
      expect(parsed.url).toBe(testUrl);
      expect(parsed.timestamp).toBeGreaterThanOrEqual(beforeTime);
      expect(parsed.timestamp).toBeLessThanOrEqual(Date.now());
    });

    it('handles storage errors gracefully', async () => {
      mockAsyncStorage.setItem.mockRejectedValueOnce(new Error('Storage full'));

      // Should not throw
      await expect(savePendingShare('https://example.com')).resolves.not.toThrow();
    });
  });

  describe('getPendingShare', () => {
    it('returns stored pending share', async () => {
      const storedData = {
        url: 'https://vm.tiktok.com/abc123',
        timestamp: Date.now(),
      };
      mockAsyncStorage.getItem.mockResolvedValueOnce(JSON.stringify(storedData));

      const result = await getPendingShare();

      expect(result).toEqual(storedData);
    });

    it('returns null when no pending share exists', async () => {
      mockAsyncStorage.getItem.mockResolvedValueOnce(null);

      const result = await getPendingShare();

      expect(result).toBeNull();
    });

    it('returns null for expired shares (older than 24 hours)', async () => {
      const expiredData = {
        url: 'https://vm.tiktok.com/abc123',
        timestamp: Date.now() - 25 * 60 * 60 * 1000, // 25 hours ago
      };
      mockAsyncStorage.getItem.mockResolvedValueOnce(JSON.stringify(expiredData));

      const result = await getPendingShare();

      expect(result).toBeNull();
      // Should clear expired data
      expect(mockAsyncStorage.removeItem).toHaveBeenCalledWith('share_extension_pending_url');
    });

    it('handles storage errors gracefully', async () => {
      mockAsyncStorage.getItem.mockRejectedValueOnce(new Error('Storage error'));

      const result = await getPendingShare();

      expect(result).toBeNull();
    });
  });

  describe('clearPendingShare', () => {
    it('removes pending share from AsyncStorage', async () => {
      await clearPendingShare();

      expect(mockAsyncStorage.removeItem).toHaveBeenCalledWith('share_extension_pending_url');
    });

    it('handles storage errors gracefully', async () => {
      mockAsyncStorage.removeItem.mockRejectedValueOnce(new Error('Storage error'));

      await expect(clearPendingShare()).resolves.not.toThrow();
    });
  });

  describe('markShareProcessed', () => {
    it('saves URL and timestamp to mark as processed', async () => {
      const testUrl = 'https://vm.tiktok.com/abc123';
      const beforeTime = Date.now();

      await markShareProcessed(testUrl);

      expect(mockAsyncStorage.setItem).toHaveBeenCalledTimes(1);
      const [key, value] = mockAsyncStorage.setItem.mock.calls[0];
      expect(key).toBe('share_extension_last_processed');

      const parsed = JSON.parse(value);
      expect(parsed.url).toBe(testUrl);
      expect(parsed.timestamp).toBeGreaterThanOrEqual(beforeTime);
    });
  });

  describe('wasRecentlyProcessed', () => {
    it('returns true for same URL processed within 5 seconds', async () => {
      const testUrl = 'https://vm.tiktok.com/abc123';
      const recentTimestamp = Date.now() - 2000; // 2 seconds ago

      mockAsyncStorage.getItem.mockResolvedValueOnce(
        JSON.stringify({ url: testUrl, timestamp: recentTimestamp })
      );

      const result = await wasRecentlyProcessed(testUrl);

      expect(result).toBe(true);
    });

    it('returns false for same URL processed more than 5 seconds ago', async () => {
      const testUrl = 'https://vm.tiktok.com/abc123';
      const oldTimestamp = Date.now() - 10000; // 10 seconds ago

      mockAsyncStorage.getItem.mockResolvedValueOnce(
        JSON.stringify({ url: testUrl, timestamp: oldTimestamp })
      );

      const result = await wasRecentlyProcessed(testUrl);

      expect(result).toBe(false);
    });

    it('returns false for different URL even if recent', async () => {
      const recentTimestamp = Date.now() - 2000; // 2 seconds ago

      mockAsyncStorage.getItem.mockResolvedValueOnce(
        JSON.stringify({ url: 'https://different.com', timestamp: recentTimestamp })
      );

      const result = await wasRecentlyProcessed('https://vm.tiktok.com/abc123');

      expect(result).toBe(false);
    });

    it('returns false when no processed share exists', async () => {
      mockAsyncStorage.getItem.mockResolvedValueOnce(null);

      const result = await wasRecentlyProcessed('https://vm.tiktok.com/abc123');

      expect(result).toBe(false);
    });

    it('returns false on storage error', async () => {
      mockAsyncStorage.getItem.mockRejectedValueOnce(new Error('Storage error'));

      const result = await wasRecentlyProcessed('https://vm.tiktok.com/abc123');

      expect(result).toBe(false);
    });
  });
});
