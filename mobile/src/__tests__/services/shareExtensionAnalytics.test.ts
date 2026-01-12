/**
 * Tests for the Share Extension Analytics Sync service.
 *
 * Tests the syncAnalyticsFromExtension function that syncs analytics events
 * queued by the iOS Share Extension to PostHog.
 */

import { track } from '@services/analytics';

import { syncAnalyticsFromExtension } from '@services/shareExtensionAnalytics';

// Mock the analytics service
jest.mock('@services/analytics', () => ({
  track: jest.fn(),
}));
const mockTrack = track as jest.MockedFunction<typeof track>;

// Mock Platform and NativeModules
// Must use inline mock functions since jest.mock is hoisted before variable declarations
jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  NativeModules: {
    SharedGroupPreferences: {
      getAnalyticsQueue: jest.fn(),
      clearAnalyticsQueue: jest.fn(),
    },
  },
}));

// Get reference to the mock after module initialization
const { Platform, NativeModules } = jest.requireMock('react-native');

describe('shareExtensionAnalytics', () => {
  let consoleLogSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    Platform.OS = 'ios';
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('syncAnalyticsFromExtension', () => {
    describe('platform checks', () => {
      it('returns 0 when Platform.OS is not ios', async () => {
        Platform.OS = 'android';

        const result = await syncAnalyticsFromExtension();

        expect(result).toBe(0);
        expect(NativeModules.SharedGroupPreferences.getAnalyticsQueue).not.toHaveBeenCalled();
      });

      it('proceeds with sync when Platform.OS is ios', async () => {
        Platform.OS = 'ios';
        NativeModules.SharedGroupPreferences.getAnalyticsQueue.mockResolvedValueOnce(null);

        await syncAnalyticsFromExtension();

        expect(NativeModules.SharedGroupPreferences.getAnalyticsQueue).toHaveBeenCalled();
      });
    });

    describe('native module availability', () => {
      it('returns 0 when SharedGroupPreferences module is undefined', async () => {
        const originalModule = NativeModules.SharedGroupPreferences;
        NativeModules.SharedGroupPreferences = undefined;

        const result = await syncAnalyticsFromExtension();

        expect(result).toBe(0);

        // Restore for other tests
        NativeModules.SharedGroupPreferences = originalModule;
      });
    });

    describe('empty queue handling', () => {
      it('returns 0 when getAnalyticsQueue returns null', async () => {
        NativeModules.SharedGroupPreferences.getAnalyticsQueue.mockResolvedValueOnce(null);

        const result = await syncAnalyticsFromExtension();

        expect(result).toBe(0);
        expect(mockTrack).not.toHaveBeenCalled();
        expect(NativeModules.SharedGroupPreferences.clearAnalyticsQueue).not.toHaveBeenCalled();
      });

      it('returns 0 when getAnalyticsQueue returns empty array', async () => {
        NativeModules.SharedGroupPreferences.getAnalyticsQueue.mockResolvedValueOnce('[]');

        const result = await syncAnalyticsFromExtension();

        expect(result).toBe(0);
        expect(mockTrack).not.toHaveBeenCalled();
        expect(NativeModules.SharedGroupPreferences.clearAnalyticsQueue).not.toHaveBeenCalled();
      });
    });

    describe('successful sync and clear', () => {
      it('syncs events and returns correct count', async () => {
        const events = [
          { id: '1', event: 'share_started', timestamp: 1234567890 },
          { id: '2', event: 'share_completed', timestamp: 1234567891 },
        ];
        NativeModules.SharedGroupPreferences.getAnalyticsQueue.mockResolvedValueOnce(
          JSON.stringify(events)
        );
        NativeModules.SharedGroupPreferences.clearAnalyticsQueue.mockResolvedValueOnce(undefined);

        const result = await syncAnalyticsFromExtension();

        expect(result).toBe(2);
        expect(mockTrack).toHaveBeenCalledTimes(2);
      });

      it('calls clearAnalyticsQueue after successful processing', async () => {
        const events = [{ id: '1', event: 'test_event', timestamp: 1234567890 }];
        NativeModules.SharedGroupPreferences.getAnalyticsQueue.mockResolvedValueOnce(
          JSON.stringify(events)
        );
        NativeModules.SharedGroupPreferences.clearAnalyticsQueue.mockResolvedValueOnce(undefined);

        await syncAnalyticsFromExtension();

        expect(NativeModules.SharedGroupPreferences.clearAnalyticsQueue).toHaveBeenCalled();
      });

      it('logs sync count to console', async () => {
        const events = [
          { id: '1', event: 'event_one', timestamp: 1234567890 },
          { id: '2', event: 'event_two', timestamp: 1234567891 },
        ];
        NativeModules.SharedGroupPreferences.getAnalyticsQueue.mockResolvedValueOnce(
          JSON.stringify(events)
        );
        NativeModules.SharedGroupPreferences.clearAnalyticsQueue.mockResolvedValueOnce(undefined);

        await syncAnalyticsFromExtension();

        expect(consoleLogSpy).toHaveBeenCalledWith(
          '[ShareExtensionAnalytics] Synced 2 event(s) from extension'
        );
      });
    });

    describe('property preservation', () => {
      it('adds _source: share_extension to all events', async () => {
        const events = [{ id: '1', event: 'test_event', timestamp: 1234567890 }];
        NativeModules.SharedGroupPreferences.getAnalyticsQueue.mockResolvedValueOnce(
          JSON.stringify(events)
        );
        NativeModules.SharedGroupPreferences.clearAnalyticsQueue.mockResolvedValueOnce(undefined);

        await syncAnalyticsFromExtension();

        expect(mockTrack).toHaveBeenCalledWith(
          'test_event',
          expect.objectContaining({ _source: 'share_extension' })
        );
      });

      it('adds _original_timestamp with event original timestamp', async () => {
        const timestamp = 1234567890;
        const events = [{ id: '1', event: 'test_event', timestamp }];
        NativeModules.SharedGroupPreferences.getAnalyticsQueue.mockResolvedValueOnce(
          JSON.stringify(events)
        );
        NativeModules.SharedGroupPreferences.clearAnalyticsQueue.mockResolvedValueOnce(undefined);

        await syncAnalyticsFromExtension();

        expect(mockTrack).toHaveBeenCalledWith(
          'test_event',
          expect.objectContaining({ _original_timestamp: timestamp })
        );
      });

      it('preserves existing properties from events', async () => {
        const events = [
          {
            id: '1',
            event: 'share_completed',
            timestamp: 1234567890,
            properties: { url: 'https://example.com', success: true },
          },
        ];
        NativeModules.SharedGroupPreferences.getAnalyticsQueue.mockResolvedValueOnce(
          JSON.stringify(events)
        );
        NativeModules.SharedGroupPreferences.clearAnalyticsQueue.mockResolvedValueOnce(undefined);

        await syncAnalyticsFromExtension();

        expect(mockTrack).toHaveBeenCalledWith('share_completed', {
          url: 'https://example.com',
          success: true,
          _source: 'share_extension',
          _original_timestamp: 1234567890,
        });
      });
    });

    describe('error handling', () => {
      it('returns 0 on JSON parse failure', async () => {
        NativeModules.SharedGroupPreferences.getAnalyticsQueue.mockResolvedValueOnce(
          'invalid json {'
        );

        const result = await syncAnalyticsFromExtension();

        expect(result).toBe(0);
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          '[ShareExtensionAnalytics] Failed to sync analytics from extension:',
          expect.any(Error)
        );
      });

      it('returns 0 when getAnalyticsQueue throws', async () => {
        NativeModules.SharedGroupPreferences.getAnalyticsQueue.mockRejectedValueOnce(
          new Error('Native module error')
        );

        const result = await syncAnalyticsFromExtension();

        expect(result).toBe(0);
        expect(consoleErrorSpy).toHaveBeenCalled();
      });

      it('does NOT clear queue when processing fails', async () => {
        NativeModules.SharedGroupPreferences.getAnalyticsQueue.mockResolvedValueOnce(
          'invalid json'
        );

        await syncAnalyticsFromExtension();

        expect(NativeModules.SharedGroupPreferences.clearAnalyticsQueue).not.toHaveBeenCalled();
      });

      it('logs error to console on failure', async () => {
        NativeModules.SharedGroupPreferences.getAnalyticsQueue.mockRejectedValueOnce(
          new Error('Test error')
        );

        await syncAnalyticsFromExtension();

        expect(consoleErrorSpy).toHaveBeenCalledWith(
          '[ShareExtensionAnalytics] Failed to sync analytics from extension:',
          expect.any(Error)
        );
      });
    });
  });
});
