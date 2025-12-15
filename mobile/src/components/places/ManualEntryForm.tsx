/**
 * Manual place entry form component.
 * Used when Google Places API is unavailable or user chooses to enter manually.
 */

import { memo, useCallback, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';

import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import type { SelectedPlace } from '@services/placesApi';

interface ManualEntryFormProps {
  initialName?: string;
  onSubmit: (place: SelectedPlace) => void;
  onCancel: () => void;
  testID?: string;
}

export const ManualEntryForm = memo(function ManualEntryForm({
  initialName = '',
  onSubmit,
  onCancel,
  testID = 'places-search',
}: ManualEntryFormProps) {
  const [manualName, setManualName] = useState(initialName);
  const [manualAddress, setManualAddress] = useState('');

  const handleSubmit = useCallback(() => {
    if (!manualName.trim()) return;

    const selectedPlace: SelectedPlace = {
      google_place_id: `manual_${Date.now()}`,
      name: manualName.trim(),
      address: manualAddress.trim() || null,
      latitude: null,
      longitude: null,
      google_photo_url: null,
      website_url: null,
    };

    onSubmit(selectedPlace);
    Keyboard.dismiss();
  }, [manualName, manualAddress, onSubmit]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Enter Place Details</Text>
        <Pressable onPress={onCancel} hitSlop={8}>
          <Ionicons name="close" size={24} color={colors.textSecondary} />
        </Pressable>
      </View>

      <View style={styles.inputWrapper}>
        <BlurView intensity={40} tint="light" style={styles.inputBlur}>
          <TextInput
            style={styles.input}
            placeholder="Place name *"
            placeholderTextColor={colors.textTertiary}
            value={manualName}
            onChangeText={setManualName}
            returnKeyType="next"
            maxLength={100}
            testID={`${testID}-manual-name`}
          />
        </BlurView>
      </View>

      <View style={styles.inputWrapper}>
        <BlurView intensity={40} tint="light" style={styles.inputBlur}>
          <TextInput
            style={styles.input}
            placeholder="Address (optional)"
            placeholderTextColor={colors.textTertiary}
            value={manualAddress}
            onChangeText={setManualAddress}
            returnKeyType="done"
            maxLength={200}
            onSubmitEditing={handleSubmit}
            testID={`${testID}-manual-address`}
          />
        </BlurView>
      </View>

      <Pressable
        style={[styles.button, !manualName.trim() && styles.buttonDisabled]}
        onPress={handleSubmit}
        disabled={!manualName.trim()}
        testID={`${testID}-manual-submit`}
      >
        <Text style={styles.buttonText}>Add Place</Text>
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    borderRadius: 12,
    padding: 16,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 16,
    fontFamily: fonts.playfair.bold,
    color: colors.midnightNavy,
  },
  inputWrapper: {
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.6)',
  },
  inputBlur: {
    minHeight: 48,
    backgroundColor: 'rgba(255, 255, 255, 0.7)',
  },
  input: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    fontFamily: fonts.openSans.regular,
    color: colors.textPrimary,
  },
  button: {
    backgroundColor: colors.sunsetGold,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonDisabled: {
    backgroundColor: colors.backgroundMuted,
  },
  buttonText: {
    fontSize: 16,
    fontFamily: fonts.openSans.semiBold,
    color: colors.midnightNavy,
  },
});
