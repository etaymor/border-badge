import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, OTPInput, PhoneInput, ResendTimer } from '@components/ui';
import { colors } from '@constants/colors';
import { useSendOTP, useVerifyOTP } from '@hooks/useAuth';
import type { AuthStackScreenProps } from '@navigation/types';
import {
  formatPhoneForDisplay,
  RESEND_COOLDOWN_SECONDS,
  validateOTP,
  validatePhone,
} from '@utils/phoneValidation';

type Props = AuthStackScreenProps<'PhoneAuth'>;

type AuthStep = 'phone' | 'otp';

export function PhoneAuthScreen({ navigation }: Props) {
  const [step, setStep] = useState<AuthStep>('phone');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [otpError, setOtpError] = useState('');

  const sendOTP = useSendOTP();
  const verifyOTP = useVerifyOTP();

  const canGoBack = navigation.canGoBack();

  // Handle sending OTP
  const handleSendOTP = () => {
    const result = validatePhone(phone);
    if (!result.isValid) {
      setPhoneError(result.error!);
      return;
    }
    setPhoneError('');

    sendOTP.mutate(
      { phone },
      {
        onSuccess: () => {
          setStep('otp');
          setOtpError('');
        },
      }
    );
  };

  // Handle OTP verification
  const handleVerifyOTP = () => {
    const result = validateOTP(otp);
    if (!result.isValid) {
      setOtpError(result.error!);
      return;
    }

    verifyOTP.mutate(
      { phone, token: otp },
      {
        onError: () => {
          setOtp('');
          setOtpError('Invalid code. Please try again.');
        },
      }
    );
  };

  // Handle resend OTP
  const handleResendOTP = () => {
    sendOTP.mutate({ phone });
  };

  // Handle back to phone entry
  const handleBackToPhone = () => {
    setStep('phone');
    setOtp('');
    setOtpError('');
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Back button */}
      {(canGoBack || step === 'otp') && (
        <TouchableOpacity
          onPress={step === 'otp' ? handleBackToPhone : () => navigation.goBack()}
          style={styles.backButton}
        >
          <Text style={styles.backText}>{step === 'otp' ? 'Change number' : 'Back'}</Text>
        </TouchableOpacity>
      )}

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {step === 'phone' ? (
            // Phone Entry Step
            <View style={styles.content}>
              <Text style={styles.title}>Welcome back</Text>
              <Text style={styles.subtitle}>Enter your phone number to sign in</Text>

              <PhoneInput
                value={phone}
                onChangeText={(value) => {
                  setPhone(value);
                  if (phoneError) setPhoneError('');
                }}
                label="Phone Number"
                placeholder="Enter your number"
                error={phoneError}
                containerStyle={styles.input}
                testID="phone-auth-input"
              />

              <Button
                title="Continue"
                onPress={handleSendOTP}
                loading={sendOTP.isPending}
                style={styles.button}
                testID="phone-auth-send-button"
              />

              <Text style={styles.helperText}>We&apos;ll send you a verification code</Text>
            </View>
          ) : (
            // OTP Entry Step
            <View style={styles.content}>
              <Text style={styles.title}>Enter verification code</Text>
              <Text style={styles.subtitle}>Sent to {formatPhoneForDisplay(phone)}</Text>

              <View style={styles.otpContainer}>
                <OTPInput
                  value={otp}
                  onChangeText={(value) => {
                    setOtp(value);
                    if (otpError) setOtpError('');
                  }}
                  error={otpError}
                  autoFocus
                  testID="phone-auth-otp"
                />
              </View>

              <Button
                title="Verify"
                onPress={handleVerifyOTP}
                loading={verifyOTP.isPending}
                style={styles.button}
                testID="phone-auth-verify-button"
              />

              <ResendTimer
                onResend={handleResendOTP}
                isResending={sendOTP.isPending}
                cooldownSeconds={RESEND_COOLDOWN_SECONDS}
                testID="phone-auth-resend"
              />
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.white,
  },
  backButton: {
    paddingVertical: 8,
    paddingHorizontal: 20,
    alignSelf: 'flex-start',
  },
  backText: {
    fontSize: 16,
    color: colors.primary,
    fontWeight: '600',
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: colors.textPrimary,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: colors.textSecondary,
    marginBottom: 32,
  },
  input: {
    marginBottom: 16,
  },
  otpContainer: {
    marginBottom: 24,
  },
  button: {
    marginTop: 8,
  },
  helperText: {
    fontSize: 14,
    color: colors.textTertiary,
    textAlign: 'center',
    marginTop: 16,
  },
});
