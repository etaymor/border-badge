import { Ionicons } from '@expo/vector-icons';
import { forwardRef, useState } from 'react';
import {
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';

import { Text } from '@components/ui';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';

export interface OnboardingInputProps extends TextInputProps {
  /** Icon name from Ionicons to display on the left */
  icon?: keyof typeof Ionicons.glyphMap;
  /** Error message to display below input */
  error?: string;
  /** Custom container style */
  containerStyle?: ViewStyle;
  /** Show clear button when there's text */
  showClearButton?: boolean;
  /** Background color for the input wrapper */
  backgroundColor?: string;
}

export const OnboardingInput = forwardRef<TextInput, OnboardingInputProps>(
  (
    {
      icon,
      error,
      containerStyle,
      showClearButton = true,
      backgroundColor,
      value,
      onChangeText,
      style,
      ...props
    },
    ref
  ) => {
    const [isFocused, setIsFocused] = useState(false);

    const handleClear = () => {
      onChangeText?.('');
    };

    const bgColor = backgroundColor ?? 'rgba(23, 42, 58, 0.08)';

    return (
      <View style={containerStyle}>
        <View
          style={[
            styles.inputWrapper,
            { backgroundColor: bgColor },
            isFocused && styles.inputWrapperFocused,
            error && styles.inputWrapperError,
          ]}
        >
          {icon && (
            <Ionicons
              name={icon}
              size={28}
              color="rgba(23, 42, 58, 0.5)"
              style={styles.icon}
            />
          )}
          <TextInput
            ref={ref}
            style={[styles.input, !icon && styles.inputNoIcon, style]}
            value={value}
            onChangeText={onChangeText}
            placeholderTextColor="rgba(23, 42, 58, 0.5)"
            onFocus={(e) => {
              setIsFocused(true);
              props.onFocus?.(e);
            }}
            onBlur={(e) => {
              setIsFocused(false);
              props.onBlur?.(e);
            }}
            {...props}
          />
          {showClearButton && value && value.length > 0 && (
            <TouchableOpacity onPress={handleClear} style={styles.clearButton}>
              <Ionicons name="close-circle" size={26} color="rgba(23, 42, 58, 0.5)" />
            </TouchableOpacity>
          )}
        </View>
        {error && (
          <Text variant="caption" style={styles.errorText}>
            {error}
          </Text>
        )}
      </View>
    );
  }
);

OnboardingInput.displayName = 'OnboardingInput';

const styles = StyleSheet.create({
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 60,
  },
  inputWrapperFocused: {
    backgroundColor: 'rgba(23, 42, 58, 0.12)',
  },
  inputWrapperError: {
    borderWidth: 1,
    borderColor: colors.error,
  },
  icon: {
    marginRight: 16,
    alignSelf: 'center',
  },
  input: {
    flex: 1,
    fontSize: 28,
    fontFamily: fonts.openSans.regular,
    color: colors.midnightNavy,
    paddingVertical: 0,
    lineHeight: 36,
  },
  inputNoIcon: {
    paddingLeft: 4,
  },
  clearButton: {
    padding: 4,
  },
  errorText: {
    color: colors.error,
    marginTop: 8,
    marginLeft: 4,
  },
});
