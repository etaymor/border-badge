import React from 'react';
import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';

interface SignOutSectionProps {
  onSignOut: () => void;
  isPending: boolean;
}

export function SignOutSection({ onSignOut, isPending }: SignOutSectionProps) {
  return (
    <View style={styles.signOutSection}>
      <Pressable
        onPress={onSignOut}
        disabled={isPending}
        style={({ pressed }) => [styles.signOutButton, pressed && styles.signOutButtonPressed]}
        accessibilityRole="button"
        accessibilityLabel="Sign out"
        testID="sign-out-button"
      >
        {isPending ? (
          <ActivityIndicator size="small" color={colors.adobeBrick} />
        ) : (
          <Text style={styles.signOutText}>Sign Out</Text>
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
});
