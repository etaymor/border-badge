import { useState } from 'react';
import {
  Alert,
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
import type { OnboardingStackScreenProps } from '@navigation/types';
import { storeOnboardingComplete } from '@services/api';
import { useAuthStore } from '@stores/authStore';
import { useOnboardingStore } from '@stores/onboardingStore';
import {
  formatPhoneForDisplay,
  RESEND_COOLDOWN_SECONDS,
  validateOTP,
  validatePhone,
} from '@utils/phoneValidation';

type Props = OnboardingStackScreenProps<'AccountCreation'>;

type AuthStep = 'phone' | 'otp';

export function AccountCreationScreen({ navigation }: Props) {
  const [step, setStep] = useState<AuthStep>('phone');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [otpError, setOtpError] = useState('');
  const [otpSentAt, setOtpSentAt] = useState<number | undefined>();

  const { setHasCompletedOnboarding } = useAuthStore();
  const { homeCountry, displayName } = useOnboardingStore();

  const sendOTP = useSendOTP();
  const verifyOTP = useVerifyOTP({
    onMigrationComplete: (result) => {
      if (!result) {
        // Migration failed entirely - keep onboarding state for retry
        Alert.alert('Migration failed', 'Your data could not be migrated. Please try again.');
        return;
      }

      if (result.success) {
        setHasCompletedOnboarding(true);
        storeOnboardingComplete();
      } else {
        // Keep onboarding state intact so user can retry migration
        const message =
          result.errors.length > 0
            ? result.errors.join('\n')
            : 'Some data could not be migrated. Please try again.';
        Alert.alert('Migration incomplete', message);
      }
    },
  });

  // Handle sending OTP
  const handleSendOTP = () => {
    const result = validatePhone(phone);
    if (!result.isValid) {
      setPhoneError(result.error!);
      return;
    }
    setPhoneError('');

    sendOTP.mutate(
      { phone, displayName: displayName ?? undefined },
      {
        onSuccess: () => {
          setOtpSentAt(Date.now());
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

    // Pass display name from onboarding store
    verifyOTP.mutate(
      { phone, token: otp, displayName: displayName ?? undefined },
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
    sendOTP.mutate(
      { phone, displayName: displayName ?? undefined },
      {
        onSuccess: () => {
          setOtpSentAt(Date.now());
        },
      }
    );
  };

  // Handle back to phone entry
  const handleBackToPhone = () => {
    setStep('phone');
    setPhone('');
    setPhoneError('');
    setOtp('');
    setOtpError('');
    setOtpSentAt(undefined);
  };

  // Handle navigation to login for existing users
  const handleAlreadyHaveAccount = () => {
    navigation.navigate('PhoneAuth');
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Back button for OTP step */}
      {step === 'otp' && (
        <TouchableOpacity onPress={handleBackToPhone} style={styles.backButton}>
          <Text style={styles.backText}>Change number</Text>
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
              <Text style={styles.title}>Save your passport.</Text>
              <Text style={styles.subtitle}>
                Create an account to sync your travel data across devices and unlock all features.
              </Text>

              <PhoneInput
                value={phone}
                onChangeText={(value) => {
                  setPhone(value);
                  if (phoneError) setPhoneError('');
                }}
                defaultCountryCode={homeCountry}
                label="Phone Number"
                placeholder="Enter your number"
                error={phoneError}
                containerStyle={styles.input}
                testID="account-creation-phone"
              />

              <Button
                title="Continue"
                onPress={handleSendOTP}
                loading={sendOTP.isPending}
                style={styles.button}
                testID="account-creation-send-button"
              />

              <Text style={styles.helperText}>We&apos;ll send you a verification code</Text>

              <TouchableOpacity onPress={handleAlreadyHaveAccount} style={styles.loginLink}>
                <Text style={styles.loginLinkText}>Already have an account? Sign in</Text>
              </TouchableOpacity>
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
                  testID="account-creation-otp"
                />
              </View>

              <Button
                title="Create Account"
                onPress={handleVerifyOTP}
                loading={verifyOTP.isPending}
                style={styles.button}
                testID="account-creation-verify-button"
              />

              <ResendTimer
                onResend={handleResendOTP}
                isResending={sendOTP.isPending}
                cooldownSeconds={RESEND_COOLDOWN_SECONDS}
                startTime={otpSentAt}
                testID="account-creation-resend"
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
    paddingTop: 40,
    paddingBottom: 24,
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
    lineHeight: 22,
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
  loginLink: {
    marginTop: 24,
    alignItems: 'center',
    paddingVertical: 8,
  },
  loginLinkText: {
    fontSize: 14,
    color: colors.primary,
    fontWeight: '500',
  },
});
