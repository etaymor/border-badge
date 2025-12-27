/**
 * ClipboardPasteButton - Native iOS paste button that bypasses permission prompts.
 *
 * Uses Apple's UIPasteControl (via expo-clipboard) which allows users to paste
 * clipboard content without triggering the "Allow Paste" permission dialog.
 *
 * Only available on iOS 16+. Returns null on unsupported platforms.
 */

import { useCallback } from 'react';
import { StyleSheet, View, Platform } from 'react-native';
import {
  ClipboardPasteButton as ExpoClipboardPasteButton,
  isPasteButtonAvailable,
} from 'expo-clipboard';
import * as Haptics from 'expo-haptics';

import { colors } from '@constants/colors';
import { detectSocialUrl, type DetectedClipboardUrl } from '@hooks/useClipboardListener';

interface Props {
  /** Called when a valid TikTok/Instagram URL is detected from paste */
  onDetect: (detected: DetectedClipboardUrl) => void;
  /** Called when paste contains no valid URL */
  onInvalidContent?: () => void;
  /** Compact mode - for backwards compatibility, always renders compact */
  compact?: boolean;
}

/**
 * Type for clipboard paste data received from the native UIPasteControl.
 * Defined explicitly rather than extracting from expo-clipboard internals
 * to avoid brittleness if the library's internal types change.
 */
interface PasteData {
  /** The type of content pasted */
  type: 'text' | 'plain-text' | 'url' | 'image' | 'html';
  /** The text content (for text and url types) */
  text?: string;
}

/**
 * Native paste button that works without triggering iOS permission prompts.
 * Returns null on platforms where the native paste button isn't available (iOS < 16, Android).
 */
export function ClipboardPasteButton({ onDetect, onInvalidContent }: Props) {
  const handlePaste = useCallback(
    (data: unknown) => {
      const pasteData = data as PasteData;
      const text = pasteData.text;

      // Handle text and url content types
      // Native button sends 'text' (not 'plain-text')
      if (
        (pasteData.type === 'text' ||
          pasteData.type === 'plain-text' ||
          pasteData.type === 'url') &&
        text
      ) {
        const detected = detectSocialUrl(text);
        if (detected) {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          onDetect(detected);
        } else {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          onInvalidContent?.();
        }
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        onInvalidContent?.();
      }
    },
    [onDetect, onInvalidContent]
  );

  // Only available on iOS 16+
  if (!isPasteButtonAvailable || Platform.OS !== 'ios') {
    return null;
  }

  return (
    <View style={styles.container}>
      <ExpoClipboardPasteButton
        onPress={handlePaste}
        displayMode="iconAndLabel"
        acceptedContentTypes={['plain-text', 'url']}
        style={styles.button}
        backgroundColor={colors.sunsetGold}
        foregroundColor={colors.midnightNavy}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
  },
  button: {
    height: 44,
    minWidth: 120,
  },
});
