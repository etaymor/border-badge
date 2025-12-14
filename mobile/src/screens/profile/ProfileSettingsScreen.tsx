import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, GlassBackButton, GlassInput } from '@components/ui';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { useSignOut } from '@hooks/useAuth';
import { useCountryByCode } from '@hooks/useCountries';
import { useProfile } from '@hooks/useProfile';
import { useUpdateDisplayName } from '@hooks/useUpdateDisplayName';
import { useAuthStore } from '@stores/authStore';
import { validateDisplayName } from '@utils/displayNameValidation';
import { getFlagEmoji } from '@utils/flags';
import type { PassportStackScreenProps } from '@navigation/types';

type Props = PassportStackScreenProps<'ProfileSettings'>;

/**
 * Format E.164 phone number to readable format.
 * +12025551234 → +1 (202) 555-1234
 * 15555555555 → +1 (555) 555-5555
 * +447911123456 → +44 7911 123 456
 * +33612345678 → +33 6 12 34 56 78
 */
function formatPhoneNumber(phone: string | undefined): string {
  if (!phone) return 'Not set';

  // Remove any non-digit characters except leading +
  let cleaned = phone.replace(/[^\d+]/g, '');

  // Normalize: if starts with 1 and is 11 digits (US without +), add +
  if (!cleaned.startsWith('+') && cleaned.startsWith('1') && cleaned.length === 11) {
    cleaned = '+' + cleaned;
  }

  // Handle US/Canada numbers (+1XXXXXXXXXX)
  if (cleaned.startsWith('+1') && cleaned.length === 12) {
    const area = cleaned.slice(2, 5);
    const first = cleaned.slice(5, 8);
    const last = cleaned.slice(8, 12);
    return `+1 (${area}) ${first}-${last}`;
  }

  // Handle UK numbers (+44...)
  if (cleaned.startsWith('+44') && cleaned.length >= 12) {
    const rest = cleaned.slice(3);
    // Format as +44 XXXX XXX XXX
    const formatted = rest.replace(/(\d{4})(\d{3})(\d{3})/, '$1 $2 $3');
    return `+44 ${formatted}`;
  }

  // Handle French numbers (+33...)
  if (cleaned.startsWith('+33') && cleaned.length === 12) {
    const rest = cleaned.slice(3);
    // Format as +33 X XX XX XX XX
    const formatted = rest.replace(/(\d)(\d{2})(\d{2})(\d{2})(\d{2})/, '$1 $2 $3 $4 $5');
    return `+33 ${formatted}`;
  }

  // Handle German numbers (+49...)
  if (cleaned.startsWith('+49') && cleaned.length >= 12) {
    const rest = cleaned.slice(3);
    // Format as +49 XXX XXXXXXX
    const formatted = rest.replace(/(\d{3})(\d+)/, '$1 $2');
    return `+49 ${formatted}`;
  }

  // For other international numbers, detect country code and format nicely
  if (cleaned.startsWith('+')) {
    // Common country code lengths: 1-3 digits after +
    // Try to detect based on known patterns
    let countryCodeLen = 1;
    const digits = cleaned.slice(1);

    // 3-digit country codes (e.g., +355 Albania, +852 Hong Kong)
    if (digits.length > 10) {
      countryCodeLen = 3;
    } else if (digits.length > 9) {
      countryCodeLen = 2;
    }

    const countryCode = cleaned.slice(0, countryCodeLen + 1);
    const rest = cleaned.slice(countryCodeLen + 1);

    // Group remaining digits in chunks of 3-4 for readability
    const formatted = rest.replace(/(\d{3,4})(?=\d)/g, '$1 ').trim();
    return `${countryCode} ${formatted}`;
  }

  return phone;
}

/**
 * Format date to readable format.
 * 2025-01-15T12:00:00Z → January 2025
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
 * "John Doe" → "JD"
 * "Jane" → "J"
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
  const { session } = useAuthStore();
  const { data: profile, isLoading: profileLoading } = useProfile();
  const { data: homeCountry } = useCountryByCode(profile?.home_country_code);
  const updateDisplayName = useUpdateDisplayName();
  const signOut = useSignOut();

  // Edit mode state
  const [isEditing, setIsEditing] = useState(false);
  const [editedName, setEditedName] = useState('');
  const [nameError, setNameError] = useState<string | undefined>();

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

  // Memoized values
  const initials = useMemo(() => getInitials(profile?.display_name), [profile?.display_name]);
  const formattedPhone = useMemo(
    () => formatPhoneNumber(session?.user.phone),
    [session?.user.phone]
  );
  const memberSince = useMemo(() => formatMemberSince(profile?.created_at), [profile?.created_at]);
  const homeCountryDisplay = useMemo(() => {
    if (!homeCountry) return null;
    return {
      flag: getFlagEmoji(homeCountry.code),
      name: homeCountry.name,
    };
  }, [homeCountry]);

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
          <Text style={styles.headerTitle}>Profile</Text>
          <View style={styles.headerSpacer} />
        </View>

        {/* Avatar Section */}
        <View style={styles.avatarSection}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
        </View>

        {/* Display Name Section */}
        <View style={styles.nameSection}>
          {isEditing ? (
            <View style={styles.nameEditContainer}>
              <GlassInput
                value={editedName}
                onChangeText={handleNameChange}
                placeholder="Enter your name"
                autoFocus
                error={nameError}
                maxLength={50}
                returnKeyType="done"
                onSubmitEditing={handleSaveName}
                containerStyle={styles.nameInput}
              />
              <View style={styles.editButtons}>
                <Pressable
                  onPress={handleCancelEditing}
                  style={styles.cancelButton}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel editing"
                >
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </Pressable>
                <Button
                  title={updateDisplayName.isPending ? 'Saving...' : 'Save'}
                  onPress={handleSaveName}
                  disabled={updateDisplayName.isPending}
                  style={styles.saveButton}
                />
              </View>
            </View>
          ) : (
            <Pressable
              onPress={handleStartEditing}
              style={styles.nameDisplay}
              accessibilityRole="button"
              accessibilityLabel="Edit display name"
              accessibilityHint="Double tap to edit your display name"
            >
              <Text style={styles.displayName}>{profile?.display_name ?? 'Set your name'}</Text>
              <Ionicons
                name="pencil-outline"
                size={20}
                color={colors.stormGray}
                style={styles.editIcon}
              />
            </Pressable>
          )}
        </View>

        {/* Divider */}
        <View style={styles.divider} />

        {/* Info Sections */}
        <View style={styles.infoSection}>
          {/* Phone */}
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>PHONE</Text>
            <Text style={styles.infoValue}>{formattedPhone}</Text>
          </View>

          {/* Home Country */}
          {homeCountryDisplay && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>HOME COUNTRY</Text>
              <Text style={styles.infoValue}>
                {homeCountryDisplay.flag} {homeCountryDisplay.name}
              </Text>
            </View>
          )}

          {/* Member Since */}
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>MEMBER SINCE</Text>
            <Text style={styles.infoValue}>{memberSince}</Text>
          </View>
        </View>

        {/* Divider */}
        <View style={styles.divider} />

        {/* Sign Out */}
        <View style={styles.signOutSection}>
          <Pressable
            onPress={handleSignOut}
            disabled={signOut.isPending}
            style={({ pressed }) => [styles.signOutButton, pressed && styles.signOutButtonPressed]}
            accessibilityRole="button"
            accessibilityLabel="Sign out"
            testID="sign-out-button"
          >
            {signOut.isPending ? (
              <ActivityIndicator size="small" color={colors.adobeBrick} />
            ) : (
              <Text style={styles.signOutText}>Sign Out</Text>
            )}
          </Pressable>
        </View>
      </ScrollView>
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
  // Header
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
    fontSize: 20,
    color: colors.midnightNavy,
  },
  headerSpacer: {
    width: 44, // Match back button width for centering
  },
  // Avatar
  avatarSection: {
    alignItems: 'center',
    paddingTop: 24,
    paddingBottom: 16,
  },
  avatarCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.adobeBrick,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: colors.midnightNavy,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  avatarText: {
    fontFamily: fonts.playfair.bold,
    fontSize: 32,
    color: colors.cloudWhite,
  },
  // Name Section
  nameSection: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 24,
  },
  nameDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 12,
  },
  displayName: {
    fontFamily: fonts.playfair.bold,
    fontSize: 24,
    color: colors.midnightNavy,
  },
  editIcon: {
    marginLeft: 8,
    opacity: 0.6,
  },
  nameEditContainer: {
    width: '100%',
  },
  nameInput: {
    marginBottom: 12,
  },
  editButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  cancelButton: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cancelButtonText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 16,
    color: colors.stormGray,
  },
  saveButton: {
    minWidth: 100,
  },
  // Divider
  divider: {
    height: 1,
    backgroundColor: colors.paperBeige,
    marginHorizontal: 24,
    marginVertical: 8,
  },
  // Info Section
  infoSection: {
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
  infoRow: {
    marginBottom: 20,
  },
  infoLabel: {
    fontFamily: fonts.oswald.medium,
    fontSize: 12,
    color: colors.stormGray,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  infoValue: {
    fontFamily: fonts.openSans.regular,
    fontSize: 16,
    color: colors.midnightNavy,
  },
  // Sign Out
  signOutSection: {
    alignItems: 'center',
    paddingTop: 24,
    paddingHorizontal: 24,
  },
  signOutButton: {
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.adobeBrick,
    minWidth: 140,
    alignItems: 'center',
  },
  signOutButtonPressed: {
    opacity: 0.7,
    backgroundColor: 'rgba(193, 84, 62, 0.05)',
  },
  signOutText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 16,
    color: colors.adobeBrick,
  },
});
