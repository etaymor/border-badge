import { ActivityIndicator, StyleSheet, View, ViewStyle } from 'react-native';
import { Text } from './Text';

interface LoadingProps {
  /** Optional message to display below spinner */
  message?: string;
  /** Size of the spinner */
  size?: 'small' | 'large';
  /** Whether to center in full screen */
  fullScreen?: boolean;
  /** Custom container style */
  style?: ViewStyle;
}

export function Loading({ message, size = 'large', fullScreen = false, style }: LoadingProps) {
  return (
    <View style={[styles.container, fullScreen && styles.fullScreen, style]}>
      <ActivityIndicator size={size} color="#007AFF" />
      {message && (
        <Text variant="caption" style={styles.message}>
          {message}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  fullScreen: {
    flex: 1,
  },
  message: {
    marginTop: 12,
    textAlign: 'center',
  },
});
