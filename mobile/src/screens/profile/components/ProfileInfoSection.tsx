import React from 'react';
import {
  View,
  Text,
  Pressable,
  Switch,
  StyleSheet,
  Platform,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import type { PhotoPermissionStatus } from '@hooks/usePhotoPermissions';

interface ProfileInfoSectionProps {
  formattedEmail: string;
  homeCountryDisplay: { flag: string; name: string } | null;
  memberSince: string;
  // LAUNCH_SIMPLIFICATION: Tracking preference hidden - all users get full_atlas
  // trackingPreferenceDisplay: { name: string; count: number };
  visitedCount: number;
  clipboardDetectionEnabled: boolean;
  isSmallScreen?: boolean;
  // LAUNCH_SIMPLIFICATION: Tracking modal hidden
  // onOpenTrackingModal: () => void;
  onOpenExportModal: () => void;
  onToggleClipboardDetection: (enabled: boolean) => void;
  onOpenClipboardPermissionModal?: () => void;
  // Photo library permission
  photoPermissionStatus: PhotoPermissionStatus;
  onRequestPhotoPermission: () => void;
  onOpenPhotoEnableModal: () => void;
  onOpenPhotoInfoModal: () => void;
}

export function ProfileInfoSection({
  formattedEmail,
  homeCountryDisplay,
  memberSince,
  // LAUNCH_SIMPLIFICATION: Tracking preference hidden
  // trackingPreferenceDisplay,
  visitedCount,
  clipboardDetectionEnabled,
  isSmallScreen,
  // LAUNCH_SIMPLIFICATION: Tracking modal hidden
  // onOpenTrackingModal,
  onOpenExportModal,
  onToggleClipboardDetection,
  onOpenClipboardPermissionModal,
  photoPermissionStatus,
  onRequestPhotoPermission,
  onOpenPhotoEnableModal,
  onOpenPhotoInfoModal,
}: ProfileInfoSectionProps) {
  return (
    <View style={styles.container}>
      {/* Passport Details Section */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, isSmallScreen && styles.sectionTitleSmall]}>
          PASSPORT DETAILS
        </Text>
        <View style={styles.card}>
          <View style={styles.cardRow}>
            <View>
              <Text style={[styles.rowLabel, isSmallScreen && styles.rowLabelSmall]}>Email</Text>
            </View>
            <Text style={[styles.rowValue, isSmallScreen && styles.rowValueSmall]}>
              {formattedEmail}
            </Text>
          </View>

          <View style={styles.divider} />

          {homeCountryDisplay && (
            <>
              <View style={styles.cardRow}>
                <Text style={[styles.rowLabel, isSmallScreen && styles.rowLabelSmall]}>
                  Home Country
                </Text>
                <Text style={[styles.rowValue, isSmallScreen && styles.rowValueSmall]}>
                  {homeCountryDisplay.flag} {homeCountryDisplay.name}
                </Text>
              </View>
              <View style={styles.divider} />
            </>
          )}

          <View style={styles.cardRow}>
            <Text style={[styles.rowLabel, isSmallScreen && styles.rowLabelSmall]}>
              Member Since
            </Text>
            <Text style={[styles.rowValue, isSmallScreen && styles.rowValueSmall]}>
              {memberSince}
            </Text>
          </View>
        </View>
      </View>

      {/* Preferences Section */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, isSmallScreen && styles.sectionTitleSmall]}>
          PREFERENCES & DATA
        </Text>
        <View style={styles.card}>
          {/* LAUNCH_SIMPLIFICATION: Country tracking preference hidden - all users get full_atlas */}
          {/* TODO: Uncomment when re-enabling tracking preference selection
          <Pressable
            onPress={onOpenTrackingModal}
            style={({ pressed }) => [styles.cardPressable, pressed && styles.cardPressableActive]}
            accessibilityRole="button"
            accessibilityLabel="Change country tracking preference"
          >
            <View style={styles.cardRow}>
              <Text style={[styles.rowLabel, isSmallScreen && styles.rowLabelSmall]}>
                Country Tracking
              </Text>
              <View style={styles.rowValueContainer}>
                <Text style={[styles.rowValue, isSmallScreen && styles.rowValueSmall]}>
                  {trackingPreferenceDisplay.name}
                </Text>
                <Ionicons
                  name="chevron-forward"
                  size={16}
                  color={colors.stormGray}
                  style={styles.chevronIcon}
                />
              </View>
            </View>
          </Pressable>

          <View style={styles.divider} />
          */}

          {visitedCount > 0 && (
            <>
              <Pressable
                onPress={onOpenExportModal}
                style={({ pressed }) => [
                  styles.cardPressable,
                  pressed && styles.cardPressableActive,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Export your country list"
              >
                <View style={styles.cardRow}>
                  <Text style={[styles.rowLabel, isSmallScreen && styles.rowLabelSmall]}>
                    Export Countries
                  </Text>
                  <View style={styles.rowValueContainer}>
                    <Text style={[styles.rowValue, isSmallScreen && styles.rowValueSmall]}>
                      {visitedCount} {visitedCount === 1 ? 'country' : 'countries'}
                    </Text>
                    <Ionicons
                      name="chevron-forward"
                      size={16}
                      color={colors.stormGray}
                      style={styles.chevronIcon}
                    />
                  </View>
                </View>
              </Pressable>
              <View style={styles.divider} />
            </>
          )}

          <View style={styles.cardRow}>
            <View style={styles.toggleLabelContainer}>
              <Text style={[styles.rowLabel, isSmallScreen && styles.rowLabelSmall]}>
                Clipboard Detection
              </Text>
              <Text
                style={[styles.toggleDescription, isSmallScreen && styles.toggleDescriptionSmall]}
              >
                Detect TikTok/Instagram links
              </Text>
              {clipboardDetectionEnabled &&
                Platform.OS === 'ios' &&
                onOpenClipboardPermissionModal && (
                  <TouchableOpacity
                    onPress={onOpenClipboardPermissionModal}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityRole="button"
                    accessibilityLabel="Learn about clipboard permissions"
                    accessibilityHint="Opens a modal explaining how to configure iOS clipboard permissions"
                  >
                    <Text
                      style={[styles.learnMoreLink, isSmallScreen && styles.learnMoreLinkSmall]}
                    >
                      Learn about iOS permissions
                    </Text>
                  </TouchableOpacity>
                )}
            </View>
            {clipboardDetectionEnabled ? (
              <Switch
                value={clipboardDetectionEnabled}
                onValueChange={onToggleClipboardDetection}
                trackColor={{ false: colors.paperBeige, true: colors.mossGreen }}
                thumbColor={colors.cloudWhite}
                accessibilityLabel="Toggle clipboard URL detection"
              />
            ) : (
              <TouchableOpacity
                onPress={onOpenClipboardPermissionModal}
                style={styles.enableButton}
                accessibilityRole="button"
                accessibilityLabel="Enable clipboard detection"
              >
                <Text style={styles.enableButtonText}>Enable</Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.divider} />

          {/* Photo Library Permission */}
          <View style={styles.cardRow}>
            <View style={styles.toggleLabelContainer}>
              <Text style={[styles.rowLabel, isSmallScreen && styles.rowLabelSmall]}>
                Photo Library
              </Text>
              <Text
                style={[styles.toggleDescription, isSmallScreen && styles.toggleDescriptionSmall]}
              >
                Import trips from your photos
              </Text>
              {(photoPermissionStatus === 'granted' || photoPermissionStatus === 'limited') &&
                Platform.OS === 'ios' && (
                  <TouchableOpacity
                    onPress={onOpenPhotoInfoModal}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityRole="button"
                    accessibilityLabel="Learn about photo permissions"
                    accessibilityHint="Opens a modal explaining how photo access is used"
                  >
                    <Text
                      style={[styles.learnMoreLink, isSmallScreen && styles.learnMoreLinkSmall]}
                    >
                      {photoPermissionStatus === 'limited'
                        ? 'Using selected photos only'
                        : 'Learn about permissions'}
                    </Text>
                  </TouchableOpacity>
                )}
            </View>
            {photoPermissionStatus === 'granted' || photoPermissionStatus === 'limited' ? (
              <View style={styles.permissionGrantedIndicator}>
                <Ionicons name="checkmark-circle" size={24} color={colors.mossGreen} />
              </View>
            ) : photoPermissionStatus === 'denied' ? (
              <TouchableOpacity
                onPress={onOpenPhotoEnableModal}
                style={styles.enableButton}
                accessibilityRole="button"
                accessibilityLabel="Enable photo library access"
                accessibilityHint="Opens instructions for enabling photo access in Settings"
              >
                <Text style={styles.enableButtonText}>Enable</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                onPress={onRequestPhotoPermission}
                style={styles.enableButton}
                accessibilityRole="button"
                accessibilityLabel="Enable photo library access"
                accessibilityHint="Requests permission to access your photo library"
              >
                <Text style={styles.enableButtonText}>Enable</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontFamily: fonts.oswald.medium,
    fontSize: 12,
    color: colors.stormGray,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: 12,
    marginLeft: 4,
  },
  card: {
    backgroundColor: colors.cloudWhite,
    borderRadius: 20,
    paddingVertical: 4,
    shadowColor: colors.midnightNavy,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  // Slightly less than card border radius for proper nesting
  cardPressable: {
    borderRadius: 12,
  },
  cardPressableActive: {
    backgroundColor: colors.paperBeige,
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(0,0,0,0.05)',
    marginLeft: 16, // Indented divider
  },
  rowLabel: {
    fontFamily: fonts.openSans.regular,
    fontSize: 16,
    color: colors.midnightNavy,
  },
  rowValue: {
    fontFamily: fonts.openSans.regular,
    fontSize: 16,
    color: colors.stormGray,
  },
  rowValueContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowValueDetail: {
    fontSize: 14,
    color: colors.stormGray,
  },
  chevronIcon: {
    marginLeft: 8,
    opacity: 0.5,
  },
  infoValue: {
    fontFamily: fonts.openSans.regular,
    fontSize: 16,
    color: colors.midnightNavy,
  },
  toggleLabelContainer: {
    flex: 1,
  },
  toggleDescription: {
    fontFamily: fonts.openSans.regular,
    fontSize: 12,
    color: colors.stormGray,
    marginTop: 2,
  },
  learnMoreLink: {
    fontFamily: fonts.openSans.regular,
    fontSize: 12,
    color: colors.mossGreen,
    marginTop: 4,
    textDecorationLine: 'underline',
  },
  enableButton: {
    backgroundColor: colors.mossGreen,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  enableButtonText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 14,
    color: colors.cloudWhite,
  },
  permissionGrantedIndicator: {
    paddingHorizontal: 8,
  },
  emailNote: {
    fontFamily: fonts.openSans.regular,
    fontSize: 11,
    color: colors.stormGray,
    marginTop: 2,
    fontStyle: 'italic',
  },
  // Small screen overrides
  sectionTitleSmall: {
    fontSize: 11,
  },
  rowLabelSmall: {
    fontSize: 14,
  },
  rowValueSmall: {
    fontSize: 14,
  },
  toggleDescriptionSmall: {
    fontSize: 11,
  },
  learnMoreLinkSmall: {
    fontSize: 11,
  },
});
