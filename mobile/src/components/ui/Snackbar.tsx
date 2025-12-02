import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, Pressable, ViewStyle } from 'react-native';
import { Text } from './Text';

interface SnackbarProps {
  /** Whether the snackbar is visible */
  visible: boolean;
  /** Message to display */
  message: string;
  /** Optional action button text (e.g., "Undo") */
  actionLabel?: string;
  /** Action callback */
  onAction?: () => void;
  /** Called when snackbar should be dismissed */
  onDismiss: () => void;
  /** Duration in ms before auto-dismiss (default 4000, 0 to disable) */
  duration?: number;
  /** Custom container style */
  style?: ViewStyle;
  /** Base testID for E2E testing (creates {testID} and {testID}-action) */
  testID?: string;
}

export function Snackbar({
  visible,
  message,
  actionLabel,
  onAction,
  onDismiss,
  duration = 4000,
  style,
  testID,
}: SnackbarProps) {
  const translateY = useRef(new Animated.Value(100)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      // Slide in
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();

      // Auto-dismiss
      if (duration > 0) {
        const timer = setTimeout(() => {
          onDismiss();
        }, duration);
        return () => clearTimeout(timer);
      }
    } else {
      // Slide out
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: 100,
          duration: 150,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0,
          duration: 150,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible, duration, onDismiss, translateY, opacity]);

  if (!visible) {
    return null;
  }

  return (
    <Animated.View
      style={[
        styles.container,
        style,
        {
          transform: [{ translateY }],
          opacity,
        },
      ]}
      testID={testID}
    >
      <View style={styles.content}>
        <Text variant="body" style={styles.message} numberOfLines={2}>
          {message}
        </Text>
        {actionLabel && onAction && (
          <Pressable
            onPress={onAction}
            hitSlop={8}
            testID={testID ? `${testID}-action` : undefined}
          >
            <Text variant="label" style={styles.action}>
              {actionLabel}
            </Text>
          </Pressable>
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 24,
    left: 16,
    right: 16,
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 6,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 12,
  },
  message: {
    color: '#fff',
    flex: 1,
  },
  action: {
    color: '#007AFF',
    fontWeight: '600',
  },
});
