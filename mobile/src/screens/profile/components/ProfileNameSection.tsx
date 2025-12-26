import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button, GlassInput } from '@components/ui';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';

interface ProfileNameSectionProps {
  isEditing: boolean;
  editedName: string;
  displayName: string;
  username?: string;
  nameError?: string;
  isSaving: boolean;
  isSmallScreen?: boolean;
  onStartEditing: () => void;
  onCancelEditing: () => void;
  onSaveName: () => void;
  onNameChange: (text: string) => void;
}

export function ProfileNameSection({
  isEditing,
  editedName,
  displayName,
  username,
  nameError,
  isSaving,
  isSmallScreen,
  onStartEditing,
  onCancelEditing,
  onSaveName,
  onNameChange,
}: ProfileNameSectionProps) {
  return (
    <View style={styles.nameSection}>
      {isEditing ? (
        <View style={styles.nameEditContainer}>
          <GlassInput
            value={editedName}
            onChangeText={onNameChange}
            placeholder="Enter your name"
            autoFocus
            error={nameError}
            maxLength={50}
            returnKeyType="done"
            onSubmitEditing={onSaveName}
            containerStyle={styles.nameInput}
          />
          <View style={styles.editButtons}>
            <Pressable
              onPress={onCancelEditing}
              style={styles.cancelButton}
              accessibilityRole="button"
              accessibilityLabel="Cancel editing"
            >
              <Text
                style={[styles.cancelButtonText, isSmallScreen && styles.cancelButtonTextSmall]}
              >
                Cancel
              </Text>
            </Pressable>
            <Button
              title={isSaving ? 'Saving...' : 'Save'}
              onPress={onSaveName}
              disabled={isSaving}
              style={styles.saveButton}
            />
          </View>
        </View>
      ) : (
        <View style={styles.nameDisplayContainer}>
          <Pressable
            onPress={onStartEditing}
            style={styles.nameDisplay}
            accessibilityRole="button"
            accessibilityLabel="Edit display name"
            accessibilityHint="Double tap to edit your display name"
          >
            <Text style={[styles.displayName, isSmallScreen && styles.displayNameSmall]}>
              {displayName}
            </Text>
            <Ionicons
              name="pencil-outline"
              size={20}
              color={colors.stormGray}
              style={styles.editIcon}
            />
          </Pressable>
          {username && (
            <Text style={[styles.username, isSmallScreen && styles.usernameSmall]}>
              @{username}
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  nameSection: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 4,
    paddingBottom: 16,
  },
  nameDisplayContainer: {
    alignItems: 'center',
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
  cancelButtonTextSmall: {
    fontSize: 14,
  },
  saveButton: {
    minWidth: 100,
  },
  displayNameSmall: {
    fontSize: 20,
  },
  username: {
    fontFamily: fonts.openSans.regular,
    fontSize: 16,
    color: colors.stormGray,
    marginTop: 2,
  },
  usernameSmall: {
    fontSize: 14,
  },
});
