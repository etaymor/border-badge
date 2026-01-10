import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  NativeSyntheticEvent,
  StyleSheet,
  TargetedEvent,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';
import { BlurView } from 'expo-blur';

import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { liquidGlass, GLASS_CONFIG } from '@constants/glass';
import { Text } from './Text';
import {
  SPRING_FRICTION,
  SPRING_TENSION_IN,
  SPRING_TENSION_OUT,
} from '../../navigation/transitionConfig';

type FocusEvent = NativeSyntheticEvent<TargetedEvent>;

interface GlassInputProps extends TextInputProps {
  label?: string;
  error?: string;
  /** Show success state with glow effect */
  success?: boolean;
  containerStyle?: ViewStyle;
}

/**
 * A liquid glass styled input component.
 * Uses BlurView for the glass effect with subtle glow on focus.
 * Includes animated focus scale, error shake, and success glow effects.
 */
export function GlassInput({
  label,
  error,
  success = false,
  containerStyle,
  style,
  multiline,
  onFocus,
  onBlur,
  ...props
}: GlassInputProps) {
  const [isFocused, setIsFocused] = useState(false);

  // Focus scale animation (1.0 -> 1.01)
  const focusScale = useRef(new Animated.Value(1)).current;

  // Error shake animation
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const prevErrorRef = useRef<string | undefined>(undefined);

  // Success glow animation
  const glowAnim = useRef(new Animated.Value(0)).current;
  const glowLoopRef = useRef<Animated.CompositeAnimation | null>(null);

  // Animate focus scale
  useEffect(() => {
    Animated.spring(focusScale, {
      toValue: isFocused ? 1.01 : 1,
      friction: SPRING_FRICTION,
      tension: isFocused ? SPRING_TENSION_IN : SPRING_TENSION_OUT,
      useNativeDriver: true,
    }).start();
  }, [isFocused, focusScale]);

  // Trigger shake animation when error appears (not on mount if error exists)
  useEffect(() => {
    if (error && !prevErrorRef.current) {
      // Error just appeared - trigger shake
      // 3 cycles of shake: 0 -> 10 -> -10 -> 10 -> -10 -> 10 -> -10 -> 0
      Animated.sequence([
        Animated.timing(shakeAnim, { toValue: 10, duration: 50, useNativeDriver: true }),
        Animated.timing(shakeAnim, { toValue: -10, duration: 50, useNativeDriver: true }),
        Animated.timing(shakeAnim, { toValue: 10, duration: 50, useNativeDriver: true }),
        Animated.timing(shakeAnim, { toValue: -10, duration: 50, useNativeDriver: true }),
        Animated.timing(shakeAnim, { toValue: 10, duration: 50, useNativeDriver: true }),
        Animated.timing(shakeAnim, { toValue: -10, duration: 50, useNativeDriver: true }),
        Animated.timing(shakeAnim, { toValue: 0, duration: 50, useNativeDriver: true }),
      ]).start();
    }
    prevErrorRef.current = error;
  }, [error, shakeAnim]);

  // Success glow animation
  useEffect(() => {
    if (success) {
      // Start pulsing glow
      glowLoopRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(glowAnim, {
            toValue: 1,
            duration: 800,
            useNativeDriver: true,
          }),
          Animated.timing(glowAnim, {
            toValue: 0,
            duration: 800,
            useNativeDriver: true,
          }),
        ])
      );
      glowLoopRef.current.start();
    } else {
      // Stop glow and reset
      if (glowLoopRef.current) {
        glowLoopRef.current.stop();
        glowLoopRef.current = null;
      }
      glowAnim.setValue(0);
    }

    return () => {
      if (glowLoopRef.current) {
        glowLoopRef.current.stop();
        glowLoopRef.current = null;
      }
    };
  }, [success, glowAnim]);

  const handleFocus = useCallback(
    (e: FocusEvent) => {
      setIsFocused(true);
      onFocus?.(e);
    },
    [onFocus]
  );

  const handleBlur = useCallback(
    (e: FocusEvent) => {
      setIsFocused(false);
      onBlur?.(e);
    },
    [onBlur]
  );

  // Dynamic glow shadow opacity based on success state
  const glowOpacity = success
    ? glowAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [0.2, 0.5],
      })
    : 0;

  return (
    <View style={[styles.container, containerStyle]}>
      {label && <Text style={styles.label}>{label}</Text>}
      <Animated.View
        style={[
          styles.wrapper,
          isFocused && styles.wrapperFocused,
          error && styles.wrapperError,
          success && styles.wrapperSuccess,
          {
            transform: [{ scale: focusScale }, { translateX: shakeAnim }],
          },
          success && {
            shadowOpacity: glowOpacity,
          },
        ]}
      >
        <BlurView
          intensity={GLASS_CONFIG.intensity.medium}
          tint={GLASS_CONFIG.tint}
          style={[
            styles.glass,
            multiline && styles.glassMultiline,
            isFocused && styles.glassFocused,
            success && styles.glassSuccess,
          ]}
        >
          <TextInput
            style={[styles.input, multiline && styles.inputMultiline, style]}
            placeholderTextColor={colors.textTertiary}
            onFocus={handleFocus}
            onBlur={handleBlur}
            multiline={multiline}
            textAlignVertical={multiline ? 'top' : 'center'}
            {...props}
          />
        </BlurView>
      </Animated.View>
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
  },
  label: {
    fontFamily: fonts.oswald.medium,
    fontSize: 12,
    color: colors.midnightNavy,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: 8,
    opacity: 0.7,
  },
  wrapper: {
    ...liquidGlass.input,
    overflow: 'hidden',
  },
  wrapperFocused: {
    ...liquidGlass.floatingCard, // Apply elevated styles on focus
    // Note: Scale animation handled by focusScale animated value
  },
  wrapperError: {
    borderColor: colors.adobeBrick,
    borderWidth: 1.5,
  },
  wrapperSuccess: {
    borderColor: colors.mossGreen,
    borderWidth: 1.5,
    shadowColor: colors.mossGreen,
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 8,
    elevation: 4,
  },
  glass: {
    minHeight: 48,
    // Background color handled by wrapper/liquidGlass style to allow blur
  },
  glassMultiline: {
    minHeight: 100,
  },
  glassFocused: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)', // Subtle highlight
  },
  glassSuccess: {
    backgroundColor: 'rgba(84, 122, 95, 0.05)', // Subtle green tint (mossGreen)
  },
  input: {
    flex: 1,
    minHeight: 48,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    fontFamily: fonts.openSans.regular,
    color: colors.textPrimary,
  },
  inputMultiline: {
    minHeight: 100,
    paddingTop: 14,
  },
  error: {
    fontFamily: fonts.openSans.regular,
    fontSize: 13,
    color: colors.adobeBrick,
    marginTop: 6,
    marginLeft: 4,
  },
});
