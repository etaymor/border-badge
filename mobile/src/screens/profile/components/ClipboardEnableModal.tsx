/**
 * ClipboardEnableModal - Elegant modal guiding users through iOS Settings setup.
 *
 * Design: "Field Guide Instruction Card" - vintage travel guide aesthetic
 * with clear step-by-step instructions for enabling clipboard permissions.
 */

import React, { useEffect, useRef } from 'react';
import {
  Modal,
  Pressable,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Linking,
  Platform,
  Animated,
} from 'react-native';
import { colors, withAlpha } from '@constants/colors';
import { fonts } from '@constants/typography';

interface ClipboardEnableModalProps {
  visible: boolean;
  onClose: () => void;
  onEnable: () => void;
}

/** Opens the app's Settings page in iOS Settings app */
function openAppSettings() {
  if (Platform.OS === 'ios') {
    Linking.openURL('app-settings:');
  }
}

const STEPS = [
  { number: '1', text: 'Open Settings' },
  { number: '2', text: 'Find Atlasi' },
  { number: '3', text: 'Tap "Paste from Other Apps"' },
  { number: '4', text: 'Select "Allow"' },
];

export function ClipboardEnableModal({ visible, onClose, onEnable }: ClipboardEnableModalProps) {
  // Animation values
  const slideAnim = useRef(new Animated.Value(300)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const stepAnimations = useRef(STEPS.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    if (visible) {
      // Reset animations
      slideAnim.setValue(300);
      fadeAnim.setValue(0);
      stepAnimations.forEach((anim) => anim.setValue(0));

      // Animate in
      Animated.parallel([
        Animated.spring(slideAnim, {
          toValue: 0,
          friction: 9,
          tension: 80,
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();

      // Stagger step animations
      stepAnimations.forEach((anim, index) => {
        Animated.timing(anim, {
          toValue: 1,
          duration: 400,
          delay: 150 + index * 100,
          useNativeDriver: true,
        }).start();
      });
    }
  }, [visible, slideAnim, fadeAnim, stepAnimations]);

  const handleOpenSettings = () => {
    onEnable();
    openAppSettings();
    onClose();
  };

  const handleSkip = () => {
    onEnable();
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.container}>
        {/* Backdrop */}
        <Animated.View style={[styles.backdrop, { opacity: fadeAnim }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        </Animated.View>

        {/* Modal Content */}
        <Animated.View
          style={[
            styles.modalContent,
            {
              transform: [{ translateY: slideAnim }],
            },
          ]}
        >
          {/* Handle */}
          <View style={styles.handle} />

          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>Save Links Automatically</Text>
            <Text style={styles.subtitle}>Never lose a travel recommendation again</Text>
          </View>

          {/* Steps Container */}
          <View style={styles.stepsCard}>
            {STEPS.map((step, index) => (
              <Animated.View
                key={step.number}
                style={[
                  styles.step,
                  index < STEPS.length - 1 && styles.stepWithConnector,
                  {
                    opacity: stepAnimations[index],
                    transform: [
                      {
                        translateX: stepAnimations[index].interpolate({
                          inputRange: [0, 1],
                          outputRange: [-20, 0],
                        }),
                      },
                    ],
                  },
                ]}
              >
                {/* Step Number Badge */}
                <View style={styles.stepBadge}>
                  <Text style={styles.stepNumber}>{step.number}</Text>
                </View>

                {/* Connector Line */}
                {index < STEPS.length - 1 && <View style={styles.connector} />}

                {/* Step Content */}
                <View style={styles.stepContent}>
                  <Text style={styles.stepText}>{step.text}</Text>
                </View>
              </Animated.View>
            ))}
          </View>

          {/* Privacy Note */}
          <View style={styles.privacyContainer}>
            <Text style={styles.privacyText}>
              We only detect TikTok & Instagram links.{'\n'}
              No other content is ever read or stored.
            </Text>
          </View>

          {/* Actions */}
          <View style={styles.actions}>
            {/* Primary Button - Open Settings */}
            {Platform.OS === 'ios' && (
              <TouchableOpacity
                style={styles.primaryButton}
                onPress={handleOpenSettings}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel="Open Settings"
              >
                <Text style={styles.primaryButtonText}>Open Settings</Text>
              </TouchableOpacity>
            )}

            {/* Secondary Button - Skip */}
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={handleSkip}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Skip for now"
            >
              <Text style={styles.secondaryButtonText}>I&apos;ll do it later</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: withAlpha(colors.midnightNavy, 0.6),
  },
  modalContent: {
    backgroundColor: colors.warmCream,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 12,
    paddingHorizontal: 24,
    paddingBottom: 40,
    // Subtle shadow for depth
    shadowColor: colors.midnightNavy,
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 20,
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: withAlpha(colors.midnightNavy, 0.15),
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 24,
  },
  header: {
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontFamily: fonts.playfair.bold,
    fontSize: 28,
    color: colors.midnightNavy,
    letterSpacing: -0.5,
    marginBottom: 6,
  },
  subtitle: {
    fontFamily: fonts.openSans.regular,
    fontSize: 15,
    color: colors.stormGray,
  },
  stepsCard: {
    marginBottom: 20,
    paddingLeft: 4,
  },
  step: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    position: 'relative',
  },
  stepWithConnector: {
    marginBottom: 20,
  },
  stepBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.sunsetGold,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
    // Subtle inner shadow effect
    shadowColor: colors.midnightNavy,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
  stepNumber: {
    fontFamily: fonts.openSans.bold,
    fontSize: 15,
    color: colors.midnightNavy,
  },
  connector: {
    position: 'absolute',
    left: 15,
    top: 36,
    width: 2,
    height: 16,
    backgroundColor: withAlpha(colors.sunsetGold, 0.4),
    borderRadius: 1,
  },
  stepContent: {
    flex: 1,
    justifyContent: 'center',
    paddingTop: 4,
  },
  stepText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 16,
    color: colors.midnightNavy,
    flex: 1,
  },
  privacyContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: withAlpha(colors.mossGreen, 0.08),
    borderRadius: 12,
    padding: 14,
    marginBottom: 24,
    gap: 10,
  },
  privacyText: {
    fontFamily: fonts.openSans.regular,
    fontSize: 13,
    color: colors.stormGray,
    lineHeight: 18,
    flex: 1,
  },
  actions: {
    gap: 12,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.sunsetGold,
    paddingVertical: 18,
    paddingHorizontal: 24,
    borderRadius: 14,
    gap: 10,
    // Button shadow
    shadowColor: colors.sunsetGold,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  primaryButtonText: {
    fontFamily: fonts.openSans.bold,
    fontSize: 17,
    color: colors.midnightNavy,
    flex: 1,
    textAlign: 'center',
  },
  secondaryButton: {
    alignItems: 'center',
    paddingVertical: 14,
  },
  secondaryButtonText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 15,
    color: colors.stormGray,
  },
});
