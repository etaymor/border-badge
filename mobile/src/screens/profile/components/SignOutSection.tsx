import React, { useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, StyleSheet, Alert } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';

interface SignOutSectionProps {
  onSignOut: () => void;
  isPending: boolean;
  isSmallScreen?: boolean;
}

// Keys that need to be cleared from keychain
const KEYCHAIN_KEYS = [
  'auth_token',
  'refresh_token',
  'onboarding_complete',
  'supabase.auth.token', // Supabase session key
];

// Keychain access group - must match api.ts and supabase.ts
const KEYCHAIN_ACCESS_GROUP = '2AB5M8J3G6.com.atlasi.app';

/**
 * Force clear all keychain entries - both with and without access group.
 * This is a nuclear option for when keychain gets into a bad state.
 */
async function forceClearAllKeychain(): Promise<void> {
  const errors: string[] = [];

  for (const key of KEYCHAIN_KEYS) {
    // Try to delete from shared keychain (with access group)
    try {
      await SecureStore.deleteItemAsync(key, { accessGroup: KEYCHAIN_ACCESS_GROUP });
    } catch (e) {
      errors.push(`shared/${key}: ${e}`);
    }

    // Try to delete from default keychain (without access group)
    try {
      await SecureStore.deleteItemAsync(key);
    } catch (e) {
      errors.push(`default/${key}: ${e}`);
    }
  }

  if (errors.length > 0) {
    console.warn('Force clear keychain errors (may be expected):', errors);
  }
}

export function SignOutSection({ onSignOut, isPending, isSmallScreen }: SignOutSectionProps) {
  const [isForceClearing, setIsForceClearing] = useState(false);

  const handleLongPress = () => {
    Alert.alert(
      'Force Clear Session',
      'This will clear all authentication data from the keychain. Use this if you are stuck and cannot sign out normally.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Force Clear',
          style: 'destructive',
          onPress: async () => {
            setIsForceClearing(true);
            try {
              await forceClearAllKeychain();
              Alert.alert(
                'Cleared',
                'Keychain cleared. Please restart the app.',
                [{ text: 'OK' }]
              );
            } catch (error) {
              Alert.alert('Error', `Failed to clear keychain: ${error}`);
            } finally {
              setIsForceClearing(false);
            }
          },
        },
      ]
    );
  };

  return (
    <View style={styles.signOutSection}>
      <Pressable
        onPress={onSignOut}
        onLongPress={handleLongPress}
        delayLongPress={2000}
        disabled={isPending || isForceClearing}
        style={({ pressed }) => [styles.signOutButton, pressed && styles.signOutButtonPressed]}
        accessibilityRole="button"
        accessibilityLabel="Sign out"
        accessibilityHint="Long press for 2 seconds to force clear session"
        testID="sign-out-button"
      >
        {isPending || isForceClearing ? (
          <ActivityIndicator size="small" color={colors.adobeBrick} />
        ) : (
          <Text style={[styles.signOutText, isSmallScreen && styles.signOutTextSmall]}>
            Sign Out
          </Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  signOutSection: {
    alignItems: 'center',
    paddingTop: 16,
    paddingHorizontal: 24,
    paddingBottom: 24,
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
  signOutTextSmall: {
    fontSize: 14,
  },
});
