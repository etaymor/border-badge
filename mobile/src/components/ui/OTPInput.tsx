import { useEffect, useRef, useState } from 'react';
import {
  NativeSyntheticEvent,
  Platform,
  StyleSheet,
  TextInput,
  TextInputKeyPressEventData,
  View,
  ViewStyle,
} from 'react-native';

import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { Text } from './Text';

interface OTPInputProps {
  value: string;
  onChangeText: (otp: string) => void;
  onComplete?: (otp: string) => void;
  length?: number;
  error?: string;
  autoFocus?: boolean;
  containerStyle?: ViewStyle;
  testID?: string;
}

export function OTPInput({
  value,
  onChangeText,
  onComplete,
  length = 6,
  error,
  autoFocus = true,
  containerStyle,
  testID,
}: OTPInputProps) {
  const inputRefs = useRef<(TextInput | null)[]>([]);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(autoFocus ? 0 : null);

  // Store onComplete in a ref to avoid triggering useEffect when callback reference changes
  // This prevents infinite loops when parent components don't memoize their callbacks
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  // Track if we've already called onComplete for this value to prevent duplicate calls
  const lastCompletedValue = useRef<string | null>(null);

  // Split the value into individual digits
  const digits = value.split('').slice(0, length);

  // Focus the first empty input on mount
  useEffect(() => {
    if (autoFocus) {
      inputRefs.current[0]?.focus();
    }
  }, [autoFocus]);

  // Auto-complete when all digits are entered
  useEffect(() => {
    if (value.length === length && onCompleteRef.current && lastCompletedValue.current !== value) {
      lastCompletedValue.current = value;
      onCompleteRef.current(value);
    }
  }, [value, length]);

  // Handle text change in a cell
  const handleChangeText = (text: string, index: number) => {
    try {
      // If paste detected (multiple characters), handle full OTP paste
      if (text.length > 1) {
        const pastedDigits = text.replace(/\D/g, '').slice(0, length);
        onChangeText(pastedDigits);
        // Focus last filled cell or end
        const targetIndex = Math.min(pastedDigits.length, length - 1);
        inputRefs.current[targetIndex]?.focus();
        return;
      }

      // Single character input
      const digit = text.replace(/\D/g, ''); // Only digits

      // Build new value
      const newDigits = [...digits];
      // Pad array if needed
      while (newDigits.length < index) {
        newDigits.push('');
      }
      newDigits[index] = digit;

      // Create new OTP string (trim trailing empty strings)
      const newOtp = newDigits.join('').slice(0, length);
      onChangeText(newOtp);

      // Move to next cell if digit was entered
      if (digit && index < length - 1) {
        inputRefs.current[index + 1]?.focus();
      }
    } catch (error) {
      // Log in development for debugging, continue silently in production
      if (__DEV__) {
        console.warn('OTPInput: Error handling input:', error);
      }
    }
  };

  // Handle backspace - use value prop directly to avoid stale closure issues
  const handleKeyPress = (e: NativeSyntheticEvent<TextInputKeyPressEventData>, index: number) => {
    if (e.nativeEvent.key === 'Backspace') {
      // Get fresh digits from current value prop to avoid stale state
      const currentDigits = value.split('').slice(0, length);

      if (!currentDigits[index] && index > 0) {
        // Current cell is empty, move to previous cell and clear it
        const newDigits = [...currentDigits];
        newDigits[index - 1] = '';
        onChangeText(newDigits.join(''));
        inputRefs.current[index - 1]?.focus();
      } else {
        // Clear current cell
        const newDigits = [...currentDigits];
        newDigits[index] = '';
        onChangeText(newDigits.join(''));
      }
    }
  };

  // Handle focus
  const handleFocus = (index: number) => {
    setFocusedIndex(index);
  };

  // Handle blur
  const handleBlur = () => {
    setFocusedIndex(null);
  };

  return (
    <View
      style={[styles.container, containerStyle]}
      accessible={true}
      accessibilityRole="none"
      accessibilityLabel={`Verification code input, ${value.length} of ${length} digits entered`}
    >
      <View style={styles.inputsContainer}>
        {Array.from({ length }).map((_, index) => (
          <TextInput
            key={index}
            ref={(ref) => {
              inputRefs.current[index] = ref;
            }}
            style={[
              styles.cell,
              focusedIndex === index && styles.cellFocused,
              error && styles.cellError,
              digits[index] && styles.cellFilled,
            ]}
            value={digits[index] || ''}
            onChangeText={(text) => handleChangeText(text, index)}
            onKeyPress={(e) => handleKeyPress(e, index)}
            onFocus={() => handleFocus(index)}
            onBlur={handleBlur}
            keyboardType="number-pad"
            maxLength={index === 0 ? length : 1} // First cell accepts paste
            selectTextOnFocus
            // iOS SMS autofill support
            textContentType={index === 0 ? 'oneTimeCode' : 'none'}
            autoComplete={Platform.OS === 'android' ? 'sms-otp' : 'one-time-code'}
            testID={testID ? `${testID}-cell-${index}` : undefined}
            accessibilityLabel={`Digit ${index + 1} of ${length}`}
            accessibilityHint={
              index === 0 ? 'Enter verification code or paste from clipboard' : undefined
            }
          />
        ))}
      </View>
      {error && (
        <Text variant="caption" style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
  },
  inputsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
  },
  cell: {
    width: 52,
    height: 64,
    borderRadius: 16,
    backgroundColor: colors.midnightNavyLight,
    fontSize: 28,
    fontFamily: fonts.openSans.semiBold,
    textAlign: 'center',
    color: colors.midnightNavy,
  },
  cellFocused: {
    backgroundColor: colors.midnightNavyFocused,
  },
  cellError: {
    borderWidth: 1,
    borderColor: colors.error,
  },
  cellFilled: {
    // No border for filled cells - clean look
  },
  error: {
    color: colors.error,
    marginTop: 12,
    textAlign: 'center',
  },
});
