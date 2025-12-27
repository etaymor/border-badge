/**
 * ClipboardPasteButton - Native iOS paste button that bypasses permission prompts.
 *
 * Uses Apple's UIPasteControl (via expo-clipboard) which allows users to paste
 * clipboard content without triggering the "Allow Paste" permission dialog.
 *
 * Only available on iOS 16+. Returns null on unsupported platforms.
 */

import { useCallback } from 'react';
import { StyleSheet, View, Text, Platform } from 'react-native';
import {
  ClipboardPasteButton as ExpoClipboardPasteButton,
  isPasteButtonAvailable,
  type ClipboardPasteButtonProps,
} from 'expo-clipboard';
import * as Haptics from 'expo-haptics';

import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { detectSocialUrl, type DetectedClipboardUrl } from '@hooks/useClipboardListener';

interface Props {
  /** Called when a valid TikTok/Instagram URL is detected from paste */
  onDetect: (detected: DetectedClipboardUrl) => void;
  /** Called when paste contains no valid URL */
  onInvalidContent?: () => void;
  /** Show hint text below button */
  showHint?: boolean;
  /** Custom hint text */
  hintText?: string;
  /** Compact mode - just the button without wrapper */
  compact?: boolean;
}

type PasteData = Parameters<NonNullable<ClipboardPasteButtonProps['onPress']>>[0];

/**
 * Native paste button that works without triggering iOS permission prompts.
 * Returns null on platforms where the native paste button isn't available (iOS < 16, Android).
 */
export function ClipboardPasteButton({
  onDetect,
  onInvalidContent,
  showHint = true,
  hintText = 'Paste a TikTok or Instagram link',
  compact = false,
}: Props) {
  const handlePaste = useCallback(
    (data: PasteData) => {
      if (data.type === 'plain-text' && data.text) {
        const detected = detectSocialUrl(data.text);
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

  // Compact mode - just the native button
  if (compact) {
    return (
      <View style={styles.compactContainer}>
        <ExpoClipboardPasteButton
          onPress={handlePaste}
          displayMode="iconAndLabel"
          acceptedContentTypes={['plain-text', 'url']}
          style={styles.compactButton}
        />
      </View>
    );
  }

  // Full mode with card wrapper
  return (
    <View style={styles.container}>
      <View style={styles.card}>
        {/* Icon */}
        <View style={styles.iconContainer}>
          <Text style={styles.iconText}>📋</Text>
        </View>

        {/* Label */}
        {showHint && <Text style={styles.hint}>{hintText}</Text>}

        {/* Native paste button */}
        <View style={styles.buttonWrapper}>
          <ExpoClipboardPasteButton
            onPress={handlePaste}
            displayMode="iconAndLabel"
            acceptedContentTypes={['plain-text', 'url']}
            style={styles.button}
          />
        </View>

        {/* Helper text */}
        <Text style={styles.helperText}>No permission popup</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  card: {
    backgroundColor: colors.cloudWhite,
    borderRadius: 16,
    paddingVertical: 20,
    paddingHorizontal: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.05)',
    shadowColor: colors.midnightNavy,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
    minWidth: 200,
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.paperBeige,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  iconText: {
    fontSize: 20,
  },
  hint: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 14,
    color: colors.midnightNavy,
    textAlign: 'center',
    marginBottom: 12,
  },
  buttonWrapper: {
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: colors.paperBeige,
    padding: 2,
  },
  button: {
    height: 44,
    minWidth: 100,
  },
  helperText: {
    fontFamily: fonts.openSans.regular,
    fontSize: 12,
    color: colors.stormGray,
    textAlign: 'center',
    marginTop: 8,
  },
  // Compact mode styles
  compactContainer: {
    alignItems: 'center',
  },
  compactButton: {
    height: 40,
    minWidth: 100,
  },
});
