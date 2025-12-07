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
  /** Unix timestamp (ms) when OTP was sent. Used to persist timer across remounts. */
  startTime?: number;
  containerStyle?: ViewStyle;
  testID?: string;
}

export function ResendTimer({
  onResend,
  isResending = false,
  cooldownSeconds = 60,
  startTime,
  containerStyle,
  testID,
}: ResendTimerProps) {
  // Calculate remaining seconds based on startTime if provided
  const calculateRemainingSeconds = useCallback(() => {
    if (!startTime) return cooldownSeconds;
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    return Math.max(0, cooldownSeconds - elapsed);
  }, [startTime, cooldownSeconds]);

  const [secondsLeft, setSecondsLeft] = useState(calculateRemainingSeconds);
  const [canResend, setCanResend] = useState(() => calculateRemainingSeconds() <= 0);

  // Countdown timer - recalculates when startTime changes
  useEffect(() => {
    const remaining = calculateRemainingSeconds();
    setSecondsLeft(remaining);
    setCanResend(remaining <= 0);

    if (remaining <= 0) return;

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
  }, [calculateRemainingSeconds]);

  // Handle resend press
  const handleResend = useCallback(() => {
    if (!canResend || isResending) return;

    onResend();

    // Reset timer after resend (parent should update startTime)
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
      <Text style={styles.text}>Didn&apos;t receive a code?</Text>

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
