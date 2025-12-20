import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Image,
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
import type { OnboardingStackScreenProps } from '@navigation/types';
import { storeOnboardingComplete } from '@services/api';
import { Analytics } from '@services/analytics';
import { useAuthStore } from '@stores/authStore';
import { useOnboardingStore } from '@stores/onboardingStore';
import {
  formatPhoneForDisplay,
  RESEND_COOLDOWN_SECONDS,
  validateOTP,
  validatePhone,
} from '@utils/phoneValidation';

/* eslint-disable @typescript-eslint/no-require-imports */
const atlasLogo = require('../../../assets/atlasi-logo.png');
/* eslint-enable @typescript-eslint/no-require-imports */

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
  const { homeCountry, displayName, selectedCountries, trackingPreference } = useOnboardingStore();

  // Track screen view
  useEffect(() => {
    Analytics.viewOnboardingAccount();
  }, []);

  const sendOTP = useSendOTP();
  const verifyOTP = useVerifyOTP({
    onMigrationComplete: (result) => {
      if (!result) {
        // Migration failed entirely - keep onboarding state for retry
        Alert.alert('Migration failed', 'Your data could not be migrated. Please try again.');
        return;
      }

      if (result.success) {
        // Track successful onboarding completion
        const countriesCount = new Set([
          ...selectedCountries,
          ...(homeCountry ? [homeCountry] : []),
        ]).size;
        Analytics.completeOnboarding({
          countriesCount,
          homeCountry,
          trackingPreference,
        });

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

  // Animation values for phone step
  const titleAnim = useRef(new Animated.Value(0)).current;
  const accentAnim = useRef(new Animated.Value(0)).current;
  const contentAnim = useRef(new Animated.Value(0)).current;
  const buttonAnim = useRef(new Animated.Value(0)).current;

  // Animation values for OTP step
  const otpContainerAnim = useRef(new Animated.Value(0)).current;

  // Run entrance animations for phone step
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

  // Handle OTP verification - wrapped in useCallback to provide stable reference for OTPInput
  const handleVerifyOTP = useCallback(() => {
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
  }, [otp, phone, displayName, verifyOTP]);

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
    Analytics.skipToLogin('AccountCreation');
    navigation.navigate('Auth', { screen: 'Login' });
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
      {/* Header with logo */}
      <View style={styles.headerRow}>
        {step === 'otp' ? (
          <TouchableOpacity
            onPress={handleBackToPhone}
            style={styles.backButton}
            accessibilityRole="button"
            accessibilityLabel="Change phone number"
          >
            <Ionicons name="chevron-back" size={20} color={colors.midnightNavy} />
            <Text style={styles.backText}>Change number</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.backButtonPlaceholder} />
        )}
        <Image source={atlasLogo} style={styles.logo} resizeMode="contain" />
        <View style={styles.backButtonPlaceholder} />
      </View>

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
                  Save your passport
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
                ~ just one more step ~
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
                  defaultCountryCode={homeCountry}
                  placeholder="Phone Number"
                  error={phoneError}
                  containerStyle={styles.input}
                  testID="account-creation-phone"
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
                  testID="account-creation-send-button"
                >
                  <Text style={styles.buttonText}>
                    {sendOTP.isPending ? 'Sending...' : 'Continue'}
                  </Text>
                </TouchableOpacity>
              </Animated.View>

              {/* Login link */}
              <Animated.View style={{ opacity: contentAnim }}>
                <TouchableOpacity
                  onPress={handleAlreadyHaveAccount}
                  style={styles.loginLink}
                  accessibilityRole="button"
                  accessibilityLabel="Sign in to existing account"
                >
                  <Text style={styles.loginLinkText}>Already have an account? Sign in</Text>
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
                  onComplete={handleVerifyOTP}
                  error={otpError}
                  autoFocus
                  testID="account-creation-otp"
                />
              </View>

              <TouchableOpacity
                style={[styles.button, verifyOTP.isPending && styles.buttonDisabled]}
                onPress={handleVerifyOTP}
                activeOpacity={0.9}
                disabled={verifyOTP.isPending}
                accessibilityRole="button"
                accessibilityLabel="Create your account"
                testID="account-creation-verify-button"
              >
                <Text style={styles.buttonText}>
                  {verifyOTP.isPending ? 'Creating...' : 'Create Account'}
                </Text>
              </TouchableOpacity>

              <ResendTimer
                onResend={handleResendOTP}
                isResending={sendOTP.isPending}
                cooldownSeconds={RESEND_COOLDOWN_SECONDS}
                startTime={otpSentAt}
                testID="account-creation-resend"
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
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  logo: {
    width: 140,
    height: 40,
  },
  backButtonPlaceholder: {
    width: 120,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    width: 120,
  },
  backText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 14,
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
    paddingTop: 16,
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
  loginLink: {
    marginTop: 24,
    alignItems: 'center',
    paddingVertical: 8,
  },
  loginLinkText: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 14,
    color: colors.mossGreen,
  },
});
