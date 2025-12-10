import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { OnboardingPhoneInput } from '@components/onboarding';
import { OTPInput, ResendTimer, Text } from '@components/ui';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
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
  const [otpSentAt, setOtpSentAt] = useState<number | undefined>();

  const sendOTP = useSendOTP();
  const verifyOTP = useVerifyOTP();

  const canGoBack = navigation.canGoBack();

  // Animation values for phone step
  const titleAnim = useRef(new Animated.Value(0)).current;
  const accentAnim = useRef(new Animated.Value(0)).current;
  const contentAnim = useRef(new Animated.Value(0)).current;
  const buttonAnim = useRef(new Animated.Value(0)).current;

  // Animation values for OTP step
  const otpContainerAnim = useRef(new Animated.Value(0)).current;

  // Run entrance animations
  useEffect(() => {
    if (step === 'phone') {
      // Reset animations
      titleAnim.setValue(0);
      accentAnim.setValue(0);
      contentAnim.setValue(0);
      buttonAnim.setValue(0);

      Animated.stagger(100, [
        Animated.timing(titleAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(accentAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(contentAnim, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.spring(buttonAnim, {
          toValue: 1,
          friction: 8,
          tension: 60,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      // OTP step - minimal fade in
      otpContainerAnim.setValue(0);
      Animated.timing(otpContainerAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
  }, [step, titleAnim, accentAnim, contentAnim, buttonAnim, otpContainerAnim]);

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
    sendOTP.mutate(
      { phone },
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

  // Animation interpolations
  const titleTranslateY = titleAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [15, 0],
  });

  const accentTranslateY = accentAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [10, 0],
  });

  const contentTranslateY = contentAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [10, 0],
  });

  const buttonScale = buttonAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.95, 1],
  });

  return (
    <SafeAreaView style={styles.container}>
      {/* Back button */}
      {(canGoBack || step === 'otp') && (
        <TouchableOpacity
          onPress={step === 'otp' ? handleBackToPhone : () => navigation.goBack()}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel={step === 'otp' ? 'Change phone number' : 'Go back'}
        >
          <Ionicons name="chevron-back" size={20} color={colors.midnightNavy} />
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
              {/* Title */}
              <Animated.View
                style={{
                  opacity: titleAnim,
                  transform: [{ translateY: titleTranslateY }],
                }}
              >
                <Text variant="title" style={styles.title}>
                  Welcome back
                </Text>
              </Animated.View>

              {/* Accent subtitle */}
              <Animated.Text
                style={[
                  styles.accentSubtitle,
                  {
                    opacity: accentAnim,
                    transform: [{ translateY: accentTranslateY }],
                  },
                ]}
              >
                ~ let&apos;s pick up where you left off ~
              </Animated.Text>

              {/* Phone input */}
              <Animated.View
                style={{
                  opacity: contentAnim,
                  transform: [{ translateY: contentTranslateY }],
                }}
              >
                <OnboardingPhoneInput
                  value={phone}
                  onChangeText={(value) => {
                    setPhone(value);
                    if (phoneError) setPhoneError('');
                  }}
                  placeholder="Phone Number"
                  error={phoneError}
                  containerStyle={styles.input}
                  testID="phone-auth-input"
                />
              </Animated.View>

              {/* Continue button */}
              <Animated.View
                style={{
                  opacity: buttonAnim,
                  transform: [{ scale: buttonScale }],
                }}
              >
                <TouchableOpacity
                  style={[styles.button, sendOTP.isPending && styles.buttonDisabled]}
                  onPress={handleSendOTP}
                  activeOpacity={0.9}
                  disabled={sendOTP.isPending}
                  accessibilityRole="button"
                  accessibilityLabel="Continue to verification"
                  testID="phone-auth-send-button"
                >
                  <Text style={styles.buttonText}>
                    {sendOTP.isPending ? 'Sending...' : 'Continue'}
                  </Text>
                </TouchableOpacity>
              </Animated.View>
            </View>
          ) : (
            // OTP Entry Step
            <Animated.View style={[styles.content, { opacity: otpContainerAnim }]}>
              <Text variant="title" style={styles.title}>
                Enter your code
              </Text>
              <Text variant="body" style={styles.subtitle}>
                Sent to {formatPhoneForDisplay(phone)}
              </Text>

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

              <TouchableOpacity
                style={[styles.button, verifyOTP.isPending && styles.buttonDisabled]}
                onPress={handleVerifyOTP}
                activeOpacity={0.9}
                disabled={verifyOTP.isPending}
                accessibilityRole="button"
                accessibilityLabel="Verify code and sign in"
                testID="phone-auth-verify-button"
              >
                <Text style={styles.buttonText}>
                  {verifyOTP.isPending ? 'Verifying...' : 'Verify'}
                </Text>
              </TouchableOpacity>

              <ResendTimer
                onResend={handleResendOTP}
                isResending={sendOTP.isPending}
                cooldownSeconds={RESEND_COOLDOWN_SECONDS}
                startTime={otpSentAt}
                testID="phone-auth-resend"
              />
            </Animated.View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.warmCream,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
    alignSelf: 'flex-start',
    gap: 4,
  },
  backText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 16,
    color: colors.midnightNavy,
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
    paddingTop: 48,
    paddingBottom: 24,
  },
  title: {
    marginBottom: 8,
  },
  accentSubtitle: {
    fontFamily: fonts.dawning.regular,
    fontSize: 18,
    color: colors.adobeBrick,
    marginBottom: 32,
  },
  subtitle: {
    color: colors.textSecondary,
    marginBottom: 32,
  },
  input: {
    marginBottom: 24,
  },
  otpContainer: {
    marginBottom: 32,
  },
  button: {
    backgroundColor: colors.sunsetGold,
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 16,
    color: colors.midnightNavy,
  },
});
