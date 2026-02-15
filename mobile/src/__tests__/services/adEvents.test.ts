/**
 * Tests for the Ad Events service.
 *
 * Covers event ID generation, first-time event deduplication,
 * race condition prevention, production gating, and server-side dispatch.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppEventsLogger } from 'react-native-fbsdk-next';

jest.mock('@react-native-async-storage/async-storage');
const mockAsyncStorage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;

jest.mock('react-native-fbsdk-next', () => ({
  AppEventsLogger: {
    logEvent: jest.fn(),
    logPurchase: jest.fn(),
    setUserID: jest.fn(),
    clearUserID: jest.fn(),
  },
}));

jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => 'mock-uuid-abcd1234'),
}));

// Default: production mode ON so events fire
const mockIsProduction = { value: true };
jest.mock('@config/env', () => ({
  get isProduction() {
    return mockIsProduction.value;
  },
}));

jest.mock('@services/api', () => ({
  api: {
    post: jest.fn().mockResolvedValue({ data: { status: 'ok' } }),
  },
}));

// Must import AFTER mocks are set up
import { AdEvents } from '@services/adEvents';
import { api } from '@services/api';

const mockApi = api as jest.Mocked<typeof api>;

describe('adEvents', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsProduction.value = true;
    // Default: no prior tracking flags
    mockAsyncStorage.getItem.mockResolvedValue(null);
  });

  describe('generateEventId', () => {
    it('generates IDs using crypto-secure randomUUID, not Math.random', async () => {
      await AdEvents.accountCreated('email');

      // The event ID sent to server should contain the UUID from expo-crypto
      const postCall = mockApi.post.mock.calls[0];
      const body = postCall[1] as { event_id: string };
      expect(body.event_id).toContain('mock-uuid-abcd1234');
    });

    it('includes the event name as prefix', async () => {
      await AdEvents.accountCreated('email');

      const postCall = mockApi.post.mock.calls[0];
      const body = postCall[1] as { event_id: string };
      expect(body.event_id).toMatch(/^complete_registration_/);
    });
  });

  describe('first-time event deduplication', () => {
    it('fires accountCreated only once per user lifetime', async () => {
      await AdEvents.accountCreated('email');

      expect(AppEventsLogger.logEvent).toHaveBeenCalledTimes(1);
      expect(mockApi.post).toHaveBeenCalledTimes(1);

      // Second call: simulate flag already set
      mockAsyncStorage.getItem.mockResolvedValue('true');
      await AdEvents.accountCreated('email');

      // Should NOT have fired again
      expect(AppEventsLogger.logEvent).toHaveBeenCalledTimes(1);
      expect(mockApi.post).toHaveBeenCalledTimes(1);
    });

    it('fires trialStarted only once per user lifetime', async () => {
      await AdEvents.trialStarted('premium_annual');

      expect(AppEventsLogger.logEvent).toHaveBeenCalledTimes(1);
      expect(mockApi.post).toHaveBeenCalledTimes(1);

      mockAsyncStorage.getItem.mockResolvedValue('true');
      await AdEvents.trialStarted('premium_annual');

      expect(AppEventsLogger.logEvent).toHaveBeenCalledTimes(1);
      expect(mockApi.post).toHaveBeenCalledTimes(1);
    });

    it('fires firstTripCreated only once per user lifetime', async () => {
      await AdEvents.firstTripCreated('US');

      expect(AppEventsLogger.logEvent).toHaveBeenCalledTimes(1);
      expect(mockApi.post).toHaveBeenCalledTimes(1);

      mockAsyncStorage.getItem.mockResolvedValue('true');
      await AdEvents.firstTripCreated('US');

      expect(AppEventsLogger.logEvent).toHaveBeenCalledTimes(1);
    });

    it('fires firstPhotoImportDone only once per user lifetime', async () => {
      await AdEvents.firstPhotoImportDone(5);

      expect(AppEventsLogger.logEvent).toHaveBeenCalledTimes(1);

      mockAsyncStorage.getItem.mockResolvedValue('true');
      await AdEvents.firstPhotoImportDone(5);

      expect(AppEventsLogger.logEvent).toHaveBeenCalledTimes(1);
    });
  });

  describe('race condition prevention', () => {
    it('prevents duplicate accountCreated when called concurrently', async () => {
      // Simulate slow AsyncStorage reads so both calls overlap
      let resolveFirst!: (v: string | null) => void;

      mockAsyncStorage.getItem.mockImplementation(
        () =>
          new Promise((r) => {
            resolveFirst = r;
          })
      );

      const p1 = AdEvents.accountCreated('email');
      const p2 = AdEvents.accountCreated('email');

      // The first call acquires the lock and waits on getItem.
      // The second call sees the lock and returns immediately.
      resolveFirst(null);

      await Promise.allSettled([p1, p2]);

      // With the in-memory lock, only one should fire
      expect(mockApi.post).toHaveBeenCalledTimes(1);
    });
  });

  describe('subscriptionPurchased', () => {
    it('fires every time (not first-only)', async () => {
      await AdEvents.subscriptionPurchased('premium_annual', 49.99, 'USD');
      await AdEvents.subscriptionPurchased('premium_annual', 49.99, 'USD');

      expect(mockApi.post).toHaveBeenCalledTimes(2);
    });

    it('sends revenue via logPurchase when price > 0', async () => {
      await AdEvents.subscriptionPurchased('premium_annual', 49.99, 'USD');

      expect(AppEventsLogger.logPurchase).toHaveBeenCalledWith(49.99, 'USD', expect.any(Object));
    });

    it('skips logPurchase when price is 0', async () => {
      await AdEvents.subscriptionPurchased('premium_annual', 0, 'USD');

      expect(AppEventsLogger.logPurchase).not.toHaveBeenCalled();
      // Still fires the event without revenue
      expect(AppEventsLogger.logEvent).toHaveBeenCalledWith('Subscribe', {
        fb_content_id: 'premium_annual',
      });
    });

    it('sends price to server when > 0', async () => {
      await AdEvents.subscriptionPurchased('premium_annual', 49.99, 'USD');

      const body = mockApi.post.mock.calls[0][1] as { properties: Record<string, unknown> };
      expect(body.properties).toEqual(
        expect.objectContaining({ plan: 'premium_annual', price: 49.99, currency: 'USD' })
      );
    });

    it('omits price from server when 0', async () => {
      await AdEvents.subscriptionPurchased('premium_annual', 0, 'USD');

      const body = mockApi.post.mock.calls[0][1] as { properties: Record<string, unknown> };
      expect(body.properties).not.toHaveProperty('price');
      expect(body.properties).not.toHaveProperty('currency');
    });
  });

  describe('server dispatch', () => {
    it('sends correct payload to /ad-events', async () => {
      await AdEvents.accountCreated('apple');

      expect(mockApi.post).toHaveBeenCalledWith('/ad-events', {
        event_name: 'CompleteRegistration',
        event_id: expect.stringContaining('complete_registration_'),
        properties: { method: 'apple' },
      });
    });

    it('does not throw when server call fails', async () => {
      mockApi.post.mockRejectedValueOnce(new Error('Network error'));

      // Should not throw
      await expect(AdEvents.accountCreated('email')).resolves.not.toThrow();
    });
  });

  describe('production gating', () => {
    it('does not fire Facebook SDK events in development', async () => {
      mockIsProduction.value = false;

      await AdEvents.accountCreated('email');

      expect(AppEventsLogger.logEvent).not.toHaveBeenCalled();
      expect(mockApi.post).not.toHaveBeenCalled();
    });

    it('still marks first-time flags in development', async () => {
      mockIsProduction.value = false;

      await AdEvents.accountCreated('email');

      // checkAndMarkOnce runs before the production check, so flag is set
      expect(mockAsyncStorage.setItem).toHaveBeenCalledWith(
        '@adEvents:tracked:account_created',
        'true'
      );
    });
  });

  describe('setUserId / clearUserId', () => {
    it('sets Facebook user ID in production', () => {
      AdEvents.setUserId('user-123');
      expect(AppEventsLogger.setUserID).toHaveBeenCalledWith('user-123');
    });

    it('clears Facebook user ID in production', () => {
      AdEvents.clearUserId();
      expect(AppEventsLogger.clearUserID).toHaveBeenCalled();
    });
  });
});
