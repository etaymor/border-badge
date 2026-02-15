/**
 * Ad Events Service - Unified conversion tracking for Facebook & TikTok
 *
 * Fires events to Facebook SDK (client-side) and sends them to the backend
 * for server-side fan-out to Facebook CAPI and TikTok Events API.
 *
 * - "First-only" events use AsyncStorage flags with in-memory locks to fire once per user lifetime.
 * - All events are gated behind isProduction — no firing in development.
 * - Errors are caught and logged, never blocking user flow.
 */

import { AppEventsLogger } from 'react-native-fbsdk-next';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';

import { api } from './api';
import { isProduction } from '@config/env';

const FIRST_EVENT_PREFIX = '@adEvents:tracked:';

// In-memory locks to prevent concurrent first-time event races.
// If two calls to accountCreated() overlap, only the first proceeds.
const _pendingLocks = new Set<string>();

async function checkAndMarkOnce(key: string): Promise<boolean> {
  const fullKey = `${FIRST_EVENT_PREFIX}${key}`;

  // Fast path: if another call is already in flight, bail out
  if (_pendingLocks.has(key)) return false;

  _pendingLocks.add(key);
  try {
    const val = await AsyncStorage.getItem(fullKey);
    if (val === 'true') return false;

    await AsyncStorage.setItem(fullKey, 'true');
    return true;
  } finally {
    _pendingLocks.delete(key);
  }
}

function generateEventId(event: string): string {
  const uuid = Crypto.randomUUID();
  return `${event}_${uuid}`;
}

async function sendToServer(
  eventName: string,
  eventId: string,
  properties?: Record<string, unknown>
): Promise<void> {
  try {
    await api.post('/ad-events', {
      event_name: eventName,
      event_id: eventId,
      properties: properties ?? {},
    });
  } catch (error) {
    console.warn('[AdEvents] Server-side event failed:', error);
  }
}

export const AdEvents = {
  /** Event 2: Account created (first time only) */
  async accountCreated(method: 'email' | 'apple' | 'google'): Promise<void> {
    const shouldFire = await checkAndMarkOnce('account_created');
    if (!shouldFire) return;
    if (!isProduction) {
      console.log('[AdEvents] accountCreated', { method });
      return;
    }

    const eventId = generateEventId('complete_registration');

    AppEventsLogger.logEvent('fb_mobile_complete_registration', {
      fb_registration_method: method,
    });

    await sendToServer('CompleteRegistration', eventId, { method });
  },

  /** Event 3a: Trial started (first time only) */
  async trialStarted(plan: string): Promise<void> {
    const shouldFire = await checkAndMarkOnce('trial_started');
    if (!shouldFire) return;
    if (!isProduction) {
      console.log('[AdEvents] trialStarted', { plan });
      return;
    }

    const eventId = generateEventId('start_trial');

    AppEventsLogger.logEvent('StartTrial', {
      fb_content_id: plan,
      fb_currency: 'USD',
    });

    await sendToServer('StartTrial', eventId, { plan, is_trial: true });
  },

  /** Event 3b: Subscription purchased (fires every time) */
  async subscriptionPurchased(plan: string, price: number, currency: string): Promise<void> {
    if (!isProduction) {
      console.log('[AdEvents] subscriptionPurchased', { plan, price, currency });
      return;
    }

    const eventId = generateEventId('subscribe');
    const hasPrice = price > 0;

    if (hasPrice) {
      AppEventsLogger.logPurchase(price, currency, {
        fb_content_type: 'subscription',
        fb_content_id: plan,
      });
      AppEventsLogger.logEvent('Subscribe', price, {
        fb_currency: currency,
        fb_content_id: plan,
      });
    } else {
      // Fire event without revenue to avoid distorting ROAS with $0 values
      AppEventsLogger.logEvent('Subscribe', { fb_content_id: plan });
    }

    const serverProps: Record<string, unknown> = { plan };
    if (hasPrice) {
      serverProps.price = price;
      serverProps.currency = currency;
    }
    await sendToServer('Subscribe', eventId, serverProps);
  },

  /** Event 4: First trip created (first time only) */
  async firstTripCreated(countryCode: string): Promise<void> {
    const shouldFire = await checkAndMarkOnce('first_trip');
    if (!shouldFire) return;
    if (!isProduction) {
      console.log('[AdEvents] firstTripCreated', { countryCode });
      return;
    }

    const eventId = generateEventId('first_trip_created');

    AppEventsLogger.logEvent('FirstTripCreated', { country_code: countryCode });

    await sendToServer('FirstTripCreated', eventId, { country_code: countryCode });
  },

  /** Event 5: First photo import completed (first time only) */
  async firstPhotoImportDone(clusterCount: number): Promise<void> {
    const shouldFire = await checkAndMarkOnce('first_photo_import');
    if (!shouldFire) return;
    if (!isProduction) {
      console.log('[AdEvents] firstPhotoImportDone', { clusterCount });
      return;
    }

    const eventId = generateEventId('first_photo_import');

    AppEventsLogger.logEvent('FirstPhotoImport', { cluster_count: clusterCount });

    await sendToServer('FirstPhotoImport', eventId, { cluster_count: clusterCount });
  },

  /** Set Facebook user ID for better event matching */
  setUserId(userId: string): void {
    if (!isProduction) return;
    AppEventsLogger.setUserID(userId);
  },

  /** Clear Facebook user data on sign-out */
  clearUserId(): void {
    if (!isProduction) return;
    AppEventsLogger.clearUserID();
  },
};
