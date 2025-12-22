/**
 * Hook to detect TikTok/Instagram URLs on clipboard when app comes to foreground.
 *
 * Features:
 * - Checks clipboard when app becomes active
 * - Respects user's opt-out preference from settings
 * - Only detects each URL once (clears after detection)
 * - Returns detected URL for display in ClipboardBanner
 * - Tracks clipboard access failures for UX feedback
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus, Platform } from 'react-native';
import * as Clipboard from 'expo-clipboard';

import { useSettingsStore, selectClipboardDetectionEnabled } from '@stores/settingsStore';
import { useAuthStore } from '@stores/authStore';
import type { SocialProvider } from '../types/shared';

export type { SocialProvider };

/**
 * Key for tracking if user dismissed the clipboard permission banner this session.
 * We use session-scoped tracking (not persistent) so the banner can reappear
 * if the user later enables clipboard permissions in Settings.
 */

/** Maximum URL length to prevent malicious clipboard hijacking */
const MAX_URL_LENGTH = 2048;

/** URL patterns for social media platforms we support */
const TIKTOK_PATTERNS = [
  /^https?:\/\/(www\.|vm\.)?tiktok\.com\//i,
  /^https?:\/\/vt\.tiktok\.com\//i,
];

const INSTAGRAM_PATTERNS = [
  /^https?:\/\/(www\.)?instagram\.com\/(p|reel|reels)\//i,
  /^https?:\/\/instagr\.am\//i,
];

export interface DetectedClipboardUrl {
  url: string;
  provider: SocialProvider;
}

/**
 * Check if a URL matches TikTok or Instagram patterns.
 * Validates URL length to prevent malicious clipboard hijacking.
 */
export function detectSocialUrl(text: string | null): DetectedClipboardUrl | null {
  if (!text) return null;

  const trimmed = text.trim();

  // Validate URL length to prevent malicious clipboard content
  if (trimmed.length > MAX_URL_LENGTH) {
    return null;
  }

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

export interface ClipboardListenerResult {
  detectedUrl: DetectedClipboardUrl | null;
  dismiss: () => void;
  clear: () => void;
  isEnabled: boolean;
  /** True if clipboard access has failed (permissions issue) */
  hasPermissionError: boolean;
  /** Call to dismiss the permission error banner (session-scoped, will reappear if permissions enabled) */
  acknowledgePermissionError: () => void;
}

/**
 * Check if clipboard access error should show permission banner.
 * Only shows on iOS where clipboard permission prompts are common.
 */
function shouldShowPermissionError(): boolean {
  return Platform.OS === 'ios';
}

/**
 * Hook to listen for TikTok/Instagram URLs on clipboard.
 *
 * @returns Object with detected URL info and dismiss handler
 */
export function useClipboardListener(): ClipboardListenerResult {
  const [detectedUrl, setDetectedUrl] = useState<DetectedClipboardUrl | null>(null);
  const [hasPermissionError, setHasPermissionError] = useState(false);
  const clipboardDetectionEnabled = useSettingsStore(selectClipboardDetectionEnabled);
  const { session } = useAuthStore();
  const lastCheckedUrlRef = useRef<string | null>(null);
  const appStateRef = useRef(AppState.currentState);
  // Track if user dismissed the permission banner this session
  const permissionBannerDismissedRef = useRef(false);

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

      // Clipboard access succeeded - clear any permission error
      // This handles the case where user enabled permissions in Settings
      if (hasPermissionError) {
        setHasPermissionError(false);
        permissionBannerDismissedRef.current = false;
      }

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
      // Clipboard access failed - likely a permissions issue
      // On iOS 14+, clipboard access requires user permission
      if (__DEV__) {
        console.warn('[ClipboardListener] Failed to check clipboard:', error);
      }

      // Show permission error if on iOS and user hasn't dismissed it this session
      if (shouldShowPermissionError() && !permissionBannerDismissedRef.current) {
        setHasPermissionError(true);
      }
    }
  }, [clipboardDetectionEnabled, session?.user?.id, hasPermissionError]);

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
   * Clear the detected URL after user acts on it (e.g., taps "Save").
   * Keeps lastCheckedUrlRef so the same URL won't trigger the banner again.
   */
  const clear = useCallback(() => {
    setDetectedUrl(null);
    // Note: We intentionally do NOT clear lastCheckedUrlRef here.
    // This prevents the banner from appearing again for the same URL
    // if it's still in the clipboard after the user saves.
  }, []);

  /**
   * Acknowledge the permission error (user dismissed the banner).
   * Session-scoped so the banner can reappear if user enables permissions in Settings.
   */
  const acknowledgePermissionError = useCallback(() => {
    setHasPermissionError(false);
    permissionBannerDismissedRef.current = true;
  }, []);

  return {
    detectedUrl,
    dismiss,
    clear,
    isEnabled: clipboardDetectionEnabled,
    hasPermissionError,
    acknowledgePermissionError,
  };
}
