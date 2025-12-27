/**
 * ClipboardPermissionModal - Educational modal explaining iOS clipboard permissions.
 *
 * Bottom sheet modal that guides users through enabling clipboard access
 * in iOS Settings to avoid the "Allow Paste" popup.
 */

import React from 'react';
import {
  Modal,
  Pressable,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Linking,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';

interface ClipboardPermissionModalProps {
  visible: boolean;
  onClose: () => void;
}

/** Opens the app's Settings page in iOS Settings app */
function openAppSettings() {
  if (Platform.OS === 'ios') {
    Linking.openURL('app-settings:');
  }
}

export function ClipboardPermissionModal({ visible, onClose }: ClipboardPermissionModalProps) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <Pressable
          style={styles.backdropPressable}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close modal"
          accessibilityHint="Tap to dismiss the clipboard permissions modal"
        />
        <View style={styles.modalContent}>
          <View
            style={styles.modalHandle}
            accessibilityLabel="Drag handle"
            accessibilityHint="Swipe down to close"
          />
          <Text style={styles.modalTitle}>Clipboard Permissions</Text>
          <Text style={styles.modalSubtitle}>
            How to stop the &quot;Allow Paste&quot; popup on iOS
          </Text>

          <ScrollView
            style={styles.modalScroll}
            contentContainerStyle={styles.modalScrollContent}
            showsVerticalScrollIndicator={true}
          >
            {/* Why Section */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Ionicons name="information-circle" size={18} color={colors.lakeBlue} />
                <Text style={styles.sectionTitle}>Why this happens</Text>
              </View>
              <Text style={styles.sectionText}>
                Starting with iOS 16, Apple requires apps to ask permission before reading your
                clipboard. This protects your privacy from apps silently accessing sensitive
                information.
              </Text>
            </View>

            {/* How to Fix Section */}
            <View style={[styles.section, styles.primarySection]}>
              <View style={styles.sectionHeader}>
                <Ionicons name="settings-outline" size={18} color={colors.mossGreen} />
                <Text style={styles.sectionTitle}>How to allow permanently</Text>
              </View>
              <Text style={styles.sectionText}>
                You can allow Atlasi to always read your clipboard:
              </Text>

              <View style={styles.stepsList}>
                <View style={styles.step}>
                  <View style={styles.stepNumber}>
                    <Text style={styles.stepNumberText}>1</Text>
                  </View>
                  <Text style={styles.stepText}>
                    Open iPhone <Text style={styles.bold}>Settings</Text>
                  </Text>
                </View>

                <View style={styles.step}>
                  <View style={styles.stepNumber}>
                    <Text style={styles.stepNumberText}>2</Text>
                  </View>
                  <Text style={styles.stepText}>
                    Scroll down and tap <Text style={styles.bold}>Atlasi</Text>
                  </Text>
                </View>

                <View style={styles.step}>
                  <View style={styles.stepNumber}>
                    <Text style={styles.stepNumberText}>3</Text>
                  </View>
                  <Text style={styles.stepText}>
                    Tap <Text style={styles.bold}>Paste from Other Apps</Text>
                  </Text>
                </View>

                <View style={styles.step}>
                  <View style={[styles.stepNumber, styles.stepNumberFinal]}>
                    <Ionicons name="checkmark" size={12} color={colors.cloudWhite} />
                  </View>
                  <Text style={styles.stepText}>
                    Select <Text style={styles.bold}>Allow</Text>
                  </Text>
                </View>
              </View>

              <TouchableOpacity
                style={styles.openSettingsButton}
                onPress={openAppSettings}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Open Settings"
                accessibilityHint="Opens iOS Settings to configure clipboard permissions"
              >
                <Ionicons name="settings-outline" size={18} color={colors.midnightNavy} />
                <Text style={styles.openSettingsButtonText}>Open Settings</Text>
              </TouchableOpacity>
            </View>

            {/* Alternative Section */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Ionicons name="hand-left-outline" size={18} color={colors.stormGray} />
                <Text style={styles.sectionTitle}>Alternative</Text>
              </View>
              <Text style={styles.sectionText}>
                You can also use the iOS Share menu to share links directly to Atlasi, or disable
                automatic detection in profile settings.
              </Text>
            </View>

            {/* Note */}
            <View style={styles.noteSection}>
              <Text style={styles.noteText}>
                <Text style={styles.noteLabel}>Note: </Text>
                The &quot;Paste from Other Apps&quot; setting is only available on iOS 16.1 and
                later.
              </Text>
            </View>
          </ScrollView>

          <TouchableOpacity
            style={styles.modalCloseButton}
            onPress={onClose}
            activeOpacity={0.9}
            accessibilityRole="button"
            accessibilityLabel="Got it"
            accessibilityHint="Close the clipboard permissions modal"
          >
            <Text style={styles.modalCloseButtonText}>Got it</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(23, 42, 58, 0.5)',
    justifyContent: 'flex-end',
  },
  backdropPressable: {
    ...StyleSheet.absoluteFillObject,
  },
  modalContent: {
    backgroundColor: colors.warmCream,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 12,
    paddingHorizontal: 24,
    paddingBottom: 34,
    maxHeight: '85%',
  },
  modalHandle: {
    width: 36,
    height: 4,
    backgroundColor: colors.stormGray,
    opacity: 0.4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontFamily: fonts.playfair.bold,
    fontSize: 22,
    color: colors.midnightNavy,
    textAlign: 'center',
    marginBottom: 4,
  },
  modalSubtitle: {
    fontFamily: fonts.openSans.regular,
    fontSize: 14,
    color: colors.stormGray,
    textAlign: 'center',
    marginBottom: 20,
  },
  modalScroll: {
    flexGrow: 1,
    flexShrink: 1,
  },
  modalScrollContent: {
    flexGrow: 1,
    paddingBottom: 8,
  },
  section: {
    backgroundColor: colors.cloudWhite,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.05)',
    shadowColor: colors.midnightNavy,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  primarySection: {
    borderColor: colors.mossGreen,
    borderWidth: 1.5,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  sectionTitle: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 16,
    color: colors.midnightNavy,
  },
  sectionText: {
    fontFamily: fonts.openSans.regular,
    fontSize: 14,
    color: colors.stormGray,
    lineHeight: 20,
  },
  stepsList: {
    marginTop: 12,
    gap: 10,
  },
  step: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  stepNumber: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.paperBeige,
    borderWidth: 2,
    borderColor: colors.mossGreen,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumberFinal: {
    backgroundColor: colors.mossGreen,
    borderColor: colors.mossGreen,
  },
  stepNumberText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 12,
    color: colors.mossGreen,
  },
  stepText: {
    flex: 1,
    fontFamily: fonts.openSans.regular,
    fontSize: 14,
    color: colors.midnightNavy,
  },
  bold: {
    fontFamily: fonts.openSans.semiBold,
  },
  openSettingsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.sunsetGold,
    paddingVertical: 12,
    borderRadius: 10,
    marginTop: 16,
  },
  openSettingsButtonText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 15,
    color: colors.midnightNavy,
  },
  noteSection: {
    backgroundColor: 'rgba(244, 194, 78, 0.12)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  noteText: {
    fontFamily: fonts.openSans.regular,
    fontSize: 13,
    color: colors.stormGray,
    lineHeight: 18,
  },
  noteLabel: {
    fontFamily: fonts.openSans.semiBold,
    color: colors.midnightNavy,
  },
  modalCloseButton: {
    backgroundColor: colors.adobeBrick,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 16,
    borderRadius: 12,
  },
  modalCloseButtonText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 16,
    color: colors.cloudWhite,
  },
});
