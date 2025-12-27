import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GlassBackButton } from '@components/ui';
import { colors } from '@constants/colors';
import { ALL_REGIONS } from '@constants/regions';
import { TRACKING_PRESETS, type TrackingPreset } from '@constants/trackingPreferences';
import { fonts } from '@constants/typography';
import { useResponsive } from '@hooks/useResponsive';
import { useSignOut } from '@hooks/useAuth';
import { useCountries, useCountryByCode } from '@hooks/useCountries';
import { useProfile, useUpdateProfile } from '@hooks/useProfile';
import { useUserCountries } from '@hooks/useUserCountries';
import { useUpdateDisplayName } from '@hooks/useUpdateDisplayName';
import { useAuthStore } from '@stores/authStore';
import { useSettingsStore, selectClipboardDetectionEnabled } from '@stores/settingsStore';
import { validateDisplayName } from '@utils/displayNameValidation';
import { getFlagEmoji } from '@utils/flags';
import { Share } from '@utils/share';
import type { PassportStackScreenProps } from '@navigation/types';

import { ProfileAvatar } from './components/ProfileAvatar';
import { ProfileNameSection } from './components/ProfileNameSection';
import { ProfileInfoSection } from './components/ProfileInfoSection';
import { SignOutSection } from './components/SignOutSection';
import { TrackingPreferenceModal } from './components/TrackingPreferenceModal';
import { ExportCountriesModal } from './components/ExportCountriesModal';
import { ClipboardPermissionModal } from './components/ClipboardPermissionModal';

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
  const { session } = useAuthStore();
  const clipboardDetectionEnabled = useSettingsStore(selectClipboardDetectionEnabled);
  const setClipboardDetectionEnabled = useSettingsStore((s) => s.setClipboardDetectionEnabled);
  const { data: profile, isLoading: profileLoading } = useProfile();
  const { data: homeCountry } = useCountryByCode(profile?.home_country_code);
  const { data: userCountries } = useUserCountries();
  const { data: allCountries } = useCountries();
  const updateDisplayName = useUpdateDisplayName();
  const updateProfile = useUpdateProfile();
  const signOut = useSignOut();

  // Edit mode state
  const [isEditing, setIsEditing] = useState(false);
  const [editedName, setEditedName] = useState('');
  const [nameError, setNameError] = useState<string | undefined>();

  // Tracking preference modal state
  const [trackingModalVisible, setTrackingModalVisible] = useState(false);

  // Export modal state
  const [exportModalVisible, setExportModalVisible] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState(false);
  const copyTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Clipboard permission modal state
  const [clipboardPermissionModalVisible, setClipboardPermissionModalVisible] = useState(false);

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

  const handleOpenTrackingModal = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setTrackingModalVisible(true);
  }, []);

  const handleCloseTrackingModal = useCallback(() => {
    setTrackingModalVisible(false);
  }, []);

  const handleSelectTrackingPreference = useCallback(
    async (preset: TrackingPreset) => {
      if (preset === profile?.tracking_preference) {
        setTrackingModalVisible(false);
        return;
      }

      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      try {
        await updateProfile.mutateAsync({ tracking_preference: preset });
        setTrackingModalVisible(false);
      } catch {
        // Error is handled by mutation's onError
      }
    },
    [profile?.tracking_preference, updateProfile]
  );

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
    setClipboardPermissionModalVisible(true);
  }, []);

  const handleCloseClipboardPermissionModal = useCallback(() => {
    setClipboardPermissionModalVisible(false);
  }, []);

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

  const trackingPreferenceDisplay = useMemo(() => {
    const preset = profile?.tracking_preference ?? 'full_atlas';
    const presetData = TRACKING_PRESETS[preset];
    return {
      name: presetData.name,
      count: presetData.count,
    };
  }, [profile?.tracking_preference]);

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
        {/* Header with back button */}
        <View style={styles.header}>
          <GlassBackButton onPress={handleGoBack} testID="profile-back-button" />
          <Text style={[styles.headerTitle, isSmallScreen && styles.headerTitleSmall]}>
            Profile
          </Text>
          <View style={styles.headerSpacer} />
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

        <ProfileInfoSection
          formattedEmail={formattedEmail}
          homeCountryDisplay={homeCountryDisplay}
          memberSince={memberSince}
          trackingPreferenceDisplay={trackingPreferenceDisplay}
          visitedCount={visitedCount}
          clipboardDetectionEnabled={clipboardDetectionEnabled}
          isSmallScreen={isSmallScreen}
          onOpenTrackingModal={handleOpenTrackingModal}
          onOpenExportModal={handleOpenExportModal}
          onToggleClipboardDetection={handleToggleClipboardDetection}
          onOpenClipboardPermissionModal={handleOpenClipboardPermissionModal}
        />

        <View style={styles.divider} />

        <SignOutSection
          onSignOut={handleSignOut}
          isPending={signOut.isPending}
          isSmallScreen={isSmallScreen}
        />
      </ScrollView>

      <TrackingPreferenceModal
        visible={trackingModalVisible}
        onClose={handleCloseTrackingModal}
        onSelect={handleSelectTrackingPreference}
        currentPreference={profile?.tracking_preference}
      />

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
    paddingBottom: 40,
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
  headerSpacer: {
    width: 44, // Match back button width for centering
  },
  divider: {
    height: 1,
    backgroundColor: colors.paperBeige,
    marginHorizontal: 24,
    marginVertical: 8,
  },
});
