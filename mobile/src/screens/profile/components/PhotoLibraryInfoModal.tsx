/**
 * PhotoLibraryInfoModal - Educational modal explaining photo library permissions.
 *
 * Bottom sheet modal that explains what photo access is used for and how
 * users can manage their permission settings.
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
import { SCAN_COPY } from '@constants/scanCopy';
import { presentLimitedPhotoPickerOrOpenSettings } from '@services/photoImport/photoImportService';

interface PhotoLibraryInfoModalProps {
  visible: boolean;
  onClose: () => void;
  isLimitedAccess?: boolean;
}

/** Opens the app's Settings page in iOS Settings app */
function openAppSettings() {
  if (Platform.OS === 'ios') {
    Linking.openURL('app-settings:');
  } else {
    Linking.openSettings();
  }
}

export function PhotoLibraryInfoModal({
  visible,
  onClose,
  isLimitedAccess,
}: PhotoLibraryInfoModalProps) {
  const handleManageLimitedPhotos = async () => {
    await presentLimitedPhotoPickerOrOpenSettings(openAppSettings);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <Pressable
          style={styles.backdropPressable}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close modal"
          accessibilityHint="Tap to dismiss the photo permissions modal"
        />
        <View style={styles.modalContent}>
          <View
            style={styles.modalHandle}
            accessibilityLabel="Drag handle"
            accessibilityHint="Swipe down to close"
          />
          <Text style={styles.modalTitle}>Photo Library Access</Text>
          <Text style={styles.modalSubtitle}>
            {isLimitedAccess
              ? "You've granted access to selected photos"
              : 'How we use your photo library'}
          </Text>

          <ScrollView
            style={styles.modalScroll}
            contentContainerStyle={styles.modalScrollContent}
            showsVerticalScrollIndicator={true}
          >
            {/* Why Section */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Ionicons name="images-outline" size={18} color={colors.lakeBlue} />
                <Text style={styles.sectionTitle}>Why we need photo access</Text>
              </View>
              <Text style={styles.sectionText}>
                Photo import lets you discover trips from your travel photos. We scan your photo
                library to find pictures with GPS location data, then group them into potential
                trips for you to review.
              </Text>
            </View>

            {/* What We Access Section */}
            <View style={[styles.section, styles.primarySection]}>
              <View style={styles.sectionHeader}>
                <Ionicons name="eye-outline" size={18} color={colors.mossGreen} />
                <Text style={styles.sectionTitle}>What we access</Text>
              </View>
              <View style={styles.bulletList}>
                <View style={styles.bulletItem}>
                  <View style={styles.bulletDot} />
                  <Text style={styles.bulletText}>
                    <Text style={styles.bold}>Location data</Text> - GPS coordinates embedded in
                    your photos
                  </Text>
                </View>
                <View style={styles.bulletItem}>
                  <View style={styles.bulletDot} />
                  <Text style={styles.bulletText}>
                    <Text style={styles.bold}>Date taken</Text> - When each photo was captured
                  </Text>
                </View>
              </View>
            </View>

            {/* What We Don't Access Section */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Ionicons name="shield-checkmark-outline" size={18} color={colors.mossGreen} />
                <Text style={styles.sectionTitle}>What we don&apos;t do</Text>
              </View>
              <View style={styles.bulletList}>
                <View style={styles.bulletItem}>
                  <View style={[styles.bulletDot, styles.bulletDotMuted]} />
                  <Text style={styles.bulletText}>
                    Photos are <Text style={styles.bold}>not uploaded automatically</Text> - you
                    choose which to add
                  </Text>
                </View>
                <View style={styles.bulletItem}>
                  <View style={[styles.bulletDot, styles.bulletDotMuted]} />
                  <Text style={styles.bulletText}>
                    No AI analysis or facial recognition on your device
                  </Text>
                </View>
                <View style={styles.bulletItem}>
                  <View style={[styles.bulletDot, styles.bulletDotMuted]} />
                  <Text style={styles.bulletText}>
                    Photo content is never shared with third parties
                  </Text>
                </View>
              </View>
            </View>

            {/* Limited Access Note (if applicable) */}
            {isLimitedAccess && (
              <View style={styles.noteSection}>
                <Text style={styles.noteText}>
                  <Text style={styles.noteLabel}>Limited Access: </Text>
                  You&apos;ve chosen to share only selected photos with Atlasi. You can add more
                  photos here, or grant full access in Settings.
                </Text>
                {Platform.OS === 'ios' && (
                  <TouchableOpacity
                    style={styles.managePhotosButton}
                    onPress={() => {
                      void handleManageLimitedPhotos();
                    }}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityLabel={SCAN_COPY.permission.recoveryAllowMorePhotosCta}
                    testID="photo-library-allow-more"
                  >
                    <Ionicons name="images-outline" size={16} color={colors.midnightNavy} />
                    <Text style={styles.managePhotosButtonText}>
                      {SCAN_COPY.permission.recoveryAllowMorePhotosCta}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {/* Settings Section */}
            {!isLimitedAccess && Platform.OS === 'ios' && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Ionicons name="settings-outline" size={18} color={colors.stormGray} />
                  <Text style={styles.sectionTitle}>Managing permissions</Text>
                </View>
                <Text style={styles.sectionText}>
                  You can change photo access at any time in iOS Settings. Choose &quot;Full
                  Access&quot; for the best experience, or &quot;Limited Access&quot; to select
                  specific photos.
                </Text>
                <TouchableOpacity
                  style={styles.openSettingsButton}
                  onPress={openAppSettings}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel="Open Settings"
                  accessibilityHint="Opens iOS Settings to manage photo permissions"
                >
                  <Ionicons name="settings-outline" size={18} color={colors.midnightNavy} />
                  <Text style={styles.openSettingsButtonText}>Open Settings</Text>
                </TouchableOpacity>
              </View>
            )}
          </ScrollView>

          <TouchableOpacity
            style={styles.modalCloseButton}
            onPress={onClose}
            activeOpacity={0.9}
            accessibilityRole="button"
            accessibilityLabel="Got it"
            accessibilityHint="Close the photo permissions modal"
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
  bulletList: {
    gap: 10,
  },
  bulletItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  bulletDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.mossGreen,
    marginTop: 7,
  },
  bulletDotMuted: {
    backgroundColor: colors.stormGray,
    opacity: 0.5,
  },
  bulletText: {
    flex: 1,
    fontFamily: fonts.openSans.regular,
    fontSize: 14,
    color: colors.stormGray,
    lineHeight: 20,
  },
  bold: {
    fontFamily: fonts.openSans.semiBold,
    color: colors.midnightNavy,
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
  managePhotosButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.sunsetGold,
    paddingVertical: 10,
    borderRadius: 8,
    marginTop: 12,
  },
  managePhotosButtonText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 14,
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
