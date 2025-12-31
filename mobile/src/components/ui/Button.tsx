import { useEffect, useRef } from 'react';
import {
  Animated,
  StyleSheet,
  ActivityIndicator,
  ViewStyle,
  TextStyle,
  Pressable,
  Text,
} from 'react-native';

import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { useAnimatedPress } from '@hooks/useAnimatedPress';

type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive';

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
  textStyle?: TextStyle;
  testID?: string;
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  style,
  textStyle,
  testID,
}: ButtonProps) {
  const isDisabled = disabled || loading;

  // Press animation - scale 0.97 for button feedback
  const { scaleValue: pressScale, pressHandlers } = useAnimatedPress({ pressedScale: 0.97 });

  // Loading pulse animation - opacity pulse when loading
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const pulseRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (loading) {
      // Start pulsing when loading
      pulseRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 0.7,
            duration: 600,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 600,
            useNativeDriver: true,
          }),
        ])
      );
      pulseRef.current.start();
    } else {
      // Stop pulsing and reset
      if (pulseRef.current) {
        pulseRef.current.stop();
        pulseRef.current = null;
      }
      pulseAnim.setValue(1);
    }

    return () => {
      if (pulseRef.current) {
        pulseRef.current.stop();
        pulseRef.current = null;
      }
    };
  }, [loading, pulseAnim]);

  return (
    <Animated.View
      style={[
        { transform: [{ scale: pressScale }], opacity: loading ? pulseAnim : 1 },
        isDisabled && !loading && styles.disabled,
      ]}
    >
      <Pressable
        style={[styles.base, styles[variant], style]}
        onPress={onPress}
        onPressIn={pressHandlers.onPressIn}
        onPressOut={pressHandlers.onPressOut}
        disabled={isDisabled}
        testID={testID}
        accessibilityRole="button"
        accessibilityState={{ disabled: isDisabled }}
      >
        {loading ? (
          <ActivityIndicator
            color={variant === 'primary' ? colors.cloudWhite : colors.primary}
            size="small"
          />
        ) : (
          <Text
            style={[
              styles.text,
              styles[`${variant}Text` as keyof typeof styles],
              isDisabled && styles.disabledText,
              textStyle,
            ]}
          >
            {title}
          </Text>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 44, // 14px vertical padding + line height makes it taller, but keeping minHeight for touch target
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: {
    backgroundColor: colors.sunsetGold,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  secondary: {
    backgroundColor: colors.backgroundSecondary,
  },
  outline: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.primary,
  },
  ghost: {
    backgroundColor: 'transparent',
  },
  destructive: {
    backgroundColor: 'transparent',
  },
  disabled: {
    opacity: 0.5,
  },
  text: {
    fontSize: 16,
    fontFamily: fonts.openSans.semiBold,
  },
  primaryText: {
    color: colors.midnightNavy,
    fontFamily: fonts.openSans.semiBold,
  },
  secondaryText: {
    color: colors.textPrimary,
  },
  outlineText: {
    color: colors.primary,
  },
  ghostText: {
    color: colors.primary,
  },
  destructiveText: {
    color: colors.adobeBrick,
  },
  disabledText: {
    color: colors.textTertiary,
  },
});
