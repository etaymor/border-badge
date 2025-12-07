import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';

import { colors } from '@constants/colors';

interface ResendTimerProps {
  onResend: () => void;
  isResending?: boolean;
  cooldownSeconds?: number;
  containerStyle?: ViewStyle;
  testID?: string;
}

export function ResendTimer({
  onResend,
  isResending = false,
  cooldownSeconds = 60,
  containerStyle,
  testID,
}: ResendTimerProps) {
  const [secondsLeft, setSecondsLeft] = useState(cooldownSeconds);
  const [canResend, setCanResend] = useState(false);

  // Countdown timer
  useEffect(() => {
    if (secondsLeft <= 0) {
      setCanResend(true);
      return;
    }

    const timer = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          setCanResend(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [secondsLeft]);

  // Handle resend press
  const handleResend = useCallback(() => {
    if (!canResend || isResending) return;

    onResend();

    // Reset timer after resend
    setCanResend(false);
    setSecondsLeft(cooldownSeconds);
  }, [canResend, isResending, onResend, cooldownSeconds]);

  // Format time as 0:45
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <View style={[styles.container, containerStyle]}>
      <Text style={styles.text}>Didn't receive a code?</Text>

      {canResend ? (
        <TouchableOpacity
          onPress={handleResend}
          disabled={isResending}
          style={styles.resendButton}
          testID={testID}
        >
          {isResending ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Text style={styles.resendText}>Resend Code</Text>
          )}
        </TouchableOpacity>
      ) : (
        <Text style={styles.timerText}>Resend in {formatTime(secondsLeft)}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    marginTop: 24,
  },
  text: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 8,
  },
  timerText: {
    fontSize: 14,
    color: colors.textTertiary,
    fontWeight: '500',
  },
  resendButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    minHeight: 36,
    justifyContent: 'center',
  },
  resendText: {
    fontSize: 16,
    color: colors.primary,
    fontWeight: '600',
  },
});
