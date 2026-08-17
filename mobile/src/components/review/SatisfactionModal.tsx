/**
 * SatisfactionModal - Two-step satisfaction gate for app review requests
 *
 * Shows a modal asking users how they're enjoying the app.
 * Positive responses proceed to native App Store/Play Store review.
 * Negative responses direct users to the contact page for feedback.
 */
import React from 'react';
import { Linking, Modal, Pressable, StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import { Text } from '@components/ui';
import { env } from '@config/env';
import { colors, withAlpha } from '@constants/colors';
import { fonts } from '@constants/typography';
import { Analytics } from '@services/analytics';

const CONTACT_URL = `${env.webBaseUrl}/contact`;

interface SatisfactionModalProps {
  visible: boolean;
  onPositive: () => void;
  onNegative: () => void;
  onDismiss: () => void;
}

export function SatisfactionModal({
  visible,
  onPositive,
  onNegative,
  onDismiss,
}: SatisfactionModalProps) {
  const handlePositive = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {
      // Haptics not available - continue silently
    });
    onPositive();
  };

  const handleNegative = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {
      // Haptics not available - continue silently
    });
    onNegative();

    // Open contact page for feedback
    try {
      const canOpen = await Linking.canOpenURL(CONTACT_URL);
      if (canOpen) {
        Analytics.reviewSupportLinkTapped();
        await Linking.openURL(CONTACT_URL);
      }
    } catch (error) {
      console.warn('Failed to open contact page:', error);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onDismiss}
      accessibilityViewIsModal
    >
      <Pressable style={styles.overlay} onPress={onDismiss}>
        <Pressable style={styles.dialog} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.title}>How are you enjoying Atlasi?</Text>
          <Text style={styles.subtitle}>Your feedback helps us improve the app for everyone.</Text>

          <View style={styles.buttonContainer}>
            <Pressable
              style={[styles.button, styles.positiveButton]}
              onPress={handlePositive}
              accessibilityRole="button"
              accessibilityLabel="I love Atlasi"
              accessibilityHint="Tap to proceed to leave a review"
            >
              <Text style={[styles.buttonText, styles.positiveButtonText]}>I love it!</Text>
            </Pressable>

            <Pressable
              style={[styles.button, styles.negativeButton]}
              onPress={handleNegative}
              accessibilityRole="button"
              accessibilityLabel="Could be better"
              accessibilityHint="Tap to send feedback to the team"
            >
              <Text style={[styles.buttonText, styles.negativeButtonText]}>Could be better</Text>
            </Pressable>
          </View>

          <Pressable
            style={styles.dismissButton}
            onPress={onDismiss}
            accessibilityRole="button"
            accessibilityLabel="Not now"
            accessibilityHint="Dismiss this prompt"
          >
            <Text style={styles.dismissText}>Not now</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  dialog: {
    backgroundColor: colors.warmCream,
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxWidth: 340,
    alignItems: 'center',
  },
  title: {
    fontFamily: fonts.playfair.bold,
    fontSize: 22,
    lineHeight: 28,
    color: colors.midnightNavy,
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontFamily: fonts.openSans.regular,
    fontSize: 15,
    lineHeight: 22,
    color: colors.stormGray,
    textAlign: 'center',
    marginBottom: 24,
  },
  buttonContainer: {
    width: '100%',
    gap: 12,
  },
  button: {
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: 'center',
  },
  positiveButton: {
    backgroundColor: colors.sunsetGold,
  },
  negativeButton: {
    backgroundColor: withAlpha(colors.midnightNavy, 0.08),
  },
  buttonText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 16,
  },
  positiveButtonText: {
    color: colors.midnightNavy,
  },
  negativeButtonText: {
    color: colors.midnightNavy,
  },
  dismissButton: {
    marginTop: 16,
    padding: 8,
  },
  dismissText: {
    fontFamily: fonts.openSans.regular,
    fontSize: 14,
    color: colors.stormGray,
  },
});
