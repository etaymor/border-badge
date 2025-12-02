import { StyleSheet, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from './Text';
import { Button } from './Button';

interface ErrorStateProps {
  /** Main error title */
  title?: string;
  /** Error description or message */
  message?: string;
  /** Retry button label */
  retryLabel?: string;
  /** Retry callback */
  onRetry?: () => void;
  /** Custom container style */
  style?: ViewStyle;
}

export function ErrorState({
  title = 'Something went wrong',
  message = 'Please try again later.',
  retryLabel = 'Try Again',
  onRetry,
  style,
}: ErrorStateProps) {
  return (
    <View style={[styles.container, style]}>
      <View style={styles.iconContainer}>
        <Ionicons name="alert-circle-outline" size={64} color="#FF3B30" />
      </View>
      <Text variant="subtitle" style={styles.title}>
        {title}
      </Text>
      <Text variant="body" style={styles.message}>
        {message}
      </Text>
      {onRetry && (
        <Button title={retryLabel} onPress={onRetry} variant="outline" style={styles.button} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  iconContainer: {
    marginBottom: 16,
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
  button: {
    minWidth: 150,
  },
});
