import { Modal, StyleSheet, View, Pressable } from 'react-native';
import { Text } from './Text';
import { Button } from './Button';

interface ConfirmDialogProps {
  /** Whether the dialog is visible */
  visible: boolean;
  /** Dialog title */
  title: string;
  /** Dialog message/description */
  message: string;
  /** Confirm button text */
  confirmLabel?: string;
  /** Cancel button text */
  cancelLabel?: string;
  /** Whether this is a destructive action (shows confirm button in red) */
  destructive?: boolean;
  /** Whether confirm action is loading */
  loading?: boolean;
  /** Called when confirm is pressed */
  onConfirm: () => void;
  /** Called when cancel is pressed or dialog is dismissed */
  onCancel: () => void;
  /** Base testID for E2E testing (creates {testID}-confirm and {testID}-cancel) */
  testID?: string;
}

export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  loading = false,
  onConfirm,
  onCancel,
  testID,
}: ConfirmDialogProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.overlay} onPress={onCancel}>
        <Pressable style={styles.dialog} onPress={(e) => e.stopPropagation()}>
          <Text variant="subtitle" style={styles.title}>
            {title}
          </Text>
          <Text variant="body" style={styles.message}>
            {message}
          </Text>
          <View style={styles.buttons}>
            <Button
              title={cancelLabel}
              onPress={onCancel}
              variant="ghost"
              style={styles.button}
              disabled={loading}
              testID={testID ? `${testID}-cancel` : undefined}
            />
            <Button
              title={confirmLabel}
              onPress={onConfirm}
              variant={destructive ? 'primary' : 'primary'}
              style={
                destructive ? { ...styles.button, ...styles.destructiveButton } : styles.button
              }
              textStyle={destructive ? styles.destructiveText : undefined}
              loading={loading}
              testID={testID ? `${testID}-confirm` : undefined}
            />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  dialog: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 340,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  title: {
    textAlign: 'center',
    marginBottom: 8,
  },
  message: {
    textAlign: 'center',
    color: '#666',
    marginBottom: 24,
  },
  buttons: {
    flexDirection: 'row',
    gap: 12,
  },
  button: {
    flex: 1,
  },
  destructiveButton: {
    backgroundColor: '#FF3B30',
  },
  destructiveText: {
    color: '#fff',
  },
});
