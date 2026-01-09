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
 * The URL is also stored in App Group UserDefaults as a backup, though reading it
 * requires a native module that is not currently installed.
 */

import { Platform, NativeModules, Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Storage keys
const LAST_PROCESSED_KEY = 'share_extension_last_processed';
const PENDING_SHARE_KEY = 'share_extension_pending_url';

// In-memory cache to avoid AsyncStorage reads for duplicate detection
// This is populated on first check and updated when marking processed
let lastProcessedCache: { url: string; timestamp: number } | null = null;

/**
 * Reset the in-memory cache. Only for use in tests.
 * @internal
 */
export function __resetProcessedCache(): void {
  lastProcessedCache = null;
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
 * @param url - The deep link URL to check
 * @returns True if this is a share extension deep link
 */
export function isShareExtensionDeepLink(url: string | null): boolean {
  if (!url) return false;
  return url.startsWith('atlasi://share');
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
 * Marks the URL as processed and clears App Group storage.
 * Call this after successfully saving a share.
 *
 * @param url - The URL that was successfully processed
 */
export async function completeAppGroupShare(url: string): Promise<void> {
  await markShareProcessed(url);
  await clearSharedURLFromAppGroup();
}
