/**
 * Share Extension Bridge Service
 *
 * This service provides the React Native side of the iOS Share Extension integration.
 * It handles:
 * 1. Parsing shared URLs from deep link query parameters
 * 2. Processing deep links from the share extension
 * 3. Tracking processed shares to prevent duplicates
 *
 * The iOS Share Extension passes the shared URL as a query parameter in the deep link:
 * atlasi://share?url=<encoded_url>
 *
 * The URL is also stored in App Group UserDefaults as a backup.
 * The SharedGroupPreferences native module provides access to App Group data.
 */

import { Platform, NativeModules, Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Storage keys
const LAST_PROCESSED_KEY = 'share_extension_last_processed';
const PENDING_SHARE_KEY = 'share_extension_pending_url';

// In-memory cache to avoid AsyncStorage reads for duplicate detection
// This is populated on first check and updated when marking processed
let lastProcessedCache: { url: string; timestamp: number } | null = null;

// In-memory set of URLs currently being processed (to prevent race conditions)
// URLs are added here before navigation and removed after completion or failure
const processingUrls = new Set<string>();

/**
 * Reset the in-memory cache. Only for use in tests.
 * @internal
 */
export function __resetProcessedCache(): void {
  lastProcessedCache = null;
  processingUrls.clear();
}

/**
 * Interface for shared data from the extension
 */
export interface SharedData {
  url: string;
  timestamp: number;
}

/**
 * Check if the current deep link is from the share extension
 *
 * Supports both:
 * - Custom scheme: atlasi://share?url=...
 * - Universal Link: https://atlasi.app/share?url=...
 *
 * @param url - The deep link URL to check
 * @returns True if this is a share extension deep link
 */
export function isShareExtensionDeepLink(url: string | null): boolean {
  if (!url) return false;
  return url.startsWith('atlasi://share') || url.startsWith('https://atlasi.app/share');
}

/**
 * Parse URL parameters from a deep link
 *
 * @param url - The deep link URL
 * @returns Object containing parsed parameters
 */
export function parseDeepLinkParams(url: string): { url?: string; source?: string } {
  try {
    // Handle atlasi://share?url=encoded_url
    const urlObj = new URL(url);
    const params: { url?: string; source?: string } = {};

    if (urlObj.searchParams.has('url')) {
      params.url = decodeURIComponent(urlObj.searchParams.get('url') ?? '');
    }

    params.source = 'share_extension';
    return params;
  } catch {
    // If URL parsing fails, just return the source indicator
    return { source: 'share_extension' };
  }
}

/**
 * Save a pending share URL for later processing
 * Used when the app receives a share but user isn't authenticated
 *
 * @param url - The shared URL to save
 */
export async function savePendingShare(url: string): Promise<void> {
  try {
    const data: SharedData = {
      url,
      timestamp: Date.now(),
    };
    await AsyncStorage.setItem(PENDING_SHARE_KEY, JSON.stringify(data));
  } catch (error) {
    console.error('Failed to save pending share:', error);
  }
}

/**
 * Get any pending share that was saved while user was unauthenticated
 *
 * @returns The pending shared data, or null if none exists
 */
export async function getPendingShare(): Promise<SharedData | null> {
  try {
    const data = await AsyncStorage.getItem(PENDING_SHARE_KEY);
    if (!data) return null;

    const parsed = JSON.parse(data) as SharedData;

    // Expire pending shares after 24 hours
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    if (parsed.timestamp < oneDayAgo) {
      await clearPendingShare();
      return null;
    }

    return parsed;
  } catch (error) {
    console.error('Failed to get pending share:', error);
    return null;
  }
}

/**
 * Clear any pending share after it has been processed
 */
export async function clearPendingShare(): Promise<void> {
  try {
    await AsyncStorage.removeItem(PENDING_SHARE_KEY);
  } catch (error) {
    console.error('Failed to clear pending share:', error);
  }
}

/**
 * Mark a share as processed to prevent duplicate handling
 *
 * @param url - The URL that was processed
 */
export async function markShareProcessed(url: string): Promise<void> {
  try {
    const data = {
      url,
      timestamp: Date.now(),
    };
    // Update in-memory cache immediately for fast duplicate detection
    lastProcessedCache = data;
    await AsyncStorage.setItem(LAST_PROCESSED_KEY, JSON.stringify(data));
  } catch (error) {
    console.error('Failed to mark share as processed:', error);
  }
}

/**
 * Check if a URL is currently being processed (prevents race conditions)
 *
 * @param url - The URL to check
 * @returns True if this URL is currently being processed
 */
export function isCurrentlyProcessing(url: string): boolean {
  return processingUrls.has(url);
}

/**
 * Mark a URL as currently being processed (call before navigation)
 * This prevents race conditions when multiple events trigger processing.
 *
 * @param url - The URL being processed
 */
export function markAsProcessing(url: string): void {
  processingUrls.add(url);
}

/**
 * Clear a URL from the processing set (call on failure/cancellation)
 * Note: On success, use completeAppGroupShare which also clears this.
 *
 * @param url - The URL to clear
 */
export function clearProcessingStatus(url: string): void {
  processingUrls.delete(url);
}

/**
 * Check if a share was recently processed (within last 5 seconds)
 * Uses in-memory cache to avoid AsyncStorage reads in common cases.
 * Falls back to AsyncStorage after app restart.
 *
 * @param url - The URL to check
 * @returns True if this URL was recently processed
 */
export async function wasRecentlyProcessed(url: string): Promise<boolean> {
  const fiveSecondsAgo = Date.now() - 5000;

  // Check in-memory cache first (fast path for same app session)
  if (
    lastProcessedCache &&
    lastProcessedCache.url === url &&
    lastProcessedCache.timestamp > fiveSecondsAgo
  ) {
    return true;
  }

  // Fall back to AsyncStorage (needed after app restart)
  try {
    const data = await AsyncStorage.getItem(LAST_PROCESSED_KEY);
    if (!data) return false;

    const parsed = JSON.parse(data);
    // Populate cache for future checks
    lastProcessedCache = parsed;

    return parsed.url === url && parsed.timestamp > fiveSecondsAgo;
  } catch {
    return false;
  }
}

/**
 * Get the initial URL if the app was opened via a deep link
 * Call this on app startup to check for pending shares
 *
 * @returns The initial deep link URL, or null if not applicable
 */
export async function getInitialShareURL(): Promise<string | null> {
  if (Platform.OS !== 'ios') return null;

  try {
    const url = await Linking.getInitialURL();
    if (url && isShareExtensionDeepLink(url)) {
      return url;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Read shared URL from iOS App Group storage
 *
 * This reads the URL saved by the Share Extension to App Group UserDefaults.
 *
 * @returns The shared URL from App Group, or null if not available
 */
export async function getSharedURLFromAppGroup(): Promise<string | null> {
  if (Platform.OS !== 'ios') return null;

  // Check if native module is available
  const SharedGroupPreferences = NativeModules.SharedGroupPreferences;
  if (!SharedGroupPreferences) {
    // Native module not installed
    return null;
  }

  try {
    const url = await SharedGroupPreferences.getItem('SharedURL');
    return url || null;
  } catch (error) {
    console.error('Failed to read from App Group:', error);
    return null;
  }
}

/**
 * Clear the shared URL from App Group storage after processing
 *
 * @returns Promise that resolves when cleared
 */
export async function clearSharedURLFromAppGroup(): Promise<void> {
  if (Platform.OS !== 'ios') return;

  const SharedGroupPreferences = NativeModules.SharedGroupPreferences;
  if (!SharedGroupPreferences) return;

  try {
    await SharedGroupPreferences.clearAll();
  } catch (error) {
    console.error('Failed to clear App Group:', error);
  }
}

/**
 * Complete processing of a share from App Group.
 * Marks the URL as processed, clears processing status, and clears App Group storage.
 * Call this after successfully saving a share.
 *
 * @param url - The URL that was successfully processed
 */
export async function completeAppGroupShare(url: string): Promise<void> {
  clearProcessingStatus(url);
  await markShareProcessed(url);
  await clearSharedURLFromAppGroup();
}

/**
 * Sync the API base URL to App Group storage for the Share Extension to use.
 * This should be called on app startup to ensure the extension has the correct URL.
 *
 * @param apiUrl - The API base URL (from EXPO_PUBLIC_API_URL)
 */
export async function syncApiUrlToAppGroup(apiUrl: string): Promise<void> {
  if (Platform.OS !== 'ios') return;

  const SharedGroupPreferences = NativeModules.SharedGroupPreferences;
  if (!SharedGroupPreferences) return;

  try {
    await SharedGroupPreferences.setItem('API_BASE_URL', apiUrl);
  } catch (error) {
    console.error('Failed to sync API URL to App Group:', error);
  }
}

// ============================================================================
// OFFLINE QUEUE SYNC
// ============================================================================

// Import mergeFromExtension here to avoid circular dependencies
// (shareQueue.ts exports types used here, but doesn't import from this file)
import { mergeFromExtension, type SwiftQueuedShare } from './shareQueue';

/**
 * Sync offline queue from iOS Share Extension to React Native queue.
 *
 * Reads items queued by the Share Extension (when user was unauthenticated or offline),
 * converts them to the TypeScript queue format, and merges them into AsyncStorage.
 * After successful merge, clears the Swift queue.
 *
 * This should be called on every app foreground to ensure shares queued by the
 * extension are picked up by the main app's retry logic.
 *
 * @returns Number of items synced, or 0 if none/unavailable
 */
export async function syncOfflineQueueFromExtension(): Promise<number> {
  if (Platform.OS !== 'ios') return 0;

  const SharedGroupPreferences = NativeModules.SharedGroupPreferences;
  if (!SharedGroupPreferences) return 0;

  try {
    // Read queue from App Group via native module
    const jsonString: string | null = await SharedGroupPreferences.getOfflineQueue();
    if (!jsonString) return 0;

    // Parse the JSON array of Swift shares
    const swiftShares: SwiftQueuedShare[] = JSON.parse(jsonString);
    if (!swiftShares.length) return 0;

    // Merge into TypeScript queue (handles deduplication and expiry)
    const count = await mergeFromExtension(swiftShares);

    // Clear the Swift queue after successful merge
    // We clear even if count is 0 (duplicates were updated but no new items added)
    await SharedGroupPreferences.clearOfflineQueue();

    if (count > 0) {
      console.log(`[ShareExtensionBridge] Synced ${count} share(s) from extension queue`);
    }

    return count;
  } catch (error) {
    console.error('Failed to sync offline queue from extension:', error);
    return 0;
  }
}
