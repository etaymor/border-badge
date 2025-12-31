import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from './Text';
import { Button } from './Button';

interface EmptyStateProps {
  /** Icon name from Ionicons */
  icon?: keyof typeof Ionicons.glyphMap;
  /** Main title */
  title: string;
  /** Optional description */
  description?: string;
  /** Optional action button text */
  actionLabel?: string;
  /** Optional action callback */
  onAction?: () => void;
  /** Custom container style */
  style?: ViewStyle;
}

// Create AnimatedIonicons for the floating animation
const AnimatedIonicons = Animated.createAnimatedComponent(Ionicons);

export function EmptyState({
  icon = 'folder-open-outline',
  title,
  description,
  actionLabel,
  onAction,
  style,
}: EmptyStateProps) {
  // Entrance fade-in and slide up animation
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;

  // Floating animation for icon
  const floatAnim = useRef(new Animated.Value(0)).current;
  const floatLoopRef = useRef<Animated.CompositeAnimation | null>(null);

  // Start entrance animation on mount
  useEffect(() => {
    // Staggered entrance: icon first, then content
    Animated.sequence([
      // Icon entrance
      Animated.parallel([
        Animated.spring(fadeAnim, {
          toValue: 1,
          friction: 8,
          tension: 60,
          useNativeDriver: true,
        }),
        Animated.spring(slideAnim, {
          toValue: 0,
          friction: 8,
          tension: 60,
          useNativeDriver: true,
        }),
      ]),
    ]).start();

    // Start floating animation for icon after entrance
    const floatDelay = setTimeout(() => {
      floatLoopRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(floatAnim, {
            toValue: -6,
            duration: 1500,
            useNativeDriver: true,
          }),
          Animated.timing(floatAnim, {
            toValue: 0,
            duration: 1500,
            useNativeDriver: true,
          }),
        ])
      );
      floatLoopRef.current.start();
    }, 600); // Start float after entrance completes

    return () => {
      clearTimeout(floatDelay);
      if (floatLoopRef.current) {
        floatLoopRef.current.stop();
        floatLoopRef.current = null;
      }
    };
  }, [fadeAnim, slideAnim, floatAnim]);

  return (
    <View style={[styles.container, style]}>
      <Animated.View
        style={[
          styles.iconWrapper,
          {
            opacity: fadeAnim,
            transform: [{ translateY: Animated.add(slideAnim, floatAnim) }],
          },
        ]}
      >
        <AnimatedIonicons name={icon} size={64} color="#ccc" />
      </Animated.View>
      <Animated.View
        style={{
          opacity: fadeAnim,
          transform: [{ translateY: slideAnim }],
        }}
      >
        <Text variant="subtitle" style={styles.title}>
          {title}
        </Text>
        {description && (
          <Text variant="body" style={styles.description}>
            {description}
          </Text>
        )}
        {actionLabel && onAction && (
          <Button title={actionLabel} onPress={onAction} variant="primary" style={styles.button} />
        )}
      </Animated.View>
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
  iconWrapper: {
    marginBottom: 16,
  },
  title: {
    textAlign: 'center',
    marginBottom: 8,
  },
  description: {
    textAlign: 'center',
    color: '#666',
    marginBottom: 24,
  },
  button: {
    minWidth: 150,
  },
});
