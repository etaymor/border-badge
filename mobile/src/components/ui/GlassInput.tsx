import { useState } from 'react';
import {
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

type FocusEvent = NativeSyntheticEvent<TargetedEvent>;

interface GlassInputProps extends TextInputProps {
  label?: string;
  error?: string;
  containerStyle?: ViewStyle;
}

/**
 * A liquid glass styled input component.
 * Uses BlurView for the glass effect with subtle glow on focus.
 */
export function GlassInput({
  label,
  error,
  containerStyle,
  style,
  multiline,
  onFocus,
  onBlur,
  ...props
}: GlassInputProps) {
  const [isFocused, setIsFocused] = useState(false);

  const handleFocus = (e: FocusEvent) => {
    setIsFocused(true);
    onFocus?.(e);
  };

  const handleBlur = (e: FocusEvent) => {
    setIsFocused(false);
    onBlur?.(e);
  };

  return (
    <View style={[styles.container, containerStyle]}>
      {label && <Text style={styles.label}>{label}</Text>}
      <View
        style={[styles.wrapper, isFocused && styles.wrapperFocused, error && styles.wrapperError]}
      >
        <BlurView
          intensity={GLASS_CONFIG.intensity.medium}
          tint={GLASS_CONFIG.tint}
          style={[
            styles.glass,
            multiline && styles.glassMultiline,
            isFocused && styles.glassFocused,
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
      </View>
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
    transform: [{ scale: 1.01 }], // Subtle scale effect on focus
  },
  wrapperError: {
    borderColor: colors.adobeBrick,
    borderWidth: 1.5,
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
