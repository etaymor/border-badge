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
  isCurrentlyProcessing,
  markAsProcessing,
  clearProcessingStatus,
  completeAppGroupShare,
  syncApiUrlToAppGroup,
  syncShareExtensionUsageFromAppGroup,
  scheduleProcessingTimeout,
  __resetProcessedCache,
} from '@services/shareExtensionBridge';

import { useSettingsStore } from '@stores/settingsStore';

// Mock AsyncStorage
jest.mock('@react-native-async-storage/async-storage');
const mockAsyncStorage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;

// Mock Platform and NativeModules
// Must use inline mock functions since jest.mock is hoisted before variable declarations
jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  Linking: {
    getInitialURL: jest.fn(),
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  },
  NativeModules: {
    SharedGroupPreferences: {
      getItem: jest.fn().mockResolvedValue(null),
      setItem: jest.fn().mockResolvedValue(undefined),
      clearAll: jest.fn().mockResolvedValue(undefined),
    },
  },
}));

// Get reference to the mock after module initialization
const { NativeModules } = jest.requireMock('react-native');

describe('shareExtensionBridge', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __resetProcessedCache();
    // Reset settingsStore to initial state
    useSettingsStore.setState({
      clipboardDetectionEnabled: false,
      hasUsedShareExtension: false,
      shareExtensionTutorialDismissedAt: null,
    });
  });

  describe('isShareExtensionDeepLink', () => {
    it('returns true for atlasi://share', () => {
      expect(isShareExtensionDeepLink('atlasi://share')).toBe(true);
    });

    it('returns true for atlasi://share with query params', () => {
      expect(isShareExtensionDeepLink('atlasi://share?foo=bar')).toBe(true);
    });

    it('returns false for other atlasi deep links', () => {
      expect(isShareExtensionDeepLink('atlasi://other')).toBe(false);
      expect(isShareExtensionDeepLink('atlasi://settings')).toBe(false);
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
      const deepLink = 'atlasi://share?url=https%3A%2F%2Fvm.tiktok.com%2Fabc123';
      const params = parseDeepLinkParams(deepLink);
      expect(params.url).toBe('https://vm.tiktok.com/abc123');
      expect(params.source).toBe('share_extension');
    });

    it('handles deep links without URL param', () => {
      const params = parseDeepLinkParams('atlasi://share');
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

      // Clear any calls from store initialization
      mockAsyncStorage.setItem.mockClear();

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

      // Clear any calls from store initialization
      mockAsyncStorage.setItem.mockClear();

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

  describe('completeAppGroupShare', () => {
    it('marks URL as processed and clears App Group (calls both functions)', async () => {
      const testUrl = 'https://vm.tiktok.com/abc123';

      // Clear any calls from store initialization
      mockAsyncStorage.setItem.mockClear();

      await completeAppGroupShare(testUrl);

      // Should call markShareProcessed (which sets LAST_PROCESSED_KEY)
      expect(mockAsyncStorage.setItem).toHaveBeenCalledWith(
        'share_extension_last_processed',
        expect.any(String)
      );

      // Find the correct call that contains our URL (skip any store persistence calls)
      const shareProcessedCall = mockAsyncStorage.setItem.mock.calls.find(
        (call) => call[0] === 'share_extension_last_processed'
      );
      expect(shareProcessedCall).toBeDefined();

      // Verify the stored data contains the URL
      const storedData = JSON.parse(shareProcessedCall![1]);
      expect(storedData.url).toBe(testUrl);
      expect(storedData.timestamp).toBeDefined();

      // Verify App Group was cleared via native module
      expect(NativeModules.SharedGroupPreferences.clearAll).toHaveBeenCalled();
    });
  });

  describe('syncApiUrlToAppGroup', () => {
    it('writes API URL to App Group storage', async () => {
      const apiUrl = 'http://192.168.1.100:8000';

      await syncApiUrlToAppGroup(apiUrl);

      expect(NativeModules.SharedGroupPreferences.setItem).toHaveBeenCalledWith(
        'API_BASE_URL',
        apiUrl
      );
    });

    it('handles storage errors gracefully', async () => {
      NativeModules.SharedGroupPreferences.setItem.mockRejectedValueOnce(
        new Error('Storage error')
      );

      // Should not throw
      await expect(syncApiUrlToAppGroup('http://example.com')).resolves.not.toThrow();
    });
  });

  describe('syncShareExtensionUsageFromAppGroup', () => {
    beforeEach(() => {
      // Add the getHasUsedShareExtension method to the mock
      NativeModules.SharedGroupPreferences.getHasUsedShareExtension = jest
        .fn()
        .mockResolvedValue(false);
    });

    it('returns false and syncs to settingsStore when hasUsed is false', async () => {
      NativeModules.SharedGroupPreferences.getHasUsedShareExtension.mockResolvedValueOnce(false);

      const result = await syncShareExtensionUsageFromAppGroup();

      expect(result).toBe(false);
      expect(useSettingsStore.getState().hasUsedShareExtension).toBe(false);
    });

    it('returns true and syncs to settingsStore when hasUsed is true', async () => {
      NativeModules.SharedGroupPreferences.getHasUsedShareExtension.mockResolvedValueOnce(true);

      const result = await syncShareExtensionUsageFromAppGroup();

      expect(result).toBe(true);
      expect(useSettingsStore.getState().hasUsedShareExtension).toBe(true);
    });

    it('handles errors gracefully and returns false', async () => {
      NativeModules.SharedGroupPreferences.getHasUsedShareExtension.mockRejectedValueOnce(
        new Error('Native module error')
      );

      const result = await syncShareExtensionUsageFromAppGroup();

      expect(result).toBe(false);
      // Should not have changed the store on error
      expect(useSettingsStore.getState().hasUsedShareExtension).toBe(false);
    });
  });

  describe('processing state persistence (crash recovery)', () => {
    const testUrl = 'https://vm.tiktok.com/abc123';

    it('persists processing state to AsyncStorage when marking as processing', async () => {
      mockAsyncStorage.setItem.mockClear();

      await markAsProcessing(testUrl);

      expect(mockAsyncStorage.setItem).toHaveBeenCalledWith(
        'share_extension_processing',
        expect.any(String)
      );

      const storedData = JSON.parse(mockAsyncStorage.setItem.mock.calls[0][1]);
      expect(storedData.url).toBe(testUrl);
      expect(storedData.timestamp).toBeDefined();
    });

    it('detects processing state from AsyncStorage after simulated crash (in-memory lost)', async () => {
      // Simulate: mark as processing, then crash (reset in-memory state)
      await markAsProcessing(testUrl);
      const storedCall = mockAsyncStorage.setItem.mock.calls.find(
        (call) => call[0] === 'share_extension_processing'
      );
      const persistedJson = storedCall![1];

      // Simulate crash: clear in-memory state only
      __resetProcessedCache();

      // After crash, AsyncStorage still has the persisted state
      mockAsyncStorage.getItem.mockImplementation(async (key: string) => {
        if (key === 'share_extension_processing') return persistedJson;
        return null;
      });

      // isCurrentlyProcessing should find it in AsyncStorage
      const result = await isCurrentlyProcessing(testUrl);
      expect(result).toBe(true);
    });

    it('returns false for persisted processing state older than 2 minutes', async () => {
      const staleData = JSON.stringify({
        url: testUrl,
        timestamp: Date.now() - 6 * 60 * 1000, // 6 minutes ago
      });

      mockAsyncStorage.getItem.mockImplementation(async (key: string) => {
        if (key === 'share_extension_processing') return staleData;
        return null;
      });

      const result = await isCurrentlyProcessing(testUrl);
      expect(result).toBe(false);

      // Should have cleaned up the stale entry
      expect(mockAsyncStorage.removeItem).toHaveBeenCalledWith('share_extension_processing');
    });

    it('returns false for different URL even if persisted', async () => {
      const otherUrlData = JSON.stringify({
        url: 'https://different.com/xyz',
        timestamp: Date.now(),
      });

      mockAsyncStorage.getItem.mockImplementation(async (key: string) => {
        if (key === 'share_extension_processing') return otherUrlData;
        return null;
      });

      const result = await isCurrentlyProcessing(testUrl);
      expect(result).toBe(false);
    });

    it('clears persisted processing state on clearProcessingStatus', async () => {
      await markAsProcessing(testUrl);
      mockAsyncStorage.removeItem.mockClear();

      await clearProcessingStatus(testUrl);

      expect(mockAsyncStorage.removeItem).toHaveBeenCalledWith('share_extension_processing');
    });

    it('clears persisted processing state on completeAppGroupShare', async () => {
      await markAsProcessing(testUrl);
      mockAsyncStorage.removeItem.mockClear();
      mockAsyncStorage.setItem.mockClear();

      await completeAppGroupShare(testUrl);

      // Should clear persisted processing state
      expect(mockAsyncStorage.removeItem).toHaveBeenCalledWith('share_extension_processing');
    });

    it('processing state is cleared by timeout when navigation fails silently', async () => {
      jest.useFakeTimers();

      // Simulate: mark URL as processing, then never call completeAppGroupShare
      // (e.g., ShareCapture screen crashes or navigation fails)
      await markAsProcessing(testUrl);
      expect(await isCurrentlyProcessing(testUrl)).toBe(true);

      // Schedule the timeout (as checkAppGroupForSharedURL does on 'navigated' or 'queued')
      const cancel = scheduleProcessingTimeout(testUrl);

      // Advance past the 2-minute timeout
      jest.advanceTimersByTime(2 * 60 * 1000);

      // Processing state should now be auto-cleared, unblocking new shares
      expect(await isCurrentlyProcessing(testUrl)).toBe(false);

      cancel();
      jest.useRealTimers();
    });
  });

  describe('scheduleProcessingTimeout', () => {
    const testUrl = 'https://vm.tiktok.com/abc123';

    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('clears processing state after timeout expires', async () => {
      await markAsProcessing(testUrl);

      // Verify it's processing
      expect(await isCurrentlyProcessing(testUrl)).toBe(true);

      // Schedule the timeout
      const cancel = scheduleProcessingTimeout(testUrl);

      // Advance past the timeout (2 minutes)
      jest.advanceTimersByTime(2 * 60 * 1000);

      // Processing state should now be cleared
      expect(await isCurrentlyProcessing(testUrl)).toBe(false);

      cancel();
    });

    it('does not clear processing state before timeout', async () => {
      await markAsProcessing(testUrl);
      const cancel = scheduleProcessingTimeout(testUrl);

      // Advance 20 seconds (less than 30s in-memory TTL and well under 2min timeout)
      jest.advanceTimersByTime(20_000);

      // Should still be processing — timeout hasn't fired yet
      expect(await isCurrentlyProcessing(testUrl)).toBe(true);

      cancel();
    });

    it('can be cancelled before firing', async () => {
      await markAsProcessing(testUrl);
      const cancel = scheduleProcessingTimeout(testUrl);

      // Cancel before timeout fires
      cancel();

      // Advance 20 seconds (within in-memory TTL window so state is still valid)
      jest.advanceTimersByTime(20_000);

      // State should still be processing — cancel prevented the timeout cleanup
      expect(await isCurrentlyProcessing(testUrl)).toBe(true);
    });
  });
});
