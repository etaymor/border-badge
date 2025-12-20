/**
 * Hook to detect TikTok/Instagram URLs on clipboard when app comes to foreground.
 *
 * Features:
 * - Checks clipboard when app becomes active
 * - Respects user's opt-out preference from settings
 * - Only detects each URL once (clears after detection)
 * - Returns detected URL for display in ClipboardBanner
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import * as Clipboard from 'expo-clipboard';

import { useSettingsStore, selectClipboardDetectionEnabled } from '@stores/settingsStore';
import { useAuthStore } from '@stores/authStore';

/** URL patterns for social media platforms we support */
const TIKTOK_PATTERNS = [
  /^https?:\/\/(www\.|vm\.)?tiktok\.com\//i,
  /^https?:\/\/vt\.tiktok\.com\//i,
];

const INSTAGRAM_PATTERNS = [
  /^https?:\/\/(www\.)?instagram\.com\/(p|reel|reels)\//i,
  /^https?:\/\/instagr\.am\//i,
];

export type SocialProvider = 'tiktok' | 'instagram';

export interface DetectedClipboardUrl {
  url: string;
  provider: SocialProvider;
}

/**
 * Check if a URL matches TikTok or Instagram patterns.
 */
export function detectSocialUrl(text: string | null): DetectedClipboardUrl | null {
  if (!text) return null;

  const trimmed = text.trim();

  // Check TikTok patterns
  for (const pattern of TIKTOK_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { url: trimmed, provider: 'tiktok' };
    }
  }

  // Check Instagram patterns
  for (const pattern of INSTAGRAM_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { url: trimmed, provider: 'instagram' };
    }
  }

  return null;
}

/**
 * Hook to listen for TikTok/Instagram URLs on clipboard.
 *
 * @returns Object with detected URL info and dismiss handler
 */
export function useClipboardListener() {
  const [detectedUrl, setDetectedUrl] = useState<DetectedClipboardUrl | null>(null);
  const clipboardDetectionEnabled = useSettingsStore(selectClipboardDetectionEnabled);
  const { session } = useAuthStore();
  const lastCheckedUrlRef = useRef<string | null>(null);
  const appStateRef = useRef(AppState.currentState);

  const checkClipboard = useCallback(async () => {
    // Skip if detection is disabled or user not authenticated
    if (!clipboardDetectionEnabled || !session?.user?.id) {
      return;
    }

    try {
      const hasString = await Clipboard.hasStringAsync();
      if (!hasString) return;

      const clipboardContent = await Clipboard.getStringAsync();
      if (!clipboardContent) return;

      // Skip if we've already processed this URL
      if (clipboardContent === lastCheckedUrlRef.current) {
        return;
      }

      const detected = detectSocialUrl(clipboardContent);
      if (detected) {
        lastCheckedUrlRef.current = clipboardContent;
        setDetectedUrl(detected);
      }
    } catch (error) {
      // Clipboard access can fail silently (permissions, etc.)
      if (__DEV__) {
        console.warn('[ClipboardListener] Failed to check clipboard:', error);
      }
    }
  }, [clipboardDetectionEnabled, session?.user?.id]);

  // Listen for app state changes
  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      // Check clipboard when app comes to foreground
      if (appStateRef.current.match(/inactive|background/) && nextAppState === 'active') {
        void checkClipboard();
      }
      appStateRef.current = nextAppState;
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);

    // Also check on mount if app is already active
    if (AppState.currentState === 'active') {
      void checkClipboard();
    }

    return () => {
      subscription.remove();
    };
  }, [checkClipboard]);

  // Clear detection when settings change to disabled
  useEffect(() => {
    if (!clipboardDetectionEnabled) {
      setDetectedUrl(null);
    }
  }, [clipboardDetectionEnabled]);

  /**
   * Dismiss the detected URL (user chose not to save).
   * Clears the current detection without clearing lastCheckedUrlRef,
   * so the same URL won't be detected again this session.
   */
  const dismiss = useCallback(() => {
    setDetectedUrl(null);
  }, []);

  /**
   * Clear the detected URL after user acts on it.
   * Also clears lastCheckedUrlRef so fresh detection can occur.
   */
  const clear = useCallback(() => {
    setDetectedUrl(null);
    lastCheckedUrlRef.current = null;
  }, []);

  return {
    detectedUrl,
    dismiss,
    clear,
    isEnabled: clipboardDetectionEnabled,
  };
}
