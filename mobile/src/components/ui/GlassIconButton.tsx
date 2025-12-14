import { Pressable, StyleSheet, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';

import { colors } from '@constants/colors';

type IoniconsName = keyof typeof Ionicons.glyphMap;

interface GlassIconButtonProps {
  /** Ionicons icon name */
  icon: IoniconsName;
  /** Press handler */
  onPress: () => void;
  /**
   * Visual variant:
   * - 'light': Light blur with dark icon (use on light backgrounds)
   * - 'dark': Dark blur with white icon (use over images/dark backgrounds)
   */
  variant?: 'light' | 'dark';
  /** Size variant */
  size?: 'default' | 'small';
  /** Test ID for testing */
  testID?: string;
  /** Accessibility label */
  accessibilityLabel?: string;
}

/**
 * A reusable icon button component with liquid glass styling.
 * Similar to GlassBackButton but accepts any Ionicons icon.
 */
export function GlassIconButton({
  icon,
  onPress,
  variant = 'light',
  size = 'default',
  testID,
  accessibilityLabel,
}: GlassIconButtonProps) {
  const sizeStyles = size === 'small' ? styles.containerSmall : styles.containerDefault;
  const iconSize = size === 'small' ? 18 : 22;
  const isDark = variant === 'dark';

  return (
    <Pressable
      onPress={onPress}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      style={({ pressed }) => [styles.pressable, pressed && styles.pressed]}
    >
      <View style={[styles.wrapper, sizeStyles, isDark && styles.wrapperDark]}>
        <BlurView
          intensity={isDark ? 20 : 30}
          tint={isDark ? 'dark' : 'light'}
          style={[styles.glass, sizeStyles, isDark && styles.glassDark]}
        >
          <Ionicons name={icon} size={iconSize} color={isDark ? '#fff' : colors.midnightNavy} />
        </BlurView>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressable: {
    // Allows the button to be positioned by parent
  },
  pressed: {
    opacity: 0.8,
  },
  wrapper: {
    borderRadius: 22,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.6)',
  },
  containerDefault: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  containerSmall: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  glass: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  // Dark variant styles (for use over images)
  wrapperDark: {
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  glassDark: {
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
});
