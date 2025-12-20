/**
 * Tests for the Share Queue service.
 *
 * Tests the retry queue persistence, exponential backoff,
 * and queue flush behavior.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  enqueueFailedShare,
  getPendingShares,
  getPendingShareCount,
  dequeueShare,
  getNextRetryableShare,
  markRetryAttempt,
  flushQueue,
  clearExpiredShares,
  clearAllShares,
  getShareById,
  updateShare,
  type QueuedShare,
} from '@services/shareQueue';

// Mock AsyncStorage
jest.mock('@react-native-async-storage/async-storage');
const mockAsyncStorage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;

// Mock expo-crypto
jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => 'test-uuid-123'),
}));

describe('shareQueue', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('enqueueFailedShare', () => {
    it('adds share to queue with generated id and retry metadata', async () => {
      mockAsyncStorage.getItem.mockResolvedValueOnce(null);

      await enqueueFailedShare({
        url: 'https://vm.tiktok.com/abc123',
        source: 'clipboard',
        createdAt: Date.now(),
      });

      expect(mockAsyncStorage.setItem).toHaveBeenCalled();
      const [key, value] = mockAsyncStorage.setItem.mock.calls[0];
      expect(key).toBe('share_queue');

      const parsed = JSON.parse(value);
      expect(parsed).toHaveLength(1);
      expect(parsed[0]).toMatchObject({
        url: 'https://vm.tiktok.com/abc123',
        source: 'clipboard',
        retryCount: 0,
        lastRetryAt: null,
      });
      expect(parsed[0].id).toBe('test-uuid-123');
    });

    it('appends to existing queue', async () => {
      const existing: QueuedShare[] = [
        {
          id: '1',
          url: 'https://existing.com',
          source: 'clipboard',
          createdAt: Date.now(),
          retryCount: 0,
          lastRetryAt: null,
        },
      ];
      mockAsyncStorage.getItem.mockResolvedValueOnce(JSON.stringify(existing));

      await enqueueFailedShare({
        url: 'https://new.com',
        source: 'share_extension',
        createdAt: Date.now(),
      });

      const [, value] = mockAsyncStorage.setItem.mock.calls[0];
      const parsed = JSON.parse(value);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].url).toBe('https://existing.com');
      expect(parsed[1].url).toBe('https://new.com');
    });

    it('updates existing entry with same URL instead of duplicating', async () => {
      const existing: QueuedShare[] = [
        {
          id: 'existing-id',
          url: 'https://duplicate.com',
          source: 'clipboard',
          createdAt: Date.now() - 10000,
          retryCount: 2,
          lastRetryAt: Date.now() - 5000,
          error: 'Previous error',
        },
      ];
      mockAsyncStorage.getItem.mockResolvedValueOnce(JSON.stringify(existing));

      await enqueueFailedShare({
        url: 'https://duplicate.com',
        source: 'share_extension', // Different source
        createdAt: Date.now(),
        tripId: 'new-trip-id',
      });

      const [, value] = mockAsyncStorage.setItem.mock.calls[0];
      const parsed = JSON.parse(value);
      expect(parsed).toHaveLength(1);
      // Should preserve retry state
      expect(parsed[0].id).toBe('existing-id');
      expect(parsed[0].retryCount).toBe(2);
      // Should update other fields
      expect(parsed[0].source).toBe('share_extension');
      expect(parsed[0].tripId).toBe('new-trip-id');
    });

    it('handles storage errors gracefully', async () => {
      mockAsyncStorage.getItem.mockRejectedValueOnce(new Error('Storage error'));

      // Should not throw
      await expect(
        enqueueFailedShare({
          url: 'https://test.com',
          source: 'clipboard',
          createdAt: Date.now(),
        })
      ).resolves.not.toThrow();
    });
  });

  describe('getPendingShares', () => {
    it('returns empty array when queue is empty', async () => {
      mockAsyncStorage.getItem.mockResolvedValueOnce(null);

      const result = await getPendingShares();
      expect(result).toEqual([]);
    });

    it('returns all non-expired shares', async () => {
      const queue: QueuedShare[] = [
        {
          id: '1',
          url: 'https://test1.com',
          source: 'clipboard',
          createdAt: Date.now() - 1000,
          retryCount: 0,
          lastRetryAt: null,
        },
        {
          id: '2',
          url: 'https://test2.com',
          source: 'share_extension',
          createdAt: Date.now() - 2000,
          retryCount: 1,
          lastRetryAt: Date.now() - 1000,
        },
      ];
      mockAsyncStorage.getItem.mockResolvedValueOnce(JSON.stringify(queue));

      const result = await getPendingShares();
      expect(result).toHaveLength(2);
    });

    it('excludes expired shares (older than 7 days)', async () => {
      const now = Date.now();
      const eightDaysAgo = now - 8 * 24 * 60 * 60 * 1000;

      const queue: QueuedShare[] = [
        {
          id: '1',
          url: 'https://old.com',
          source: 'clipboard',
          createdAt: eightDaysAgo,
          retryCount: 0,
          lastRetryAt: null,
        },
        {
          id: '2',
          url: 'https://recent.com',
          source: 'clipboard',
          createdAt: now - 1000,
          retryCount: 0,
          lastRetryAt: null,
        },
      ];
      mockAsyncStorage.getItem.mockResolvedValueOnce(JSON.stringify(queue));

      const result = await getPendingShares();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('2');
    });
  });

  describe('getPendingShareCount', () => {
    it('returns count of pending shares', async () => {
      const queue: QueuedShare[] = [
        {
          id: '1',
          url: 'https://test1.com',
          source: 'clipboard',
          createdAt: Date.now(),
          retryCount: 0,
          lastRetryAt: null,
        },
        {
          id: '2',
          url: 'https://test2.com',
          source: 'clipboard',
          createdAt: Date.now(),
          retryCount: 0,
          lastRetryAt: null,
        },
      ];
      mockAsyncStorage.getItem.mockResolvedValueOnce(JSON.stringify(queue));

      const count = await getPendingShareCount();
      expect(count).toBe(2);
    });
  });

  describe('dequeueShare', () => {
    it('removes share from queue by id', async () => {
      const queue: QueuedShare[] = [
        {
          id: '1',
          url: 'https://test1.com',
          source: 'clipboard',
          createdAt: Date.now(),
          retryCount: 0,
          lastRetryAt: null,
        },
        {
          id: '2',
          url: 'https://test2.com',
          source: 'clipboard',
          createdAt: Date.now(),
          retryCount: 0,
          lastRetryAt: null,
        },
      ];
      mockAsyncStorage.getItem.mockResolvedValueOnce(JSON.stringify(queue));

      await dequeueShare('1');

      const [, value] = mockAsyncStorage.setItem.mock.calls[0];
      const parsed = JSON.parse(value);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].id).toBe('2');
    });

    it('handles non-existent id gracefully', async () => {
      const queue: QueuedShare[] = [
        {
          id: '1',
          url: 'https://test.com',
          source: 'clipboard',
          createdAt: Date.now(),
          retryCount: 0,
          lastRetryAt: null,
        },
      ];
      mockAsyncStorage.getItem.mockResolvedValueOnce(JSON.stringify(queue));

      await dequeueShare('non-existent');

      const [, value] = mockAsyncStorage.setItem.mock.calls[0];
      const parsed = JSON.parse(value);
      expect(parsed).toHaveLength(1);
    });
  });

  describe('getNextRetryableShare', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('returns null for empty queue', async () => {
      mockAsyncStorage.getItem.mockResolvedValueOnce(null);

      const result = await getNextRetryableShare();
      expect(result).toBeNull();
    });

    it('returns share with no previous retry attempts', async () => {
      const queue: QueuedShare[] = [
        {
          id: '1',
          url: 'https://test.com',
          source: 'clipboard',
          createdAt: Date.now(),
          retryCount: 0,
          lastRetryAt: null,
        },
      ];
      mockAsyncStorage.getItem.mockResolvedValueOnce(JSON.stringify(queue));

      const result = await getNextRetryableShare();
      expect(result?.id).toBe('1');
    });

    it('respects exponential backoff timing - not ready', async () => {
      const now = Date.now();
      jest.setSystemTime(now);

      const queue: QueuedShare[] = [
        {
          id: '1',
          url: 'https://test.com',
          source: 'clipboard',
          createdAt: now - 60000,
          retryCount: 2,
          lastRetryAt: now - 10000, // 10 seconds ago
        },
      ];
      mockAsyncStorage.getItem.mockResolvedValueOnce(JSON.stringify(queue));

      // With retryCount=2, backoff = 5000 * 2^2 = 20000ms
      // lastRetryAt was 10s ago, so not ready yet
      const result = await getNextRetryableShare();
      expect(result).toBeNull();
    });

    it('returns share when backoff period has passed', async () => {
      const now = Date.now();
      jest.setSystemTime(now);

      const queue: QueuedShare[] = [
        {
          id: '1',
          url: 'https://test.com',
          source: 'clipboard',
          createdAt: now - 60000,
          retryCount: 2,
          lastRetryAt: now - 25000, // 25 seconds ago
        },
      ];
      mockAsyncStorage.getItem.mockResolvedValueOnce(JSON.stringify(queue));

      // With retryCount=2, backoff = 5000 * 2^2 = 20000ms
      // lastRetryAt was 25s ago, so ready
      const result = await getNextRetryableShare();
      expect(result?.id).toBe('1');
    });

    it('skips shares that exceeded max retries', async () => {
      const queue: QueuedShare[] = [
        {
          id: '1',
          url: 'https://maxed-out.com',
          source: 'clipboard',
          createdAt: Date.now() - 200000,
          retryCount: 10, // MAX_RETRIES
          lastRetryAt: Date.now() - 100000,
        },
      ];
      mockAsyncStorage.getItem.mockResolvedValueOnce(JSON.stringify(queue));

      const result = await getNextRetryableShare();
      expect(result).toBeNull();
    });

    it('skips expired shares', async () => {
      const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;

      const queue: QueuedShare[] = [
        {
          id: '1',
          url: 'https://expired.com',
          source: 'clipboard',
          createdAt: eightDaysAgo,
          retryCount: 0,
          lastRetryAt: null,
        },
      ];
      mockAsyncStorage.getItem.mockResolvedValueOnce(JSON.stringify(queue));

      const result = await getNextRetryableShare();
      expect(result).toBeNull();
    });
  });

  describe('markRetryAttempt', () => {
    it('updates retryCount and lastRetryAt', async () => {
      const now = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(now);

      const queue: QueuedShare[] = [
        {
          id: '1',
          url: 'https://test.com',
          source: 'clipboard',
          createdAt: now - 10000,
          retryCount: 0,
          lastRetryAt: null,
        },
      ];
      mockAsyncStorage.getItem.mockResolvedValueOnce(JSON.stringify(queue));

      await markRetryAttempt('1', 'Network error');

      const [, value] = mockAsyncStorage.setItem.mock.calls[0];
      const parsed = JSON.parse(value);
      expect(parsed[0].retryCount).toBe(1);
      expect(parsed[0].lastRetryAt).toBe(now);
      expect(parsed[0].error).toBe('Network error');

      jest.spyOn(Date, 'now').mockRestore();
    });

    it('handles non-existent id gracefully', async () => {
      const queue: QueuedShare[] = [
        {
          id: '1',
          url: 'https://test.com',
          source: 'clipboard',
          createdAt: Date.now(),
          retryCount: 0,
          lastRetryAt: null,
        },
      ];
      mockAsyncStorage.getItem.mockResolvedValueOnce(JSON.stringify(queue));

      await markRetryAttempt('non-existent');

      // Should not have written anything since id wasn't found
      expect(mockAsyncStorage.setItem).not.toHaveBeenCalled();
    });
  });

  describe('clearExpiredShares', () => {
    it('removes shares older than 7 days', async () => {
      const now = Date.now();
      const eightDaysAgo = now - 8 * 24 * 60 * 60 * 1000;
      const twoDaysAgo = now - 2 * 24 * 60 * 60 * 1000;

      const queue: QueuedShare[] = [
        {
          id: '1',
          url: 'https://old.com',
          source: 'clipboard',
          createdAt: eightDaysAgo,
          retryCount: 0,
          lastRetryAt: null,
        },
        {
          id: '2',
          url: 'https://recent.com',
          source: 'clipboard',
          createdAt: twoDaysAgo,
          retryCount: 0,
          lastRetryAt: null,
        },
      ];
      mockAsyncStorage.getItem.mockResolvedValueOnce(JSON.stringify(queue));

      await clearExpiredShares();

      const [, value] = mockAsyncStorage.setItem.mock.calls[0];
      const parsed = JSON.parse(value);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].id).toBe('2');
    });

    it('does not write if nothing changed', async () => {
      const queue: QueuedShare[] = [
        {
          id: '1',
          url: 'https://recent.com',
          source: 'clipboard',
          createdAt: Date.now() - 1000,
          retryCount: 0,
          lastRetryAt: null,
        },
      ];
      mockAsyncStorage.getItem.mockResolvedValueOnce(JSON.stringify(queue));

      await clearExpiredShares();

      expect(mockAsyncStorage.setItem).not.toHaveBeenCalled();
    });
  });

  describe('clearAllShares', () => {
    it('removes the entire queue from storage', async () => {
      await clearAllShares();

      expect(mockAsyncStorage.removeItem).toHaveBeenCalledWith('share_queue');
    });
  });

  describe('flushQueue', () => {
    it('returns zeros when no retry function provided', async () => {
      mockAsyncStorage.getItem.mockResolvedValueOnce('[]');

      const result = await flushQueue();
      expect(result).toEqual({ succeeded: 0, failed: 0 });
    });

    it('processes retryable shares with provided function', async () => {
      const queue: QueuedShare[] = [
        {
          id: '1',
          url: 'https://test.com',
          source: 'clipboard',
          createdAt: Date.now(),
          retryCount: 0,
          lastRetryAt: null,
        },
      ];

      // First call for clearExpiredShares
      mockAsyncStorage.getItem.mockResolvedValueOnce(JSON.stringify(queue));
      // Second call for getNextRetryableShare (first iteration)
      mockAsyncStorage.getItem.mockResolvedValueOnce(JSON.stringify(queue));
      // Third call for dequeueShare
      mockAsyncStorage.getItem.mockResolvedValueOnce(JSON.stringify(queue));
      // Fourth call for getNextRetryableShare (second iteration, returns empty)
      mockAsyncStorage.getItem.mockResolvedValueOnce('[]');

      const retryFn = jest.fn().mockResolvedValue(true);
      const result = await flushQueue(retryFn);

      expect(retryFn).toHaveBeenCalledTimes(1);
      expect(result.succeeded).toBe(1);
      expect(result.failed).toBe(0);
    });

    it('marks failed retries', async () => {
      const queue: QueuedShare[] = [
        {
          id: '1',
          url: 'https://test.com',
          source: 'clipboard',
          createdAt: Date.now(),
          retryCount: 0,
          lastRetryAt: null,
        },
      ];

      // For clearExpiredShares
      mockAsyncStorage.getItem.mockResolvedValueOnce(JSON.stringify(queue));
      // For getNextRetryableShare (first)
      mockAsyncStorage.getItem.mockResolvedValueOnce(JSON.stringify(queue));
      // For markRetryAttempt
      mockAsyncStorage.getItem.mockResolvedValueOnce(JSON.stringify(queue));
      // For getNextRetryableShare (second, after marking - still not ready due to backoff)
      mockAsyncStorage.getItem.mockResolvedValueOnce('[]');

      const retryFn = jest.fn().mockResolvedValue(false);
      const result = await flushQueue(retryFn);

      expect(retryFn).toHaveBeenCalledTimes(1);
      expect(result.succeeded).toBe(0);
      expect(result.failed).toBe(1);
    });
  });

  describe('getShareById', () => {
    it('returns share when found', async () => {
      const queue: QueuedShare[] = [
        {
          id: '1',
          url: 'https://test.com',
          source: 'clipboard',
          createdAt: Date.now(),
          retryCount: 0,
          lastRetryAt: null,
        },
      ];
      mockAsyncStorage.getItem.mockResolvedValueOnce(JSON.stringify(queue));

      const result = await getShareById('1');
      expect(result?.id).toBe('1');
      expect(result?.url).toBe('https://test.com');
    });

    it('returns null when not found', async () => {
      mockAsyncStorage.getItem.mockResolvedValueOnce('[]');

      const result = await getShareById('non-existent');
      expect(result).toBeNull();
    });
  });

  describe('updateShare', () => {
    it('updates specified fields', async () => {
      const queue: QueuedShare[] = [
        {
          id: '1',
          url: 'https://test.com',
          source: 'clipboard',
          createdAt: Date.now(),
          retryCount: 0,
          lastRetryAt: null,
        },
      ];
      mockAsyncStorage.getItem.mockResolvedValueOnce(JSON.stringify(queue));

      await updateShare('1', {
        tripId: 'trip-123',
        entryType: 'food',
        notes: 'Great restaurant',
      });

      const [, value] = mockAsyncStorage.setItem.mock.calls[0];
      const parsed = JSON.parse(value);
      expect(parsed[0].tripId).toBe('trip-123');
      expect(parsed[0].entryType).toBe('food');
      expect(parsed[0].notes).toBe('Great restaurant');
      // Original fields preserved
      expect(parsed[0].url).toBe('https://test.com');
      expect(parsed[0].source).toBe('clipboard');
    });

    it('handles non-existent id gracefully', async () => {
      mockAsyncStorage.getItem.mockResolvedValueOnce('[]');

      await updateShare('non-existent', { tripId: 'trip-123' });

      expect(mockAsyncStorage.setItem).not.toHaveBeenCalled();
    });
  });
});
