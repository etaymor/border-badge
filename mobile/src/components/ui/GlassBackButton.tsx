import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';

import { colors } from '@constants/colors';

interface GlassBackButtonProps {
  onPress: () => void;
  /**
   * Visual variant:
   * - 'light': Light blur with dark arrow (use on light backgrounds)
   * - 'dark': Dark blur with white arrow (use over images/dark backgrounds)
   */
  variant?: 'light' | 'dark';
  /** Size variant */
  size?: 'default' | 'small';
  testID?: string;
}

/**
 * A consistent back button component with liquid glass styling.
 * Uses the ← arrow character for a clean, on-brand appearance.
 */
export function GlassBackButton({
  onPress,
  variant = 'light',
  size = 'default',
  testID,
}: GlassBackButtonProps) {
  const sizeStyles = size === 'small' ? styles.containerSmall : styles.containerDefault;
  const arrowSizeStyle = size === 'small' ? styles.arrowSmall : styles.arrowDefault;
  const isDark = variant === 'dark';

  return (
    <Pressable
      onPress={onPress}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      accessibilityRole="button"
      accessibilityLabel="Go back"
      testID={testID}
      style={({ pressed }) => [styles.pressable, pressed && styles.pressed]}
    >
      <View style={[styles.wrapper, sizeStyles, isDark && styles.wrapperDark]}>
        <BlurView
          intensity={isDark ? 20 : 30}
          tint={isDark ? 'dark' : 'light'}
          style={[styles.glass, sizeStyles, isDark && styles.glassDark]}
        >
          <Text style={[styles.arrow, arrowSizeStyle, isDark && styles.arrowDark]}>{'←'}</Text>
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
  arrow: {
    color: colors.midnightNavy,
    fontWeight: '300',
  },
  arrowDefault: {
    fontSize: 28,
    marginTop: -2, // Optical centering adjustment
  },
  arrowSmall: {
    fontSize: 22,
    marginTop: -1,
  },
  // Dark variant styles (for use over images)
  wrapperDark: {
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  glassDark: {
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  arrowDark: {
    color: '#fff',
  },
});
