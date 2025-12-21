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
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useSettingsStore, selectClipboardDetectionEnabled } from '@stores/settingsStore';
import { useAuthStore } from '@stores/authStore';

/** Key for tracking if user has been notified about clipboard permission issues */
const CLIPBOARD_PERMISSION_NOTIFIED_KEY = 'clipboard_permission_notified';

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

export type SocialProvider = 'tiktok' | 'instagram';

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
  /** Call to acknowledge the permission error (won't show again) */
  acknowledgePermissionError: () => void;
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
  const hasCheckedPermissionNotifiedRef = useRef(false);

  // Check if user was already notified about clipboard permissions
  useEffect(() => {
    const checkNotified = async () => {
      if (hasCheckedPermissionNotifiedRef.current) return;
      hasCheckedPermissionNotifiedRef.current = true;

      try {
        const notified = await AsyncStorage.getItem(CLIPBOARD_PERMISSION_NOTIFIED_KEY);
        if (notified === 'true') {
          // User was already notified, don't show error again
          setHasPermissionError(false);
        }
      } catch {
        // Ignore storage errors
      }
    };
    void checkNotified();
  }, []);

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
      // Clipboard access failed - likely a permissions issue
      // On iOS 14+, clipboard access requires user permission
      if (__DEV__) {
        console.warn('[ClipboardListener] Failed to check clipboard:', error);
      }

      // Only show permission error on iOS where clipboard prompts are common
      // and only if user hasn't been notified before
      if (Platform.OS === 'ios') {
        try {
          const notified = await AsyncStorage.getItem(CLIPBOARD_PERMISSION_NOTIFIED_KEY);
          if (notified !== 'true') {
            setHasPermissionError(true);
          }
        } catch {
          // If we can't check storage, show the error anyway
          setHasPermissionError(true);
        }
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

  /**
   * Acknowledge the permission error (user has been notified).
   * Persists to storage so we don't show the message again.
   */
  const acknowledgePermissionError = useCallback(async () => {
    setHasPermissionError(false);
    try {
      await AsyncStorage.setItem(CLIPBOARD_PERMISSION_NOTIFIED_KEY, 'true');
    } catch {
      // Ignore storage errors
    }
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
