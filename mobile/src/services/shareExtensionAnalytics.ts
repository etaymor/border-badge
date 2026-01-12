/**
 * Share Extension Analytics Sync Service
 *
 * Syncs analytics events queued by the iOS Share Extension to PostHog.
 * Events are stored in App Group UserDefaults by the extension and
 * synced when the main app comes to foreground.
 *
 * @see mobile/plugins/share-extension/Services/AnalyticsQueue.swift
 */

import { Platform, NativeModules } from 'react-native';

import { track } from './analytics';

/**
 * Analytics event from the iOS Share Extension
 */
interface ExtensionAnalyticsEvent {
  id: string;
  event: string;
  timestamp: number; // milliseconds since epoch
  properties?: Record<string, string | number | boolean | null>;
}

/**
 * Sync analytics events from iOS Share Extension to PostHog.
 *
 * Reads queued events from App Group storage, posts them to PostHog
 * via the existing analytics service, then clears the queue.
 *
 * Should be called on every app foreground alongside other sync operations.
 *
 * @returns Number of events synced, or 0 if none/unavailable
 */
export async function syncAnalyticsFromExtension(): Promise<number> {
  if (Platform.OS !== 'ios') return 0;

  const SharedGroupPreferences = NativeModules.SharedGroupPreferences;
  if (!SharedGroupPreferences) return 0;

  try {
    // Read analytics queue from App Group via native module
    const jsonString: string | null = await SharedGroupPreferences.getAnalyticsQueue();
    if (!jsonString) return 0;

    // Parse the JSON array of events
    const events: ExtensionAnalyticsEvent[] = JSON.parse(jsonString);
    if (!events.length) return 0;

    // Post each event to PostHog
    // Events are already filtered for expiry in the native module
    for (const event of events) {
      // Add source property to identify these came from the extension
      const properties = {
        ...event.properties,
        _source: 'share_extension',
        _original_timestamp: event.timestamp,
      };

      track(event.event, properties);
    }

    // Clear the queue after successful processing
    await SharedGroupPreferences.clearAnalyticsQueue();

    if (events.length > 0) {
      console.log(`[ShareExtensionAnalytics] Synced ${events.length} event(s) from extension`);
    }

    return events.length;
  } catch (error) {
    // Don't clear queue on failure - preserve for next sync attempt
    console.error('[ShareExtensionAnalytics] Failed to sync analytics from extension:', error);
    return 0;
  }
}
