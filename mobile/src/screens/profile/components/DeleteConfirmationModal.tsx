import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';

interface DeleteConfirmationModalProps {
  visible: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DeleteConfirmationModal({
  visible,
  onConfirm,
  onCancel,
}: DeleteConfirmationModalProps) {
  const [confirmText, setConfirmText] = useState('');

  const handleConfirm = () => {
    if (confirmText === 'DELETE') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setConfirmText('');
      onConfirm();
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      // Clear the input and show it's incorrect
      setConfirmText('');
    }
  };

  const handleCancel = () => {
    setConfirmText('');
    onCancel();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleCancel}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.overlay}
      >
        <Pressable style={styles.backdrop} onPress={handleCancel} />
        <View style={styles.modalContent}>
          <Text style={styles.title}>Confirm Deletion</Text>
          <Text style={styles.message}>
            Type DELETE to permanently delete your account:
          </Text>
          <TextInput
            style={styles.input}
            value={confirmText}
            onChangeText={setConfirmText}
            placeholder="DELETE"
            autoCapitalize="characters"
            autoCorrect={false}
            autoFocus
          />
          <View style={styles.buttonRow}>
            <Pressable
              style={({ pressed }) => [
                styles.button,
                styles.cancelButton,
                pressed && styles.buttonPressed,
              ]}
              onPress={handleCancel}
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.button,
                styles.deleteButton,
                pressed && styles.buttonPressed,
              ]}
              onPress={handleConfirm}
            >
              <Text style={styles.deleteButtonText}>Delete Forever</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalContent: {
    backgroundColor: colors.warmCream,
    borderRadius: 12,
    padding: 24,
    width: '85%',
    maxWidth: 400,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 5,
  },
  title: {
    fontFamily: fonts.playfair.bold,
    fontSize: 20,
    color: colors.midnightNavy,
    marginBottom: 12,
    textAlign: 'center',
  },
  message: {
    fontFamily: fonts.openSans.regular,
    fontSize: 15,
    color: colors.midnightNavy,
    marginBottom: 16,
    lineHeight: 22,
  },
  input: {
    fontFamily: fonts.openSans.regular,
    fontSize: 16,
    color: colors.midnightNavy,
    backgroundColor: colors.paleIvory,
    borderWidth: 1,
    borderColor: colors.paperBeige,
    borderRadius: 8,
    padding: 12,
    marginBottom: 20,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  button: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonPressed: {
    opacity: 0.7,
  },
  cancelButton: {
    backgroundColor: colors.paperBeige,
  },
  cancelButtonText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 15,
    color: colors.midnightNavy,
  },
  deleteButton: {
    backgroundColor: colors.adobeBrick,
  },
  deleteButtonText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 15,
    color: colors.warmCream,
  },
});
