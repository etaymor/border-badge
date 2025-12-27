/**
 * ClipboardPasteModal - Minimal modal with native iOS paste button.
 *
 * Uses Apple's UIPasteControl which bypasses permission prompts.
 * When a valid TikTok/Instagram link is detected, navigates to ShareCapture.
 */

import React from 'react';
import { Modal, Pressable, View, Text, StyleSheet } from 'react-native';

import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { ClipboardPasteButton } from './ClipboardPasteButton';
import type { DetectedClipboardUrl } from '@hooks/useClipboardListener';

interface ClipboardPasteModalProps {
  visible: boolean;
  onClose: () => void;
  onDetect: (detected: DetectedClipboardUrl) => void;
  onInvalidContent?: () => void;
  onEnableAutoDetect?: () => void;
}

export function ClipboardPasteModal({
  visible,
  onClose,
  onDetect,
  onInvalidContent,
  onEnableAutoDetect,
}: ClipboardPasteModalProps) {
  const handleDetect = (detected: DetectedClipboardUrl) => {
    onDetect(detected);
    onClose();
  };

  const handleInvalid = () => {
    onClose();
    onInvalidContent?.();
  };

  const handleEnableAutoDetect = () => {
    onClose();
    onEnableAutoDetect?.();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable
          style={styles.backdropPressable}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
        />
        <View style={styles.content}>
          <Text style={styles.title}>Paste TikTok or Instagram link</Text>

          <ClipboardPasteButton onDetect={handleDetect} onInvalidContent={handleInvalid} compact />

          {onEnableAutoDetect && (
            <Pressable
              style={styles.autoDetectLink}
              onPress={handleEnableAutoDetect}
              accessibilityRole="button"
              accessibilityLabel="Enable automatic detection"
            >
              <Text style={styles.autoDetectText}>
                Want to skip this step?{' '}
                <Text style={styles.autoDetectLinkText}>Enable auto-detect</Text>
              </Text>
            </Pressable>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(23, 42, 58, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  backdropPressable: {
    ...StyleSheet.absoluteFillObject,
  },
  content: {
    backgroundColor: colors.warmCream,
    borderRadius: 16,
    paddingVertical: 24,
    paddingHorizontal: 24,
    alignItems: 'center',
    minWidth: 260,
  },
  title: {
    fontFamily: fonts.playfair.bold,
    fontSize: 20,
    color: colors.midnightNavy,
    textAlign: 'center',
    marginBottom: 24,
    letterSpacing: -0.3,
  },
  autoDetectLink: {
    marginTop: 16,
    paddingVertical: 8,
  },
  autoDetectText: {
    fontFamily: fonts.openSans.regular,
    fontSize: 13,
    color: colors.stormGray,
    textAlign: 'center',
  },
  autoDetectLinkText: {
    color: colors.mossGreen,
    textDecorationLine: 'underline',
  },
});
