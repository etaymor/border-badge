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
          intensity={40}
          tint="light"
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
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.6)',
    // Default shadow
    shadowColor: colors.midnightNavy,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  wrapperFocused: {
    // Enhanced glow on focus (Option A - glow only, no border change)
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  wrapperError: {
    borderColor: colors.adobeBrick,
    borderWidth: 1.5,
  },
  glass: {
    minHeight: 48,
    backgroundColor: 'rgba(255, 255, 255, 0.7)',
  },
  glassMultiline: {
    minHeight: 100,
  },
  glassFocused: {
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
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
