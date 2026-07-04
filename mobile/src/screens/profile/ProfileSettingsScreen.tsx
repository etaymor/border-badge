import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Keyboard,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GlassBackButton } from '@components/ui';
import { colors } from '@constants/colors';
import { ALL_REGIONS } from '@constants/regions';
// LAUNCH_SIMPLIFICATION: Tracking preference imports hidden
// import { TRACKING_PRESETS, type TrackingPreset } from '@constants/trackingPreferences';
import { fonts } from '@constants/typography';
import { env } from '@config/env';
import { useResponsive } from '@hooks/useResponsive';
import { useDeleteAccount, useSignOut } from '@hooks/useAuth';
import { useCountries, useCountryByCode } from '@hooks/useCountries';
import { usePhotoPermissionStatus } from '@hooks/usePhotoPermissions';
// LAUNCH_SIMPLIFICATION: useUpdateProfile only used for tracking preference
import { useProfile } from '@hooks/useProfile';
import { useUserCountries } from '@hooks/useUserCountries';
import { useUpdateDisplayName } from '@hooks/useUpdateDisplayName';
import { useAuthStore, selectSession } from '@stores/authStore';
import { useSettingsStore, selectClipboardDetectionEnabled } from '@stores/settingsStore';
import { useSubscriptionStore } from '@stores/subscriptionStore';
import { validateDisplayName } from '@utils/displayNameValidation';
import { getFlagEmoji } from '@utils/flags';
import { Share } from '@utils/share';
import type { PassportStackScreenProps } from '@navigation/types';

import { ProfileAvatar } from './components/ProfileAvatar';
import { ProfileNameSection } from './components/ProfileNameSection';
import { ProfileInfoSection } from './components/ProfileInfoSection';
import { SignOutSection } from './components/SignOutSection';
import { SubscriptionSection } from './components/SubscriptionSection';
// LAUNCH_SIMPLIFICATION: Tracking preference hidden - all users get full_atlas
// import { TrackingPreferenceModal } from './components/TrackingPreferenceModal';
import { ExportCountriesModal } from './components/ExportCountriesModal';
import { ClipboardPermissionModal } from './components/ClipboardPermissionModal';
import { ClipboardEnableModal } from './components/ClipboardEnableModal';
import { DeleteConfirmationModal } from './components/DeleteConfirmationModal';
import { PhotoLibraryEnableModal } from './components/PhotoLibraryEnableModal';
import { PhotoLibraryInfoModal } from './components/PhotoLibraryInfoModal';

type Props = PassportStackScreenProps<'ProfileSettings'>;

/**
 * Format date to readable format.
 */
function formatMemberSince(dateString: string | undefined): string {
  if (!dateString) return 'Unknown';

  try {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  } catch {
    return 'Unknown';
  }
}

/**
 * Get initials from display name.
 */
function getInitials(name: string | undefined): string {
  if (!name) return '?';

  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) {
    return parts[0].charAt(0).toUpperCase();
  }
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

export function ProfileSettingsScreen({ navigation }: Props) {
  const { isSmallScreen } = useResponsive();
  const session = useAuthStore(selectSession);
  const clipboardDetectionEnabled = useSettingsStore(selectClipboardDetectionEnabled);
  const setClipboardDetectionEnabled = useSettingsStore((s) => s.setClipboardDetectionEnabled);
  const subscriptionExpirationDate = useSubscriptionStore((s) => s.expirationDate);
  const { data: profile, isLoading: profileLoading } = useProfile();
  const { data: homeCountry } = useCountryByCode(profile?.home_country_code);
  const { data: userCountries } = useUserCountries();
  const { data: allCountries } = useCountries();
  const updateDisplayName = useUpdateDisplayName();
  // LAUNCH_SIMPLIFICATION: updateProfile only used for tracking preference
  // const updateProfile = useUpdateProfile();
  const signOut = useSignOut();
  const deleteAccount = useDeleteAccount();

  // Photo library permissions
  const { status: photoPermissionStatus, requestPermission: requestPhotoPermission } =
    usePhotoPermissionStatus();

  // Edit mode state
  const [isEditing, setIsEditing] = useState(false);
  const [editedName, setEditedName] = useState('');
  const [nameError, setNameError] = useState<string | undefined>();

  // LAUNCH_SIMPLIFICATION: Tracking preference modal hidden
  // const [trackingModalVisible, setTrackingModalVisible] = useState(false);

  // Export modal state
  const [exportModalVisible, setExportModalVisible] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState(false);
  const copyTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Clipboard permission modal state
  const [clipboardPermissionModalVisible, setClipboardPermissionModalVisible] = useState(false);
  // Clipboard enable modal state (shown when user clicks Enable button)
  const [clipboardEnableModalVisible, setClipboardEnableModalVisible] = useState(false);
  // Delete confirmation modal state (Android only)
  const [deleteConfirmModalVisible, setDeleteConfirmModalVisible] = useState(false);

  // Photo library modal state
  const [photoEnableModalVisible, setPhotoEnableModalVisible] = useState(false);
  const [photoInfoModalVisible, setPhotoInfoModalVisible] = useState(false);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  const handleGoBack = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  const handleStartEditing = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setEditedName(profile?.display_name ?? '');
    setNameError(undefined);
    setIsEditing(true);
  }, [profile?.display_name]);

  const handleCancelEditing = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setIsEditing(false);
    setEditedName('');
    setNameError(undefined);
    Keyboard.dismiss();
  }, []);

  const handleSaveName = useCallback(async () => {
    // Validate before saving
    const validation = validateDisplayName(editedName);
    if (!validation.isValid) {
      setNameError(validation.error);
      return;
    }

    // Don't save if unchanged
    if (validation.trimmedValue === profile?.display_name) {
      setIsEditing(false);
      Keyboard.dismiss();
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      await updateDisplayName.mutateAsync(editedName);
      setIsEditing(false);
      setNameError(undefined);
      Keyboard.dismiss();
    } catch {
      // Error is handled by the mutation's onError
    }
  }, [editedName, profile?.display_name, updateDisplayName]);

  const handleNameChange = useCallback((text: string) => {
    setEditedName(text);
    // Clear error when user starts typing
    setNameError(undefined);
  }, []);

  const handleSignOut = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    signOut.mutate();
  }, [signOut]);

  const handleDeleteAccount = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);

    Alert.alert(
      'Delete Account',
      'This action is permanent and cannot be undone. All your data including trips, entries, and photos will be permanently deleted.\n\nTo confirm, type DELETE below:',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Continue',
          style: 'destructive',
          onPress: () => {
            if (Platform.OS === 'ios') {
              // iOS: Use Alert.prompt
              Alert.prompt(
                'Confirm Deletion',
                'Type DELETE to permanently delete your account:',
                [
                  {
                    text: 'Cancel',
                    style: 'cancel',
                  },
                  {
                    text: 'Delete Forever',
                    style: 'destructive',
                    onPress: (value?: string) => {
                      if (value === 'DELETE') {
                        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
                        deleteAccount.mutate();
                      } else {
                        Alert.alert(
                          'Incorrect Confirmation',
                          'You must type DELETE exactly to confirm account deletion.'
                        );
                      }
                    },
                  },
                ],
                'plain-text',
                '',
                'default'
              );
            } else {
              // Android: Use custom modal
              setDeleteConfirmModalVisible(true);
            }
          },
        },
      ]
    );
  }, [deleteAccount]);

  // LAUNCH_SIMPLIFICATION: Tracking preference modal handlers hidden
  // const handleOpenTrackingModal = useCallback(() => {
  //   Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  //   setTrackingModalVisible(true);
  // }, []);

  // const handleCloseTrackingModal = useCallback(() => {
  //   setTrackingModalVisible(false);
  // }, []);

  // const handleSelectTrackingPreference = useCallback(
  //   async (preset: TrackingPreset) => {
  //     if (preset === profile?.tracking_preference) {
  //       setTrackingModalVisible(false);
  //       return;
  //     }

  //     Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  //     try {
  //       await updateProfile.mutateAsync({ tracking_preference: preset });
  //       setTrackingModalVisible(false);
  //     } catch {
  //       // Error is handled by mutation's onError
  //     }
  //   },
  //   [profile?.tracking_preference, updateProfile]
  // );

  // Export modal handlers
  const handleOpenExportModal = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setExportModalVisible(true);
  }, []);

  const handleCloseExportModal = useCallback(() => {
    setExportModalVisible(false);
    setCopyFeedback(false);
  }, []);

  const handleToggleClipboardDetection = useCallback(
    (enabled: boolean) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setClipboardDetectionEnabled(enabled);
    },
    [setClipboardDetectionEnabled]
  );

  const handleOpenClipboardPermissionModal = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // If already enabled, show the permission info modal
    // If not enabled, show the enable modal
    if (clipboardDetectionEnabled) {
      setClipboardPermissionModalVisible(true);
    } else {
      setClipboardEnableModalVisible(true);
    }
  }, [clipboardDetectionEnabled]);

  const handleCloseClipboardPermissionModal = useCallback(() => {
    setClipboardPermissionModalVisible(false);
  }, []);

  const handleCloseClipboardEnableModal = useCallback(() => {
    setClipboardEnableModalVisible(false);
  }, []);

  const handleEnableClipboard = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setClipboardDetectionEnabled(true);
  }, [setClipboardDetectionEnabled]);

  // Photo library permission handlers
  const handleRequestPhotoPermission = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const newStatus = await requestPhotoPermission();

    if (newStatus === 'denied') {
      // Permission was denied - show the enable modal with Settings instructions
      setPhotoEnableModalVisible(true);
    } else if (newStatus === 'granted' || newStatus === 'limited') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }, [requestPhotoPermission]);

  const handleOpenPhotoEnableModal = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPhotoEnableModalVisible(true);
  }, []);

  const handleClosePhotoEnableModal = useCallback(() => {
    setPhotoEnableModalVisible(false);
  }, []);

  const handleOpenPhotoInfoModal = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPhotoInfoModalVisible(true);
  }, []);

  const handleClosePhotoInfoModal = useCallback(() => {
    setPhotoInfoModalVisible(false);
  }, []);

  const handleConfirmDelete = useCallback(() => {
    setDeleteConfirmModalVisible(false);
    deleteAccount.mutate();
  }, [deleteAccount]);

  const handleCancelDelete = useCallback(() => {
    setDeleteConfirmModalVisible(false);
  }, []);

  const handleOpenTerms = useCallback(() => {
    Linking.openURL(`${env.webBaseUrl}/terms`);
  }, []);

  const handleOpenPrivacy = useCallback(() => {
    Linking.openURL(`${env.webBaseUrl}/privacy`);
  }, []);

  const showOptionsMenu = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const options = ['Terms of Service', 'Privacy Policy', 'Delete Account', 'Cancel'];
    const destructiveButtonIndex = 2;
    const cancelButtonIndex = 3;

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options,
          destructiveButtonIndex,
          cancelButtonIndex,
        },
        (buttonIndex) => {
          if (buttonIndex === 0) {
            handleOpenTerms();
          } else if (buttonIndex === 1) {
            handleOpenPrivacy();
          } else if (buttonIndex === 2) {
            handleDeleteAccount();
          }
        }
      );
    } else {
      Alert.alert('Options', undefined, [
        { text: 'Terms of Service', onPress: handleOpenTerms },
        { text: 'Privacy Policy', onPress: handleOpenPrivacy },
        { text: 'Delete Account', style: 'destructive', onPress: handleDeleteAccount },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  }, [handleDeleteAccount, handleOpenTerms, handleOpenPrivacy]);

  // Memoized values
  const initials = useMemo(() => getInitials(profile?.display_name), [profile?.display_name]);
  const formattedEmail = useMemo(() => session?.user.email || 'Not set', [session?.user.email]);
  const memberSince = useMemo(() => formatMemberSince(profile?.created_at), [profile?.created_at]);
  const homeCountryDisplay = useMemo(() => {
    if (!homeCountry) return null;
    return {
      flag: getFlagEmoji(homeCountry.code),
      name: homeCountry.name,
    };
  }, [homeCountry]);

  // LAUNCH_SIMPLIFICATION: Tracking preference display hidden
  // const trackingPreferenceDisplay = useMemo(() => {
  //   const preset = profile?.tracking_preference ?? 'full_atlas';
  //   const presetData = TRACKING_PRESETS[preset];
  //   return {
  //     name: presetData.name,
  //     count: presetData.count,
  //   };
  // }, [profile?.tracking_preference]);

  // Build export text for country list
  const exportText = useMemo(() => {
    if (!userCountries || !allCountries?.length) return '';

    // Get visited country codes
    const visitedCodes = new Set(
      userCountries.filter((uc) => uc.status === 'visited').map((uc) => uc.country_code)
    );

    // Get full country data for visited countries
    const visitedCountryData = allCountries.filter((c) => visitedCodes.has(c.code));

    // Group by continent
    const byContinent: Record<string, string[]> = {};
    for (const country of visitedCountryData) {
      const region = country.region;
      if (!byContinent[region]) {
        byContinent[region] = [];
      }
      byContinent[region].push(country.name);
    }

    // Sort countries within each continent
    for (const region of Object.keys(byContinent)) {
      byContinent[region].sort((a, b) => a.localeCompare(b));
    }

    // Build text output
    const lines: string[] = ['My Travel Atlas', ''];

    let continentCount = 0;
    for (const region of ALL_REGIONS) {
      const countries = byContinent[region];
      if (countries && countries.length > 0) {
        continentCount++;
        lines.push(`${region.toUpperCase()} (${countries.length})`);
        for (const name of countries) {
          lines.push(`- ${name}`);
        }
        lines.push('');
      }
    }

    // Add summary
    const totalCountries = visitedCountryData.length;
    lines.push(
      `Total: ${totalCountries} ${totalCountries === 1 ? 'country' : 'countries'} across ${continentCount} ${continentCount === 1 ? 'continent' : 'continents'}`
    );

    return lines.join('\n');
  }, [userCountries, allCountries]);

  // Count of visited countries for display
  const visitedCount = useMemo(() => {
    if (!userCountries) return 0;
    return userCountries.filter((uc) => uc.status === 'visited').length;
  }, [userCountries]);

  // Export handlers (must be after exportText is defined)
  const handleShareExport = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await Share.share({ message: exportText });
    } catch (error) {
      // User cancelled or share failed
      if (__DEV__ && error instanceof Error && error.message !== 'User cancelled') {
        console.warn('Share failed:', error);
      }
    }
  }, [exportText]);

  const handleCopyExport = useCallback(async () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await Clipboard.setStringAsync(exportText);
    setCopyFeedback(true);

    // Clear any existing timeout
    if (copyTimeoutRef.current) {
      clearTimeout(copyTimeoutRef.current);
    }

    // Set timeout reference synchronously before async gap
    copyTimeoutRef.current = setTimeout(() => {
      setCopyFeedback(false);
      copyTimeoutRef.current = null;
    }, 2000);
  }, [exportText]);

  if (profileLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.adobeBrick} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Header with back button and menu */}
        <View style={styles.header}>
          <GlassBackButton onPress={handleGoBack} testID="profile-back-button" />
          <Text style={[styles.headerTitle, isSmallScreen && styles.headerTitleSmall]}>
            Profile
          </Text>
          <TouchableOpacity
            onPress={showOptionsMenu}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            activeOpacity={0.8}
            style={styles.headerMenuButton}
            accessibilityLabel="More options"
            testID="profile-menu-button"
          >
            <BlurView intensity={30} tint="light" style={styles.headerMenuGlass}>
              <Ionicons name="ellipsis-horizontal" size={22} color={colors.midnightNavy} />
            </BlurView>
          </TouchableOpacity>
        </View>

        <ProfileAvatar initials={initials} isSmallScreen={isSmallScreen} />

        <ProfileNameSection
          isEditing={isEditing}
          editedName={editedName}
          displayName={profile?.display_name ?? 'Set your name'}
          nameError={nameError}
          isSaving={updateDisplayName.isPending}
          isSmallScreen={isSmallScreen}
          onStartEditing={handleStartEditing}
          onCancelEditing={handleCancelEditing}
          onSaveName={handleSaveName}
          onNameChange={handleNameChange}
        />

        <View style={styles.divider} />

        <SubscriptionSection
          expirationDate={subscriptionExpirationDate}
          isSmallScreen={isSmallScreen}
        />

        <View style={styles.divider} />

        <ProfileInfoSection
          formattedEmail={formattedEmail}
          homeCountryDisplay={homeCountryDisplay}
          memberSince={memberSince}
          // LAUNCH_SIMPLIFICATION: Tracking preference hidden
          // trackingPreferenceDisplay={trackingPreferenceDisplay}
          visitedCount={visitedCount}
          clipboardDetectionEnabled={clipboardDetectionEnabled}
          isSmallScreen={isSmallScreen}
          // LAUNCH_SIMPLIFICATION: Tracking modal hidden
          // onOpenTrackingModal={handleOpenTrackingModal}
          onOpenExportModal={handleOpenExportModal}
          onToggleClipboardDetection={handleToggleClipboardDetection}
          onOpenClipboardPermissionModal={handleOpenClipboardPermissionModal}
          photoPermissionStatus={photoPermissionStatus}
          onRequestPhotoPermission={handleRequestPhotoPermission}
          onOpenPhotoEnableModal={handleOpenPhotoEnableModal}
          onOpenPhotoInfoModal={handleOpenPhotoInfoModal}
        />

        <View style={styles.contactSupportSection}>
          <Pressable
            onPress={() => Linking.openURL('mailto:support@atlasi.app')}
            style={({ pressed }) => [
              styles.contactSupportButton,
              pressed && styles.contactSupportButtonPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Contact support"
          >
            <Text
              style={[styles.contactSupportText, isSmallScreen && styles.contactSupportTextSmall]}
            >
              Contact Support
            </Text>
          </Pressable>
        </View>

        <SignOutSection
          onSignOut={handleSignOut}
          isPending={signOut.isPending}
          isSmallScreen={isSmallScreen}
        />
      </ScrollView>

      {/* LAUNCH_SIMPLIFICATION: Tracking preference modal hidden */}
      {/* <TrackingPreferenceModal
        visible={trackingModalVisible}
        onClose={handleCloseTrackingModal}
        onSelect={handleSelectTrackingPreference}
        currentPreference={profile?.tracking_preference}
      /> */}

      <ExportCountriesModal
        visible={exportModalVisible}
        onClose={handleCloseExportModal}
        exportText={exportText}
        onShare={handleShareExport}
        onCopy={handleCopyExport}
        copyFeedback={copyFeedback}
      />

      <ClipboardPermissionModal
        visible={clipboardPermissionModalVisible}
        onClose={handleCloseClipboardPermissionModal}
      />

      <ClipboardEnableModal
        visible={clipboardEnableModalVisible}
        onClose={handleCloseClipboardEnableModal}
        onEnable={handleEnableClipboard}
      />

      <DeleteConfirmationModal
        visible={deleteConfirmModalVisible}
        onConfirm={handleConfirmDelete}
        onCancel={handleCancelDelete}
      />

      <PhotoLibraryEnableModal
        visible={photoEnableModalVisible}
        onClose={handleClosePhotoEnableModal}
      />

      <PhotoLibraryInfoModal
        visible={photoInfoModalVisible}
        onClose={handleClosePhotoInfoModal}
        isLimitedAccess={photoPermissionStatus === 'limited'}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.warmCream,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 120, // Extra padding to clear tab bar
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 16,
  },
  headerTitle: {
    fontFamily: fonts.playfair.bold,
    fontSize: 28,
    color: colors.midnightNavy,
    fontStyle: 'italic',
    letterSpacing: -0.5,
  },
  headerTitleSmall: {
    fontSize: 24,
  },
  headerMenuButton: {
    borderRadius: 22,
    overflow: 'hidden',
  },
  headerMenuGlass: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.6)',
  },
  divider: {
    height: 1,
    backgroundColor: colors.paperBeige,
    marginHorizontal: 24,
    marginVertical: 8,
  },
  contactSupportSection: {
    alignItems: 'center',
    paddingTop: 16,
    paddingHorizontal: 24,
  },
  contactSupportButton: {
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 9999,
    borderWidth: 1,
    borderColor: colors.midnightNavy,
    minWidth: 140,
    alignItems: 'center',
  },
  contactSupportButtonPressed: {
    opacity: 0.7,
    backgroundColor: 'rgba(26, 26, 46, 0.05)',
  },
  contactSupportText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 16,
    color: colors.midnightNavy,
  },
  contactSupportTextSmall: {
    fontSize: 14,
  },
});
