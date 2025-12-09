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

import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { Text } from './Text';

type FocusEvent = NativeSyntheticEvent<TargetedEvent>;

interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  containerStyle?: ViewStyle;
}

export function Input({
  label,
  error,
  containerStyle,
  style,
  onFocus,
  onBlur,
  ...props
}: InputProps) {
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
      {label && (
        <Text variant="label" style={styles.label}>
          {label}
        </Text>
      )}
      <TextInput
        style={[styles.input, isFocused && styles.inputFocused, error && styles.inputError, style]}
        placeholderTextColor={colors.textTertiary}
        onFocus={handleFocus}
        onBlur={handleBlur}
        {...props}
      />
      {error && (
        <Text variant="caption" style={styles.error}>
          {error}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
  },
  label: {
    marginBottom: 6,
    color: colors.textPrimary,
  },
  input: {
    minHeight: 48, // Slightly taller
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12, // Match button radius
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    fontFamily: fonts.openSans.regular,
    color: colors.textPrimary,
    backgroundColor: colors.white,
  },
  inputFocused: {
    borderColor: colors.primary,
    backgroundColor: colors.white,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  inputError: {
    borderColor: colors.error,
  },
  error: {
    color: colors.error,
    marginTop: 4,
  },
});
