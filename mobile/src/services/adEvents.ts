/**
 * Ad Events Service - Unified conversion tracking for Facebook & TikTok
 *
 * Fires events to Facebook SDK (client-side) and sends them to the backend
 * for server-side fan-out to Facebook CAPI and TikTok Events API.
 *
 * - "First-only" events use AsyncStorage flags to fire once per user lifetime.
 * - All events are gated behind isProduction — no firing in development.
 * - Errors are caught and logged, never blocking user flow.
 */

import { AppEventsLogger } from 'react-native-fbsdk-next';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { api } from './api';
import { isProduction } from '@config/env';

const FIRST_EVENT_PREFIX = '@adEvents:tracked:';

async function hasTrackedOnce(key: string): Promise<boolean> {
  const val = await AsyncStorage.getItem(`${FIRST_EVENT_PREFIX}${key}`);
  return val === 'true';
}

async function markTrackedOnce(key: string): Promise<void> {
  await AsyncStorage.setItem(`${FIRST_EVENT_PREFIX}${key}`, 'true');
}

function generateEventId(event: string): string {
  return `${event}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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
      timestamp: Math.floor(Date.now() / 1000),
    });
  } catch (error) {
    console.warn('[AdEvents] Server-side event failed:', error);
  }
}

export const AdEvents = {
  /** Event 2: Account created (first time only) */
  async accountCreated(method: 'email' | 'apple' | 'google'): Promise<void> {
    if (await hasTrackedOnce('account_created')) return;
    if (!isProduction) {
      console.log('[AdEvents] accountCreated', { method });
      await markTrackedOnce('account_created');
      return;
    }

    const eventId = generateEventId('complete_registration');

    AppEventsLogger.logEvent('fb_mobile_complete_registration', {
      fb_registration_method: method,
    });

    await sendToServer('CompleteRegistration', eventId, { method });
    await markTrackedOnce('account_created');
  },

  /** Event 3a: Trial started (first time only) */
  async trialStarted(plan: string): Promise<void> {
    if (await hasTrackedOnce('trial_started')) return;
    if (!isProduction) {
      console.log('[AdEvents] trialStarted', { plan });
      await markTrackedOnce('trial_started');
      return;
    }

    const eventId = generateEventId('start_trial');

    AppEventsLogger.logEvent('StartTrial', {
      fb_content_id: plan,
      fb_currency: 'USD',
    });

    await sendToServer('StartTrial', eventId, { plan, is_trial: true });
    await markTrackedOnce('trial_started');
  },

  /** Event 3b: Subscription purchased (fires every time) */
  async subscriptionPurchased(plan: string, price: number, currency: string): Promise<void> {
    if (!isProduction) {
      console.log('[AdEvents] subscriptionPurchased', { plan, price, currency });
      return;
    }

    const eventId = generateEventId('subscribe');

    AppEventsLogger.logPurchase(price, currency, {
      fb_content_type: 'subscription',
      fb_content_id: plan,
    });
    AppEventsLogger.logEvent('Subscribe', price, {
      fb_currency: currency,
      fb_content_id: plan,
    });

    await sendToServer('Subscribe', eventId, { plan, price, currency });
  },

  /** Event 4: First trip created (first time only) */
  async firstTripCreated(countryCode: string): Promise<void> {
    if (await hasTrackedOnce('first_trip')) return;
    if (!isProduction) {
      console.log('[AdEvents] firstTripCreated', { countryCode });
      await markTrackedOnce('first_trip');
      return;
    }

    const eventId = generateEventId('first_trip_created');

    AppEventsLogger.logEvent('FirstTripCreated', { country_code: countryCode });

    await sendToServer('FirstTripCreated', eventId, { country_code: countryCode });
    await markTrackedOnce('first_trip');
  },

  /** Event 5: First photo import completed (first time only) */
  async firstPhotoImportDone(clusterCount: number): Promise<void> {
    if (await hasTrackedOnce('first_photo_import')) return;
    if (!isProduction) {
      console.log('[AdEvents] firstPhotoImportDone', { clusterCount });
      await markTrackedOnce('first_photo_import');
      return;
    }

    const eventId = generateEventId('first_photo_import');

    AppEventsLogger.logEvent('FirstPhotoImport', { cluster_count: clusterCount });

    await sendToServer('FirstPhotoImport', eventId, { cluster_count: clusterCount });
    await markTrackedOnce('first_photo_import');
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
    AppEventsLogger.clearUserData();
  },
};
